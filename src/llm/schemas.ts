import { z } from 'zod';
import { skeletonAnchoredInExpression } from '../core/capture';
import { drillDiffersFromExample } from '../core/recommendations';
import {
  isProfessionalTermCandidate,
  isTermCandidate,
  learningItemKey,
  normalizeLearningItemKind,
  normalizeTermCategory,
  termAppearsInSentence,
} from '../core/learning-items';
import { sourceCandidateGrounded } from '../core/source-import';
import { normalizeProblemTags, type ProblemEvidence } from '../core/expression-problems';

const nullableText = z.string().nullable().optional();
const nullWhenMissing = (field: string) => (value: unknown) => (
  typeof value === 'string'
    ? null
    : value
  && typeof value === 'object'
  && !Array.isArray(value)
  && !String((value as Record<string, unknown>)[field] || '').trim()
    ? null
    : value
);

const capturePrimarySchema = z.object({
  kind: z.enum(['expression', 'term']).default('expression'),
  skeleton: z.string().min(1),
  zh: z.string().min(1),
  lemma: nullableText,
  sense: nullableText,
  collocations: z.array(z.string()).max(6).catch([]),
  anchorSentence: nullableText,
  relatedExpressionIds: z.array(z.string()).max(12).catch([]),
  domainTags: z.array(z.string()).max(6).catch([]),
  trigger: z.string().trim().min(1),
  why: z.string().min(1),
  register: z.enum(['meeting', 'email', 'casual']).catch('meeting'),
  tags: z.array(z.string()).max(6).catch([]),
  seeds: z.array(z.string()).max(6).catch([]),
  native_check: z.string().catch('risky'),
  trap: nullableText,
});

const captureDrillSchema = z.object({
  brief: z.string().min(1),
  target_zh: z.string().catch(''),
});

export const captureSchema = z.object({
  mode: z.enum(['zh', 'mine', 'heard', 'fragment']).optional(),
  read: z.string().min(1),
  natural: z.string().min(1),
  spoken: nullableText,
  feedbackKind: z.enum(['keep', 'correct', 'optional']),
  mainIssue: nullableText,
  correction: nullableText,
  alternative: nullableText,
  admission: z.enum(['none', 'reuse', 'new']),
  reuseItemId: nullableText,
  diagnosis: z.preprocess(nullWhenMissing('symptom'), z.object({
    symptom: nullableText,
    before: nullableText,
    after: nullableText,
  }).nullable().optional()),
  primary: z.preprocess(
    nullWhenMissing('skeleton'),
    capturePrimarySchema.nullable().optional(),
  ),
  bonus: z.preprocess(nullWhenMissing('skeleton'), z.object({
    skeleton: z.string().min(1),
    zh: z.string().min(1),
    trigger: z.string().trim().min(1),
    why: z.string().trim().min(1),
    register: z.enum(['meeting', 'email', 'casual']).catch('meeting'),
    tags: z.array(z.string()).max(3).catch([]),
    seeds: z.array(z.string()).min(1).max(3),
    drill: z.object({
      brief: z.string().trim().min(1),
      target_zh: z.string().trim().min(1),
    }).strict(),
  }).nullable().optional()),
  drill: z.preprocess(
    nullWhenMissing('brief'),
    captureDrillSchema.nullable().optional(),
  ),
}).passthrough().transform((value) => {
  if (value.feedbackKind === 'keep') {
    value.mainIssue = null;
    value.correction = null;
    value.alternative = null;
  } else if (value.feedbackKind === 'optional') {
    value.mainIssue = null;
    value.correction = null;
  } else {
    value.alternative = null;
  }
  if (value.admission === 'none') {
    value.primary = null;
    value.bonus = null;
    value.drill = null;
    value.reuseItemId = null;
  } else if (value.admission === 'reuse') {
    value.primary = null;
    value.drill = null;
  } else {
    value.reuseItemId = null;
  }
  return value;
}).superRefine((value, context) => {
  const mainIssue = String(value.mainIssue || '').trim();
  const correction = String(value.correction || '').trim();
  const alternative = String(value.alternative || '').trim();
  const reuseItemId = String(value.reuseItemId || '').trim();

  if (value.feedbackKind === 'keep' && (mainIssue || correction)) {
    context.addIssue({
      code: 'custom',
      path: ['feedbackKind'],
      message: 'keep feedback cannot contain a required correction',
    });
  }
  if (value.feedbackKind === 'correct' && (!mainIssue || !correction)) {
    context.addIssue({
      code: 'custom',
      path: ['correction'],
      message: 'correct feedback requires one main issue and a correction',
    });
  }
  if (
    value.feedbackKind === 'optional'
    && (mainIssue || correction || !alternative)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['alternative'],
      message: 'optional feedback requires only an optional alternative',
    });
  }
  if (value.admission === 'none' && (value.primary || reuseItemId)) {
    context.addIssue({
      code: 'custom',
      path: ['admission'],
      message: 'none admission cannot include an expression',
    });
  }
  if (value.admission === 'reuse' && (!reuseItemId || value.primary)) {
    context.addIssue({
      code: 'custom',
      path: ['reuseItemId'],
      message: 'reuse admission requires only an existing item id',
    });
  }
  if (value.admission === 'new' && (!value.primary || !value.drill)) {
    context.addIssue({
      code: 'custom',
      path: ['primary'],
      message: 'new admission requires a primary expression and drill',
    });
  }
  if (
    value.admission === 'new'
    && value.primary
    && normalizeLearningItemKind(value.primary.kind) === 'expression'
    && !skeletonAnchoredInExpression(value.primary.skeleton, value.natural)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['primary', 'skeleton'],
      message: 'primary skeleton must be directly instantiated by natural',
    });
  }
  if (
    value.admission === 'new'
    && value.primary
    && normalizeLearningItemKind(value.primary.kind) === 'term'
    && !isProfessionalTermCandidate(value.primary)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['primary'],
      message: 'term admission requires a specific professional term with usage context',
    });
  }
});

