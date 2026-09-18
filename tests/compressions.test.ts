import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createCompressionRecord,
  normalizeCompressionRecord,
} from '../src/core/compressions';
import { restatementSchema } from '../src/llm/schemas';

describe('compression history records', () => {
  it('preserves the complete result for later reuse', () => {
    const record = createCompressionRecord({
      id: 'compression-1',
      at: 100,
      long: '  A deliberately long original expression.  ',
      longWords: 6,
      shortWords: 4,
      result: {
        short: 'A shorter expression.',
        kept: '保留原意',
        symptom: '铺垫过长',
        cuts: [{ what: '重复铺垫', why: '核心动词已经包含这层意思' }],
        patterns: [{
          skeleton: 'shift from X to Y',
          zh: '从 X 转向 Y',
          trigger: '当讨论重点发生变化时，明确说明转移方向',
          why: '直接表达变化',
          seeds: ['The focus shifted from speed to quality.'],
        }],
      },
    });

    expect(record.long).toBe('A deliberately long original expression.');
    expect(record.cuts).toHaveLength(1);
    expect(record.patterns[0]).toMatchObject({
      skeleton: 'shift from X to Y',
      zh: '从 X 转向 Y',
      trigger: '当讨论重点发生变化时，明确说明转移方向',
    });
    expect(record.practiceAttempts).toEqual([]);
  });

  it('keeps legacy skeleton-only history usable', () => {
    const record = normalizeCompressionRecord({
      id: 'legacy',
      at: 50,
      long: 'The original expression remains available.',
      short: 'The expression remains available.',
      longWords: 5,
      shortWords: 4,
      patterns: ['remain available for X'],
    });

    expect(record?.patterns).toEqual([{
      skeleton: 'remain available for X',
      zh: '',
      trigger: '',
      why: '',
      seeds: [],
    }]);
    expect(record?.cuts).toEqual([]);
  });

  it('ignores malformed imported history entries', () => {
    expect(normalizeCompressionRecord(null)).toBeNull();
    expect(normalizeCompressionRecord({ long: '', short: '' })).toBeNull();
  });

  it('keeps collection and history actions inside the compression workspace', () => {
    const source = readFileSync('js/views2.js', 'utf8');
    const compressionView = source.slice(
      source.indexOf('export function viewCompress'),
      source.indexOf('/* ---------------------------------------------------------------- 会前热身 */'),
    );

    expect(compressionView).toContain('data-compression=');
    expect(compressionView).toContain('data-reuse="long"');
    expect(compressionView).toContain('id="cp-practice"');
    expect(compressionView).toContain('L.judgeRestatement');
    expect(compressionView).toContain('S.recordCompressionPracticeAttempt');
    expect(compressionView).not.toMatch(/onGraded:\s*\(\)\s*=>\s*go\('home'\)/);
  });

  it('validates keep, correction, and optional restatement feedback', () => {
    const base = {
      ok: true,
      meaning_intact: true,
      verdict: '已经说清楚了。',
      note: '',
    };
    expect(restatementSchema.safeParse({
      ...base,
      feedback_kind: 'keep',
      main_issue: null,
      fix: null,
      tighter: null,
    }).success).toBe(true);
    expect(restatementSchema.safeParse({
      ...base,
      feedback_kind: 'correct',
      main_issue: '遗漏了条件',
      fix: null,
      tighter: null,
    }).success).toBe(false);
    expect(restatementSchema.safeParse({
      ...base,
      feedback_kind: 'optional',
      main_issue: null,
      fix: null,
      tighter: 'We can start small and scale later.',
    }).success).toBe(true);
  });
});
