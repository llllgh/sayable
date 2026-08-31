import type { ZodType } from 'zod';
import { LlmError } from './errors';

function stripFence(value: string): string {
  return value
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

export function firstBalancedObject(value: string): string | null {
  const input = stripFence(value);
  const start = input.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < input.length; index += 1) {
    const char = input[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (quoted && char === '\\') {
      escaped = true;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return input.slice(start, index + 1);
    }
  }
  return null;
}

export function parseJsonObject(value: string): unknown {
  const candidate = firstBalancedObject(value);
  if (!candidate) throw new LlmError('invalid_output', 'No JSON object found');
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new LlmError(
      'invalid_output',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function parseStructured<T>(value: string, schema: ZodType<T>): T {
  const parsed = parseJsonObject(value);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new LlmError(
      'invalid_output',
      result.error.issues
        .slice(0, 6)
        .map((issue) => `${issue.path.join('.') || 'root'}: ${issue.message}`)
        .join('; '),
    );
  }
  return result.data;
}