export const reviewCueSchema = z.object({
  brief: z.string().trim().min(1),
  target_zh: z.string().trim().min(1),
  trigger: z.string().trim().min(1),
  answer: z.string().trim().min(1),
}).strict();

export function reviewCueSchemaFor(item: {
  kind?: unknown;
  skeleton?: unknown;
  lemma?: unknown;
  anchorSentence?: unknown;
  seeds?: unknown;
  drill?: unknown;
}) {
  return reviewCueSchema.superRefine((value, context) => {
    const references = [
      item.anchorSentence,
      ...(Array.isArray(item.seeds) ? item.seeds : []),
    ].filter(reference => String(reference || '').trim());
    if (references.some(reference => (
      !drillDiffersFromExample(reference, value.answer)
    ))) {
      context.addIssue({
        code: 'custom',
        path: ['answer'],
        message: 'review cue must transfer the target to a different scenario',
      });
    }

    const currentDrill = item.drill && typeof item.drill === 'object'
      ? item.drill as Record<string, unknown>
      : null;
    if (
      currentDrill?.target_zh
      && !drillDiffersFromExample(currentDrill.target_zh, value.target_zh)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['target_zh'],
        message: 'regenerated review cue must differ from the current task',
      });
    }

    const kind = normalizeLearningItemKind(item.kind);
    if (
      kind === 'term'
      && !termAppearsInSentence(
        String(item.lemma || item.skeleton || ''),
        value.answer,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answer'],
        message: 'term review answer must use the target term',
      });
    }
    if (
      kind === 'expression'
      && !skeletonAnchoredInExpression(
        String(item.skeleton || ''),
        value.answer,
      )
    ) {
      context.addIssue({
        code: 'custom',
        path: ['answer'],
        message: 'expression review answer must instantiate the target skeleton',
      });
    }
  });
}

export function problemCueSchemaFor(
  item: Parameters<typeof reviewCueSchemaFor>[0], evidence: ProblemEvidence[],
) {
  return reviewCueSchemaFor({
    ...item, seeds: [...(Array.isArray(item.seeds) ? item.seeds : []),
      ...evidence.flatMap(entry => [entry.answer, entry.suggestion]).filter(Boolean)],
  }).superRefine((value, context) => {
    for (const field of ['brief', 'target_zh', 'trigger'] as const) {
      if (!/[\u3400-\u9fff]/u.test(value[field]) || /[A-Za-z]{2,}/u.test(value[field])) {
        context.addIssue({ code: 'custom', path: [field], message: 'task must use Chinese without revealing the English target' });
      }
    }
    if (evidence.some(entry =>
      (entry.targetZh && !drillDiffersFromExample(entry.targetZh, value.target_zh))
      || (entry.brief && !drillDiffersFromExample(entry.brief, value.brief)))) {
      context.addIssue({ code: 'custom', path: ['brief'], message: 'problem practice must differ from evidence tasks' });
    }
  });
}

