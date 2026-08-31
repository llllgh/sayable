import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { firstBalancedObject, parseStructured } from '../src/llm/json';

describe('LLM JSON parsing', () => {
  it('removes markdown fences', () => {
    expect(parseStructured('```json\n{"ok":true}\n```', z.object({
      ok: z.boolean(),
    }))).toEqual({ ok: true });
  });

  it('extracts the first balanced object and respects quoted braces', () => {
    const value = 'prefix {"text":"a } brace","nested":{"x":1}} suffix {"ignored":true}';
    expect(firstBalancedObject(value)).toBe('{"text":"a } brace","nested":{"x":1}}');
  });

  it('rejects output that violates the contract', () => {
    expect(() => parseStructured('{"ok":"yes"}', z.object({
      ok: z.boolean(),
    }))).toThrow(/模型输出不符合格式/);
  });
});
