import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createCompressionRecord,
  normalizeCompressionRecord,
} from '../src/core/compressions';

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
    });
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
    expect(compressionView).not.toMatch(/onGraded:\s*\(\)\s*=>\s*go\('home'\)/);
  });
});
