import { describe, expect, it } from 'vitest';
import { skeletonAnchoredInExpression } from '../src/core/capture';
import { captureSchema } from '../src/llm/schemas';

function captureWith(skeleton: string, natural: string) {
  return {
    read: '用户想描述全天讲解后嗓子沙哑但很开心',
    natural,
    spoken: null,
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
});