export const judgeSchema = z.object({
  ok: z.boolean(),
  used_target: z.boolean(),
  meaning_intact: z.boolean(),
  issue_level: z.enum(['none', 'minor', 'blocking']),
  feedback_kind: z.string().catch(''),
  main_issue: nullableText,
  verdict: z.string().min(1),
  fix: nullableText,
  tighter: nullableText,
  note: z.string().catch(''),
  problem_tags: z.unknown().optional().transform(normalizeProblemTags),
}).passthrough().transform((value) => ({
  ...value,
  feedback_kind: String(value.fix || '').trim()
    ? 'correct' as const
    : String(value.tighter || '').trim()
      ? 'optional' as const
      : 'keep' as const,
})).superRefine((value, context) => {
  const fix = String(value.fix || '').trim();
  if (value.issue_level === 'none' && fix) {
    context.addIssue({
      code: 'custom',
      path: ['fix'],
      message: 'fix must be null when issue_level is none',
    });
  }
  const mainIssue = String(value.main_issue || '').trim();
  if (value.feedback_kind === 'keep' && (mainIssue || fix)) {
    context.addIssue({
      code: 'custom',
      path: ['feedback_kind'],
      message: 'keep feedback cannot contain a required correction',
    });
  }
  if (value.feedback_kind === 'correct' && (!mainIssue || !fix)) {
    context.addIssue({
      code: 'custom',
      path: ['feedback_kind'],
      message: 'correct feedback requires a substantive correction',
    });
  }
  if (
    value.feedback_kind === 'optional'
    && (mainIssue || fix || !String(value.tighter || '').trim())
  ) {
    context.addIssue({
      code: 'custom',
      path: ['feedback_kind'],
      message: 'optional feedback requires only a valid optional alternative',
    });
  }
});

export const restatementSchema = z.object({
  ok: z.boolean(),
  meaning_intact: z.boolean(),
  feedback_kind: z.string().catch(''),
  main_issue: nullableText,
  verdict: z.string().trim().min(1),
  fix: nullableText,
  tighter: nullableText,
  note: z.string().catch(''),
}).strict().transform((value) => ({
  ...value,
  feedback_kind: String(value.fix || '').trim()
    ? 'correct' as const
    : String(value.tighter || '').trim()
      ? 'optional' as const
      : 'keep' as const,
})).superRefine((value, context) => {
  const mainIssue = String(value.main_issue || '').trim();
  const fix = String(value.fix || '').trim();
  const tighter = String(value.tighter || '').trim();
  if (value.feedback_kind === 'keep' && (mainIssue || fix)) {
    context.addIssue({
      code: 'custom',
      path: ['feedback_kind'],
      message: 'keep feedback cannot contain a required correction',
    });
  }
  if (value.feedback_kind === 'correct' && (!mainIssue || !fix)) {
    context.addIssue({
      code: 'custom',
      path: ['feedback_kind'],
      message: 'correct feedback requires one correction',
    });
  }
  if (value.feedback_kind === 'optional' && (mainIssue || fix || !tighter)) {
    context.addIssue({
      code: 'custom',
      path: ['feedback_kind'],
      message: 'optional feedback requires only an optional alternative',
    });
  }
});

export const compressSchema = z.object({
  short: z.string().min(1),
  kept: z.string().catch(''),
  cuts: z.array(z.object({
    what: z.string(),
    why: z.string(),
  })).max(6).catch([]),
  symptom: z.string().catch(''),
  patterns: z.array(z.object({
    skeleton: z.string().min(1),
    zh: z.string().catch(''),
    trigger: z.string().trim().min(1),
    why: z.string().catch(''),
    seeds: z.array(z.string()).catch([]),
  })).max(2),
}).passthrough();

export const preflightSchema = z.object({
  reuse: z.array(z.object({
    id: z.string(),
    reason: z.string().catch(''),
    drill: z.string().catch(''),
  })).catch([]),
  fresh: z.array(z.object({
    skeleton: z.string().min(1),
    zh: z.string().catch(''),
    trigger: z.string().trim().min(1),
    why: z.string().catch(''),
    seeds: z.array(z.string()).catch([]),
    drill: z.string().catch(''),
  })).max(2).default([]),
  avoid: z.string().catch(''),
}).passthrough();

const sourceCandidateSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const item = raw as Record<string, unknown>;
  if (item.kind !== 'term' || typeof item.lemma !== 'string' || !item.lemma.trim()) return raw;
  return { ...item, skeleton: item.lemma.trim() };
}, z.object({
  kind: z.enum(['expression', 'term']).default('expression'),
  termCategory: z.enum(['professional', 'precision', 'everyday'])
    .nullable()
    .optional(),
  skeleton: z.string().trim().min(1),
  zh: z.string().trim().min(1),
  lemma: nullableText,
  sense: nullableText,
  quote: z.string().trim().min(12),
  suggestedGoal: z.enum(['recognition', 'production']).catch('production'),
  goalReason: z.string().catch(''),
}).passthrough());

