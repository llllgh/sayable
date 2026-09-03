import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  TEXT_PROVIDER_PROFILES,
  defaultTextProviderId,
  getTextProviderProfile,
  legacyTextProviderId,
  textProvidersForRegion,
} from '../src/llm/profiles';
import {
  LLM_OUTPUT_TOKENS,
  LLM_REQUEST_TIMEOUT_MS,
} from '../src/llm/budgets';
import { preflightProvider } from '../src/llm/client';
import { requestText } from '../src/llm/provider';
import { classifyHttpError, userMessage } from '../src/llm/errors';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('text provider profiles', () => {
  it('keeps BytePlus as the overseas baseline and offers Gemini', () => {
    expect(defaultTextProviderId('global')).toBe('byteplus-global');
    expect(legacyTextProviderId('global')).toBe('byteplus-global');
    expect(textProvidersForRegion('global').map(profile => profile.id))
      .toEqual(['byteplus-global', 'google-gemini']);
  });

  it('falls back to a provider available in the selected region', () => {
    expect(getTextProviderProfile('google-gemini', 'cn').id)
      .toBe('modelark-cn');
  });

  it('calls the official Gemini OpenAI-compatible endpoint', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      status: 200,
      text: async () => JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { total_tokens: 12 },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const profile = TEXT_PROVIDER_PROFILES['google-gemini'];

    const result = await requestText({
      protocol: profile.protocol,
      baseUrl: profile.baseUrl,
      model: profile.defaultModel,
      apiKey: 'test-gemini-key',
      timeoutMs: 1000,
      maxRetry: 0,
    }, [{ role: 'user', content: 'Return JSON.' }], { jsonMode: true });

    expect(result).toEqual({ text: '{"ok":true}', tokens: 12 });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    );
    const headers = request.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-gemini-key');
    expect(JSON.parse(String(request.body))).toMatchObject({
      model: 'gemini-3.8-flash',
      response_format: { type: 'json_object' },
    });
  });

  it('reserves reasoning headroom during provider preflight', async () => {
    const fetchMock = vi.fn(async (..._args: any[]) => ({
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          finish_reason: 'stop',
          message: { content: '{"ok":true}' },
        }],
        usage: { total_tokens: 144 },
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(preflightProvider({
      protocol: 'chat_completions',
      baseUrl: 'https://provider.example/v1',
      model: 'reasoning-model',
      apiKey: 'test-key',
      timeoutMs: 1000,
      maxRetry: 0,
    })).resolves.toMatchObject({ supportsJsonMode: true });

    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(request.body))).toMatchObject({
      max_tokens: LLM_OUTPUT_TOKENS.providerPreflight,
      response_format: { type: 'json_object' },
    });
    expect(LLM_OUTPUT_TOKENS.providerPreflight).toBeGreaterThanOrEqual(4096);
  });

  it('reports token truncation instead of a generic JSON error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
      status: 200,
      text: async () => JSON.stringify({
        choices: [{
          finish_reason: 'length',
          message: { content: '{"ok":' },
        }],
      }),
    })));

    await expect(requestText({
      protocol: 'chat_completions',
      baseUrl: 'https://provider.example/v1',
      model: 'reasoning-model',
      apiKey: 'test-key',
      timeoutMs: 1000,
      maxRetry: 0,
    }, [{ role: 'user', content: 'Return JSON.' }], {
      maxTokens: LLM_OUTPUT_TOKENS.judge,
      jsonMode: true,
    })).rejects.toMatchObject({
      kind: 'output_truncated',
      message: expect.stringContaining('输出预算'),
    });
  });

  it.each([
    {
      protocol: 'responses' as const,
      data: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      },
    },
    {
      protocol: 'anthropic_messages' as const,
      data: {
        stop_reason: 'max_tokens',
        content: [{ type: 'text', text: '{"ok":' }],
      },
    },
  ])('recognizes $protocol truncation metadata', async ({ protocol, data }) => {
    vi.stubGlobal('fetch', vi.fn(async (..._args: any[]) => ({
      status: 200,
      text: async () => JSON.stringify(data),
    })));

    await expect(requestText({
      protocol,
      baseUrl: 'https://provider.example/v1',
      model: 'reasoning-model',
      apiKey: 'test-key',
      timeoutMs: 1000,
      maxRetry: 0,
    }, [{ role: 'user', content: 'Return JSON.' }])).rejects.toMatchObject({
      kind: 'output_truncated',
    });
  });

  it('gives long structured tasks an 8192-token ceiling', () => {
    expect(LLM_OUTPUT_TOKENS.capture).toBe(8192);
    expect(LLM_OUTPUT_TOKENS.compress).toBe(8192);
    expect(LLM_OUTPUT_TOKENS.meetingPreflight).toBe(8192);
    expect(LLM_OUTPUT_TOKENS.recommendation).toBe(8192);
    expect(LLM_REQUEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it('keeps protocol, URL, and model out of onboarding', () => {
    const source = readFileSync('js/views2.js', 'utf8');
    const onboarding = source.slice(
      source.indexOf('export function onboardingSheet'),
      source.indexOf('export function settingsSheet'),
    );

    expect(onboarding).toContain('文本模型服务');
    expect(onboarding).toContain('ob-provider');
    expect(onboarding).not.toContain('Base URL');
    expect(onboarding).not.toContain('模型名 / Endpoint ID');
    expect(onboarding).not.toContain('Chat Completions');
  });

  it('uses separate secure-storage slots for each provider', () => {
    const source = readFileSync('src/platform/secure.ts', 'utf8');

    expect(source).toContain('llm-api-key-provider-${providerId}');
    expect(source).toContain('TEXT_PROVIDER_IDS.map');
  });

  it('explains when a provider rejects the current network location', () => {
    const error = classifyHttpError(
      400,
      '[{"error":{"message":"User location is not supported for the API use."}}]',
    );

    expect(error.kind).toBe('unsupported_region');
    expect(userMessage(error)).toContain('当前网络位置');
  });
});
