import { describe, expect, it } from 'vitest';
import { skeletonAnchoredInExpression } from '../src/core/capture';
import { captureSchema } from '../src/llm/schemas';

function captureWith(skeleton: string, natural: string) {
  return {
    read: '用户想描述全天讲解后嗓子沙哑但很开心',
    natural,
    spoken: null,
    feedbackKind: 'keep' as const,
    mainIssue: null,
    correction: null,
    alternative: null,
    admission: 'new' as const,
    reuseItemId: null,
    diagnosis: { symptom: null, before: null, after: null },
    primary: {
      skeleton,
      zh: '尽管 X，但 Y',
      trigger: '当辛苦产生了积极结果时，表达虽然疲惫但值得',
      why: '用于同时交代代价和积极感受',
      register: 'casual',
      tags: ['感受'],
      seeds: ['I was exhausted, but it was totally worth it.'],
      native_check: 'yes',
      trap: null,
    },
    bonus: null,
    drill: {
      brief: '说明你讲了一整天，嗓子沙哑，但觉得很值得',
      target_zh: '我讲了一整天，嗓子沙哑了，但这一切很值得',
    },
  };
}

describe('capture contract', () => {
  it('accepts a primary skeleton directly instantiated by natural', () => {
    const value = captureWith(
      'My voice is hoarse from X, but it was totally worth it',
      'My voice is hoarse from talking all day, but it was totally worth it.',
    );

    expect(skeletonAnchoredInExpression(
      value.primary.skeleton,
      value.natural,
    )).toBe(true);
    expect(captureSchema.safeParse(value).success).toBe(true);
  });

  it('rejects a primary skeleton unrelated to natural', () => {
    const value = captureWith(
      'X alone is enough to Y',
      'My voice is hoarse from talking all day, but it was totally worth it.',
    );

    expect(skeletonAnchoredInExpression(
      value.primary.skeleton,
      value.natural,
    )).toBe(false);
    expect(captureSchema.safeParse(value).success).toBe(false);
  });

  it('does not accept fixed words that only appear scattered across sentences', () => {
    expect(skeletonAnchoredInExpression(
      'X alone is enough to Y',
      'I worked alone all day. It is tiring enough to make anyone hoarse.',
    )).toBe(false);
  });

  it('accepts a useful result without inventing a diagnosis or expression', () => {
    expect(captureSchema.safeParse({
      read: '用户的原句已经清楚准确',
      natural: 'We can keep the current plan.',
      spoken: null,
      feedbackKind: 'keep',
      mainIssue: null,
      correction: null,
      alternative: null,
      admission: 'none',
      reuseItemId: null,
      diagnosis: null,
      primary: null,
      bonus: null,
      drill: null,
    }).success).toBe(true);
  });

  it('drops contradictory correction fields from optional feedback', () => {
    const parsed = captureSchema.safeParse({
      read: '原句可用',
      natural: 'We can keep the current plan.',
      spoken: null,
      feedbackKind: 'optional',
      mainIssue: '必须修改',
      correction: null,
      alternative: 'We can stick with the current plan.',
      admission: 'none',
      reuseItemId: null,
      diagnosis: null,
      primary: null,
      bonus: null,
      drill: null,
    });

    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toMatchObject({
        feedbackKind: 'optional',
        mainIssue: null,
        correction: null,
        alternative: 'We can stick with the current plan.',
      });
    }
  });

  it('accepts a professional term only with work-context usage fields', () => {
    const value = captureWith(
      'latency',
      'We need to reduce latency before the regional rollout.',
    );
    const termPrimary = {
      ...value.primary,
      kind: 'term' as const,
      skeleton: 'latency',
      zh: '系统响应请求所需的延迟时间',
      lemma: 'latency',
      sense: '系统响应请求所需的延迟时间',
      collocations: ['reduce latency', 'latency budget'],
      anchorSentence: 'We need to reduce latency before the regional rollout.',
      relatedExpressionIds: [],
      domainTags: ['软件架构', '性能'],
    };

    expect(captureSchema.safeParse({
      ...value,
      primary: termPrimary,
    }).success).toBe(true);
    expect(captureSchema.safeParse({
      ...value,
      primary: {
        ...termPrimary,
        lemma: 'important',
        skeleton: 'important',
        anchorSentence: 'This is important.',
      },
    }).success).toBe(false);
  });
});