export function sourceExtractionSchemaFor(sourceChunk: string) {
  return z.object({
    items: z.array(z.unknown()),
  }).passthrough().transform((value) => {
    const keys = new Set<string>();
    const items = value.items.flatMap(raw => {
      const parsed = sourceCandidateSchema.safeParse(raw);
      return parsed.success ? [parsed.data] : [];
    }).filter((item) => {
      const key = learningItemKey(item);
      if (!key || keys.has(key)) return false;
      if (
        (item.kind === 'term'
          && (!String(item.lemma || '').trim() || !String(item.sense || '').trim()
            || !/[\u3400-\u9fff]/u.test(String(item.sense))))
        || !/[\u3400-\u9fff]/u.test(item.zh)
      ) {
        return false;
      }
      if (!sourceCandidateGrounded(item, sourceChunk)) return false;
      keys.add(key);
      return true;
    });
    return { items: items.slice(0, 24), filteredCount: value.items.length - Math.min(items.length, 24) };
  });
}

export function vocabularyMaterialSchemaFor(item: any) {
  const base = z.object({
    usage: z.string().trim().min(1),
    sentence: z.string().trim().min(12),
    explanation: z.string().trim().min(1),
    collocations: z.array(z.string()).max(4).catch([]),
    anchorSentence: z.string().catch(''),
    trigger: z.string().catch(''),
    drill: z.object({
      brief: z.string().trim().min(1),
      target_zh: z.string().trim().min(1),
      answer: z.string().trim().min(1),
    }).nullable().optional(),
  }).superRefine((material, ctx) => {
    if (!/[\u3400-\u9fff]/u.test(material.usage) || !/[\u3400-\u9fff]/u.test(material.explanation)) {
      ctx.addIssue({ code: 'custom', message: '用法与理解解释必须使用中文' });
    }
    const target = item.lemma || item.skeleton;
    const sources = [item.source?.raw, item.anchorSentence].filter(Boolean);
    if (sources.some(source => !drillDiffersFromExample(material.sentence, String(source)))) {
      ctx.addIssue({ code: 'custom', message: '理解检查必须更换语境' });
    }
    if (item.kind === 'term' && !termAppearsInSentence(target, material.sentence)) {
      ctx.addIssue({ code: 'custom', message: '新语境没有使用目标词' });
    }
    if (item.learningGoal !== 'recognition') {
      if (!material.drill || (item.kind === 'term' && material.collocations.length < 2)) {
        ctx.addIssue({ code: 'custom', message: '产出材料缺少搭配或迁移练习' });
      } else {
        if (/[A-Za-z]/u.test(material.drill.brief + material.drill.target_zh + material.trigger)) {
          ctx.addIssue({ code: 'custom', message: '迁移任务和触发时机必须使用中文，不泄露英文答案' });
        }
        if (item.kind === 'term' && !termAppearsInSentence(target, material.drill.answer)) {
          ctx.addIssue({ code: 'custom', message: '参考答案没有使用目标词' });
        }
        if (item.kind !== 'term' && !skeletonAnchoredInExpression(String(target), material.drill.answer)) {
          ctx.addIssue({ code: 'custom', message: '迁移答案没有实例化目标骨架' });
        }
        for (const source of [...sources, material.anchorSentence].filter(Boolean)) {
          if (!drillDiffersFromExample(material.drill.answer, String(source))) {
            ctx.addIssue({ code: 'custom', message: '产出练习必须更换场景' });
          }
        }
      }
    }
  });
  return base.transform(material => item.learningGoal === 'recognition'
    ? { ...material, collocations: [], drill: null }
    : material);
}

export function manualVocabularySchemaFor(quote: string, selected: string) {
  return sourceCandidateSchema.superRefine((item, ctx) => {
    if (item.kind !== 'term' || !sourceCandidateGrounded(item, quote)
      || !termAppearsInSentence(item.lemma, selected) || !termAppearsInSentence(selected, item.quote)) {
      ctx.addIssue({ code: 'custom', message: '选词解释必须绑定所选词与原句' });
    }
    if (!/[\u3400-\u9fff]/u.test(String(item.sense)) || !/[\u3400-\u9fff]/u.test(item.zh)) {
      ctx.addIssue({ code: 'custom', message: '当前义项必须使用中文，不能用英文词典定义' });
    }
  });
}

