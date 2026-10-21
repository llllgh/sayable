import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { z } from 'zod';
import { requestText, type ProviderConfig } from '../src/llm/provider';
import { preflightProvider, requestStructured } from '../src/llm/client';

vi.mock('@capacitor/core', async (importOriginal) => {
  const original = await importOriginal<typeof import('@capacitor/core')>();
  return { ...original, CapacitorHttp: { request: vi.fn() } };
});

const config: ProviderConfig = {
  protocol: 'gemini',
  baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
  model: 'gemini-3.8-flash',
  apiKey: 'test-google-key',
  timeoutMs: 1000,
  maxRetry: 0,
};
const messages = [{ role: 'user' as const, content: 'Return JSON.' }];
const schema = z.object({ ok: z.literal(true) });
const completed = (text = '{"ok":true}', totalTokenCount = 12) => ({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
  usageMetadata: { totalTokenCount },
});
const http = (data: unknown, status = 200) => ({
  status, text: async () => JSON.stringify(data),
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Gemini native protocol', () => {
  it('keeps system instructions and multi-turn history when repairing JSON', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(http(completed('{"ok":"wrong"}', 30)))
      .mockResolvedValueOnce(http(completed('{"ok":true}', 15)));
    vi.stubGlobal('fetch', fetchMock);
    const result = await requestStructured(config, [
      { role: 'system', content: '第一条系统规则' },
      { role: 'system', content: '第二条系统规则' },
      { role: 'user', content: 'Start.' },
      { role: 'assistant', content: 'Ready.' },
      { role: 'user', content: 'Continue.' },
    ], schema, { maxTokens: 2048 });
    expect(result).toEqual({ data: { ok: true }, tokens: 45 });
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.systemInstruction).toEqual({ parts: [{ text: '第一条系统规则\n\n第二条系统规则' }] });
    expect(body.contents.map((turn: { role: string }) => turn.role))
      .toEqual(['user', 'model', 'user', 'model', 'user']);
    expect(body.contents[3].parts).toEqual([{ text: '{"ok":"wrong"}' }]);
    expect(body.contents[4].parts[0].text).toContain('JSON 契约校验');
    expect(body.generationConfig.maxOutputTokens).toBe(2048);
    expect(body).not.toHaveProperty('messages');
    expect(body).not.toHaveProperty('model');
  });

  it('does not mix thinking summaries or a second candidate into the JSON answer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(http({
      candidates: [
        { finishReason: 'STOP', content: { parts: [
          { text: 'Internal summary', thought: true },
          { text: '{"ok":' }, { text: 'true}' },
        ] } },
        { finishReason: 'STOP', content: { parts: [{ text: '{"ok":false}' }] } },
      ],
      usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 5, thoughtsTokenCount: 6 },
    })));
    await expect(requestStructured(config, messages, schema))
      .resolves.toEqual({ data: { ok: true }, tokens: 15 });
  });

  it('probes JSON mode and falls back to plain output when the endpoint rejects it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(http({ error: { message: 'Unsupported responseMimeType' } }, 400))
      .mockResolvedValueOnce(http(completed()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(preflightProvider(config)).resolves.toMatchObject({ supportsJsonMode: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.responseMimeType)
      .toBe('application/json');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).generationConfig)
      .not.toHaveProperty('responseMimeType');
  });

  it('uses native JSON mode for preflight without changing the request budget', async () => {
    const fetchMock = vi.fn().mockResolvedValue(http(completed()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(preflightProvider(config)).resolves.toMatchObject({ supportsJsonMode: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).generationConfig.maxOutputTokens)
      .toBe(4096);
  });

  it('retries a rejected JSON mode in structured calls and honors a stored opt-out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(http({ error: { message: 'Unsupported responseMimeType' } }, 400))
      .mockResolvedValueOnce(http(completed()))
      .mockResolvedValueOnce(http(completed()));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestStructured(config, messages, schema))
      .resolves.toMatchObject({ data: { ok: true } });
    await requestStructured({ ...config, supportsJsonMode: false }, messages, schema);
    for (const index of [1, 2]) {
      expect(JSON.parse(fetchMock.mock.calls[index][1].body).generationConfig)
        .not.toHaveProperty('responseMimeType');
    }
  });

  it.each([
    { promptFeedback: { blockReason: 'SAFETY' } },
    { candidates: [{ finishReason: 'SAFETY', content: { parts: [{ text: 'Partial answer' }] } }] },
    { candidates: [{ finishReason: 'RECITATION' }] },
  ])('reports blocked content without treating it as a JSON repair request: %j', async (data) => {
    const fetchMock = vi.fn().mockResolvedValue(http(data));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestStructured(config, messages, schema))
      .rejects.toMatchObject({ kind: 'blocked_output' });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('rejects empty and incomplete responses without inventing an answer', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(http({ candidates: [] }))
      .mockResolvedValueOnce(http({
        candidates: [{ finishReason: 'OTHER', content: { parts: [{ text: '{"ok":true}' }] } }],
      }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(requestText(config, messages)).rejects.toMatchObject({ kind: 'invalid_output' });
    await expect(requestText(config, messages)).rejects.toMatchObject({ kind: 'invalid_output' });
  });

  it.each([
    { status: 400, data: { error: { message: 'API key not valid.', details: [{ reason: 'API_KEY_INVALID' }] } }, kind: 'auth' },
    { status: 403, data: { error: { message: 'User location is not supported for the API use.' } }, kind: 'unsupported_region' },
    { status: 404, data: { error: { message: 'Model not found' } }, kind: 'model' },
    { status: 429, data: { error: { status: 'RESOURCE_EXHAUSTED' } }, kind: 'rate_limit' },
  ])('classifies native HTTP $status as $kind', async ({ status, data, kind }) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(http(data, status)));
    await expect(requestText(config, messages)).rejects.toMatchObject({ kind, status });
  });

  it('normalizes models prefixes and joins adjacent user turns', async () => {
    const fetchMock = vi.fn().mockResolvedValue(http(completed()));
    vi.stubGlobal('fetch', fetchMock);
    await requestText({
      ...config, baseUrl: `${config.baseUrl}/models/`, model: `models/${config.model}`,
    }, [...messages, { role: 'user', content: 'Additional context.' }]);
    expect(fetchMock.mock.calls[0][0])
      .toBe(`${config.baseUrl}/models/${config.model}:generateContent`);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).contents).toEqual([
      { role: 'user', parts: [{ text: 'Return JSON.' }, { text: 'Additional context.' }] },
    ]);
  });

  it('uses the same native wire format and key header on Android', async () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    const nativeHttp = vi.mocked(CapacitorHttp.request).mockResolvedValue({
      status: 200, data: completed(), headers: {}, url: '',
    });
    await expect(requestText(config, messages, { jsonMode: true }))
      .resolves.toEqual({ text: '{"ok":true}', tokens: 12 });
    expect(nativeHttp).toHaveBeenCalledWith(expect.objectContaining({
      url: `${config.baseUrl}/models/${config.model}:generateContent`,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': 'test-google-key' },
      data: expect.objectContaining({
        contents: [{ role: 'user', parts: [{ text: 'Return JSON.' }] }],
        generationConfig: expect.objectContaining({ responseMimeType: 'application/json' }),
      }),
    }));
  });
});
