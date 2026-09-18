import { describe, expect, it } from 'vitest';
import {
  captureSchema,
  compressSchema,
  preflightSchema,
} from '../src/llm/schemas';

describe('communicative intent trigger', () => {
  it('is required for every model-generated expression source', () => {
    const capture = {
      read: '用户希望提出分阶段上线',
      natural: 'A good starting point would be to pilot this before scaling up.',
      spoken: null,
      feedbackKind: 'keep',
      mainIssue: null,
      correction: null,
      alternative: null,
      admission: 'new',
      reuseItemId: null,
      diagnosis: { symptom: null, before: null, after: null },
      primary: {
        skeleton: 'A good starting point would be to X before Y',
        zh: '先做 X，再做 Y',
        trigger: '当对方担心一次性投入过大时，提出先小范围试点',
        why: '用于给出低风险的推进路径',
        register: 'meeting',
        tags: [],
        seeds: [],
        native_check: 'yes',
        trap: null,
      },
      bonus: null,
      drill: {
        brief: '建议先在一个部门试点，再推广到整个组织',
        target_zh: '一个稳妥的起点是先在一个部门试点，再推广到整个组织',
      },
    };
    expect(captureSchema.safeParse(capture).success).toBe(true);
    expect(captureSchema.safeParse({
      ...capture,
      primary: { ...capture.primary, trigger: ' ' },
    }).success).toBe(false);

    expect(captureSchema.safeParse({
      ...capture,
      bonus: {
        skeleton: 'X alone would be enough to Y',
        zh: '仅凭 X 就足以 Y',
        trigger: '当需要强调单一证据已经足够时，用它得出结论',
        why: '适合强调决定性证据',
        register: 'meeting',
        tags: ['强调'],
        seeds: ['The demo alone would be enough to convince them.'],
        drill: {
          brief: '说明仅凭试点结果就足以支持扩大范围',
          target_zh: '仅凭试点结果就足以支持扩大范围',
        },
      },
    }).success).toBe(true);

    expect(captureSchema.safeParse({
      ...capture,
      bonus: {
        skeleton: 'X alone would be enough to Y',
        zh: '仅凭 X 就足以 Y',
      },
    }).success).toBe(false);

    const compression = {
      short: 'Start with one team before scaling.',
      patterns: [{
        skeleton: 'Start with X before Y',
        zh: '先做 X，再做 Y',
        trigger: '当方案范围过大时，提出缩小第一步',
      }],
    };
    expect(compressSchema.safeParse(compression).success).toBe(true);
    expect(compressSchema.safeParse({
      ...compression,
      patterns: [{ ...compression.patterns[0], trigger: '' }],
    }).success).toBe(false);

    const preflight = {
      reuse: [],
      fresh: [{
        skeleton: 'Start with X before Y',
        zh: '先做 X，再做 Y',
        trigger: '当客户担心风险时，提出分阶段推进',
      }],
    };
    expect(preflightSchema.safeParse(preflight).success).toBe(true);
    expect(preflightSchema.safeParse({
      ...preflight,
      fresh: [{ ...preflight.fresh[0], trigger: '' }],
    }).success).toBe(false);
  });
});
