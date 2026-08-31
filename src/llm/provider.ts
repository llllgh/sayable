import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { LlmError, classifyHttpError } from './errors';

export type LlmProtocol =
  | 'chat_completions'
  | 'responses'
  | 'anthropic_messages';

export interface ProviderConfig {
  protocol: LlmProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetry: number;
  supportsJsonMode?: boolean | null;
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  text: string;
  tokens: number;
}

interface RequestOptions {
  temperature?: number;
  maxTokens?: number;
  jsonMode?: boolean;
}

interface HttpResult {
  status: number;
  data: unknown;
}

function endpoint(baseUrl: string, suffix: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (base.endsWith(`/${suffix}`)) return base;
  return `${base}/${suffix}`;
}

function jsonHeaders(config: ProviderConfig): Record<string, string> {
  if (config.protocol === 'anthropic_messages') {
    return {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    };
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };
}

function requestBody(
  config: ProviderConfig,
  messages: LlmMessage[],
  options: RequestOptions,
): Record<string, unknown> {
  const temperature = options.temperature ?? 0.35;
  const maxTokens = options.maxTokens ?? 1600;

  if (config.protocol === 'responses') {
    const system = messages
      .filter((message) => message.role === 'system')
      .map((message) => message.content)
      .join('\n\n');
    const body: Record<string, unknown> = {
      model: config.model,
      input: messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content })),
      max_output_tokens: maxTokens,
    };
    if (system) body.instructions = system;
    if (options.jsonMode) {
      body.text = {
        format: {
          type: 'json_schema',
          name: 'sayable_output',
          strict: false,
          schema: { type: 'object', additionalProperties: true },
        },
      };
    }
    return body;
  }

  if (config.protocol === 'anthropic_messages') {
    return {
      model: config.model,
      system: messages
        .filter((message) => message.role === 'system')
        .map((message) => message.content)
        .join('\n\n'),
      messages: messages
        .filter((message) => message.role !== 'system')
        .map((message) => ({ role: message.role, content: message.content })),
      temperature,
      max_tokens: maxTokens,
    };
  }

  return {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
}

function requestUrl(config: ProviderConfig): string {
  if (config.protocol === 'responses') return endpoint(config.baseUrl, 'responses');
  if (config.protocol === 'anthropic_messages') return endpoint(config.baseUrl, 'messages');
  return endpoint(config.baseUrl, 'chat/completions');
}

async function httpPost(
  url: string,
  headers: Record<string, string>,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<HttpResult> {
  if (Capacitor.isNativePlatform()) {
    const response = await CapacitorHttp.request({
      method: 'POST',
      url,
      headers,
      data: body,
      connectTimeout: timeoutMs,
      readTimeout: timeoutMs,
    });
    return { status: response.status, data: response.data };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const raw = await response.text();
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      // Error responses from gateways are sometimes plain text.
    }
    return { status: response.status, data };
  } finally {
    clearTimeout(timeout);
  }
}

function stringifyDetail(data: unknown): string {
  if (typeof data === 'string') return data.slice(0, 800);
  try {
    return JSON.stringify(data).slice(0, 800);
  } catch {
    return String(data).slice(0, 800);
  }
}

function extractText(config: ProviderConfig, data: any): string {
  if (config.protocol === 'responses') {
    if (typeof data?.output_text === 'string') return data.output_text;
    const parts = (data?.output || [])
      .flatMap((entry: any) => entry?.content || [])
      .map((entry: any) => entry?.text ?? entry?.value ?? '')
      .filter(Boolean);
    return parts.join('');
  }
  if (config.protocol === 'anthropic_messages') {
    return (data?.content || [])
      .map((entry: any) => entry?.text || '')
      .filter(Boolean)
      .join('');
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((entry) => entry?.text || '').filter(Boolean).join('');
  }
  return '';
}

function extractTokens(data: any): number {
  return Number(
    data?.usage?.total_tokens
    ?? data?.usage?.totalTokens
    ?? (
      Number(data?.usage?.input_tokens ?? 0)
      + Number(data?.usage?.output_tokens ?? 0)
    ),
  ) || 0;
}

function canRetry(error: unknown): boolean {
  return error instanceof LlmError
    && (error.kind === 'network' || error.kind === 'rate_limit');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function requestText(
  config: ProviderConfig,
  messages: LlmMessage[],
  options: RequestOptions = {},
): Promise<LlmResponse> {
  if (!config.baseUrl || !config.apiKey || !config.model) {
    throw new LlmError('configuration');
  }

  const attempts = Math.max(0, config.maxRetry) + 1;
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const result = await httpPost(
        requestUrl(config),
        jsonHeaders(config),
        requestBody(config, messages, options),
        config.timeoutMs,
      );
      if (result.status < 200 || result.status >= 300) {
        throw classifyHttpError(result.status, stringifyDetail(result.data));
      }
      const text = extractText(config, result.data);
      if (!text.trim()) {
        throw new LlmError('invalid_output', 'Provider returned an empty response');
      }
      return { text, tokens: extractTokens(result.data) };
    } catch (error) {
      lastError = error instanceof LlmError
        ? error
        : new LlmError(
          'network',
          error instanceof Error ? error.message : String(error),
        );
      if (!canRetry(lastError) || attempt === attempts - 1) throw lastError;
      await sleep(500 * (2 ** attempt));
    }
  }
  throw lastError;
}
