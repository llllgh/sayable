import { z, type ZodType } from 'zod';
import { LlmError } from './errors';
import { parseJsonObject, parseStructured } from './json';
import {
  requestText,
  type LlmMessage,
  type ProviderConfig,
} from './provider';

interface StructuredOptions {
  temperature?: number;
  maxTokens?: number;
  onUsage?: (tokens: number) => void;
}

export interface StructuredResult<T> {
  data: T;
  tokens: number;
}

function validationDetail(error: unknown): string {
  return error instanceof LlmError ? error.detail : String(error);
}

export async function requestStructured<T>(
  config: ProviderConfig,
  messages: LlmMessage[],
  schema: ZodType<T>,
  options: StructuredOptions = {},
): Promise<StructuredResult<T>> {
  const jsonMode = config.protocol !== 'anthropic_messages'
    && config.supportsJsonMode !== false;
  let response;

  try {
    response = await requestText(config, messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      jsonMode,
    });
  } catch (error) {
    if (!(jsonMode && error instanceof LlmError && error.status === 400)) throw error;
    response = await requestText(config, messages, {
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      jsonMode: false,
    });
  }

  try {
    const data = parseStructured(response.text, schema);
    options.onUsage?.(response.tokens);
    return { data, tokens: response.tokens };
  } catch (firstError) {
    const repairMessages: LlmMessage[] = [
      ...messages,
      { role: 'assistant', content: response.text },
      {
        role: 'user',
        content: [
          '上一个输出无法通过 JSON 契约校验。',
          `错误：${validationDetail(firstError)}`,
          '只修复 JSON 格式和字段，不改变答案含义。只输出一个 JSON 对象。',
        ].join('\n'),
      },
    ];
    const repaired = await requestText(config, repairMessages, {
      temperature: 0,
      maxTokens: options.maxTokens,
      jsonMode: false,
    });
    try {
      const data = parseStructured(repaired.text, schema);
      const tokens = response.tokens + repaired.tokens;
      options.onUsage?.(tokens);
      return { data, tokens };
    } catch (error) {
      throw new LlmError('invalid_output', validationDetail(error));
    }
  }
}

const preflightSchema = z.object({ ok: z.literal(true) });

export interface PreflightResult {
  supportsJsonMode: boolean;
  latencyMs: number;
}

export async function preflightProvider(
  config: ProviderConfig,
): Promise<PreflightResult> {
  const startedAt = Date.now();
  const messages: LlmMessage[] = [{
    role: 'user',
    content: 'Reply with exactly this JSON object and nothing else: {"ok":true}',
  }];
  const canProbeJson = config.protocol !== 'anthropic_messages';

  if (canProbeJson) {
    try {
      const response = await requestText(
        { ...config, maxRetry: 0 },
        messages,
        { temperature: 0, maxTokens: 40, jsonMode: true },
      );
      preflightSchema.parse(JSON.parse(response.text.trim()));
      return { supportsJsonMode: true, latencyMs: Date.now() - startedAt };
    } catch (error) {
      if (
        error instanceof LlmError
        && [
          'auth',
          'model',
          'unsupported_region',
          'network',
          'rate_limit',
        ].includes(error.kind)
      ) {
        throw error;
      }
    }
  }

  const fallback = await requestText(
    { ...config, maxRetry: 0 },
    messages,
    { temperature: 0, maxTokens: 40, jsonMode: false },
  );
  preflightSchema.parse(parseJsonObject(fallback.text));
  return { supportsJsonMode: false, latencyMs: Date.now() - startedAt };
}
