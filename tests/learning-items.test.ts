import { describe, expect, it } from 'vitest';
import {
  isProfessionalTermCandidate,
  learningItemKey,
  normalizeLearningItem,
  termAppearsInSentence,
} from '../src/core/learning-items';
import { buildReviewCue } from '../src/core/review-cue';
import { reviewSupport } from '../src/core/review-support';

const term = {
  kind: 'term' as const,
  skeleton: 'latency',
  zh: '系统响应请求所需的延迟时间',
  lemma: 'latency',
  sense: '系统响应请求所需的延迟时间',
  collocations: ['reduce latency', 'latency budget'],
  anchorSentence: 'We need to reduce latency before the regional rollout.',
  relatedExpressionIds: ['expression-1'],
  domainTags: ['软件架构', '性能'],
};

describe('professional learning terms', () => {
  it('normalizes legacy expressions and term aliases without splitting scheduling data', () => {
    expect(normalizeLearningItem({
      skeleton: 'move from X to Y',
      zh: '从 X 转向 Y',
      box: 2,
    })).toMatchObject({
      kind: 'expression',
      skeleton: 'move from X to Y',
      box: 2,
    });

    expect(normalizeLearningItem({
      ...term,
      skeleton: 'stale',
      zh: '旧义项',
      box: 3,
    })).toMatchObject({
      kind: 'term',
      skeleton: 'latency',
      zh: '系统响应请求所需的延迟时间',
      box: 3,
    });
  });

  it('requires a specific, contextualized professional term', () => {
    expect(isProfessionalTermCandidate(term)).toBe(true);
    expect(isProfessionalTermCandidate({
      ...term,
      lemma: 'important',
      skeleton: 'important',
      anchorSentence: 'This is important.',
    })).toBe(false);
    expect(isProfessionalTermCandidate({
      ...term,
      collocations: ['latency'],
    })).toBe(false);
    expect(termAppearsInSentence('latency', term.anchorSentence)).toBe(true);
  });

  it('deduplicates expressions and terms independently', () => {
    expect(learningItemKey({
      kind: 'expression',
      skeleton: 'Latency',
    })).toBe('expression:latency');
    expect(learningItemKey(term)).toBe('term:latency');
  });

  it('teaches a term through collocations and a full scenario sentence', () => {
    expect(reviewSupport({
      ...term,
      box: 1,
      seeds: [],
    })).toEqual({
      mode: 'guided',
      skeleton: 'latency · reduce latency · latency budget',
      example: term.anchorSentence,
    });

    expect(buildReviewCue({
      ...term,
      box: 1,
      drill: {
        brief: '在接口评审中说明缓存可以降低响应延迟',
        target_zh: '增加本地缓存可以降低关键接口的延迟。',
      },
    }).brief).toContain('一句工作场景英文');
  });
});