const recommendationItemSchema = z.object({
    kind: z.enum(['expression', 'term']).default('expression'),
    termCategory: z.enum(['professional', 'precision', 'everyday'])
      .optional(),
    sourceCandidateId: z.string().trim().nullable().optional(),
    skeleton: z.string().min(1),
    zh: z.string().min(1),
    lemma: nullableText,
    sense: nullableText,
    collocations: z.array(z.string()).max(6).catch([]),
    anchorSentence: nullableText,
    relatedExpressionIds: z.array(z.string()).max(12).catch([]),
    domainTags: z.array(z.string()).max(6).catch([]),
    trigger: z.string().trim().min(1),
    why: z.string().min(1),
    example: z.string().min(1),
    example_zh: z.string().trim().min(1),
    drill: z.object({
      brief: z.string().trim().min(1),
      target_zh: z.string().trim().min(1),
      answer: z.string().trim().min(1),
    }).strict(),
    register: z.enum(['meeting', 'email', 'casual']).catch('meeting'),
    tags: z.array(z.string()).max(3).catch([]),
  });

export function recommendationSchemaFor(options: {
  allowEverydayTerms?: boolean;
  sourceCandidates?: Array<{
    id: string;
    kind: unknown;
    skeleton: string;
    lemma?: string;
  }>;
} = {}) {
  return z.object({
    items: z.array(recommendationItemSchema).min(5).max(6),
  }).superRefine((value, context) => {
    const keys = value.items.map((item) => `${normalizeLearningItemKind(item.kind)}:${item.skeleton
      .trim()
      .replace(/\s+/g, ' ')
      .toLowerCase()}`);
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'recommendation skeletons must be unique',
      });
    }
    const termCount = value.items.filter(item => item.kind === 'term').length;
    if (termCount > 1 || value.items.length - termCount < 4) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'recommendations require at least four expressions and at most one term',
      });
    }
    value.items.forEach((item, index) => {
      const sourceCandidateId = String(item.sourceCandidateId || '').trim();
      if (sourceCandidateId) {
        const candidate = options.sourceCandidates?.find(
          source => source.id === sourceCandidateId,
        );
        if (
          !candidate
          || learningItemKey(candidate) !== learningItemKey(item)
        ) {
          context.addIssue({
            code: 'custom',
            path: ['items', index, 'sourceCandidateId'],
            message: 'source-backed recommendation must preserve its candidate',
          });
        }
      }
      if (
        item.kind === 'expression'
        && !skeletonAnchoredInExpression(item.skeleton, item.example)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'example'],
          message: 'recommendation example must instantiate the skeleton',
        });
      }
      if (item.kind === 'term' && !isTermCandidate(item)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index],
          message: 'term recommendation must be category-appropriate and usage-ready',
        });
      }
      if (
        item.kind === 'term'
        && normalizeTermCategory(item.termCategory) === 'everyday'
        && !options.allowEverydayTerms
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'termCategory'],
          message: 'everyday vocabulary requires explicit learner preference',
        });
      }
      if (
        item.kind === 'term'
        && !termAppearsInSentence(item.lemma || item.skeleton, item.drill.answer)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'drill', 'answer'],
          message: 'term drill answer must use the target term',
        });
      }
      if (!drillDiffersFromExample(item.example_zh, item.drill.target_zh)) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'drill', 'target_zh'],
          message: 'recommendation drill must transfer the skeleton to a different scenario',
        });
      }
      if (
        item.kind === 'expression'
        && !skeletonAnchoredInExpression(item.skeleton, item.drill.answer)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'drill', 'answer'],
          message: 'recommendation drill answer must instantiate the skeleton',
        });
      }
    });
    if (
      options.sourceCandidates?.length
      && !value.items.some(item => String(item.sourceCandidateId || '').trim())
    ) {
      context.addIssue({
        code: 'custom',
        path: ['items'],
        message: 'recommendations must consume at least one pending source candidate',
      });
    }
  });
}

export const recommendationSchema = recommendationSchemaFor();

export const roleplayStartSchema = z.object({
  role: z.string().trim().min(1),
  scenario: z.string().trim().min(1),
  opening: z.string().trim().min(1),
}).strict();

export const roleplayContinueSchema = z.object({
  followup: z.string().trim().min(1),
}).strict();

export const roleplayJudgeSchema = z.object({
  trigger_recognized: z.boolean(),
  intent_achieved: z.boolean(),
  used_target: z.boolean(),
  issue_level: z.enum(['none', 'minor', 'blocking']),
  clear: z.boolean(),
  concise: z.boolean(),
  verdict: z.string().trim().min(1),
  fix: nullableText,
  tighter: nullableText,
  note: z.string().catch(''),
  retry_turn: z.union([z.literal(1), z.literal(2)]).default(2),
}).strict();
