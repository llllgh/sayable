import { describe, expect, it } from 'vitest';
import {
  expressionMatchesQuery,
  normalizeRecordStatus,
  recordMatchesQuery,
  recordNeedsAttention,
} from '../src/core/library';

describe('expression library search and record states', () => {
  it('searches expression meaning, skeleton, source, and examples locally', () => {
    const item = {
      skeleton: 'move from X to Y',
      zh: '从 X 转向 Y',
      source: { raw: 'We should shift the rollout plan.' },
      seeds: ['The focus moved from speed to quality.'],
    };

    expect(expressionMatchesQuery(item, '转向')).toBe(true);
    expect(expressionMatchesQuery(item, 'ROLLOUT')).toBe(true);
    expect(expressionMatchesQuery(item, 'quality')).toBe(true);
    expect(expressionMatchesQuery(item, 'budget')).toBe(false);
  });

  it('searches original record text and cached analysis', () => {
    const record = {
      text: '提醒客户确认交付日期',
      analysis: {
        natural: 'Could you confirm the delivery date?',
        primary: { skeleton: 'Could you confirm X?' },
      },
    };

    expect(recordMatchesQuery(record, '交付')).toBe(true);
    expect(recordMatchesQuery(record, 'confirm x')).toBe(true);
    expect(recordMatchesQuery(record, 'pricing')).toBe(false);
  });

  it('searches professional term meaning, collocations, and domain tags', () => {
    const item = {
      kind: 'term',
      lemma: 'latency',
      sense: '系统响应请求所需的延迟时间',
      collocations: ['reduce latency', 'latency budget'],
      anchorSentence: 'We need to reduce latency before launch.',
      domainTags: ['软件架构', '性能'],
    };

    expect(expressionMatchesQuery(item, '延迟时间')).toBe(true);
    expect(expressionMatchesQuery(item, 'latency budget')).toBe(true);
    expect(expressionMatchesQuery(item, '软件架构')).toBe(true);
  });

  it('maps legacy done records to pending review and keeps handled records out of attention', () => {
    expect(normalizeRecordStatus('done')).toBe('ready');
    expect(normalizeRecordStatus('unknown')).toBe('raw');
    expect(recordNeedsAttention('ready')).toBe(true);
    expect(recordNeedsAttention('handled')).toBe(false);
  });
});
