import { z } from 'zod';
import { skeletonAnchoredInExpression } from '../core/capture';

const nullableText = z.string().nullable().optional();

export const captureSchema = z.object({
  mode: z.enum(['zh', 'mine', 'heard', 'fragment']).optional(),
  read: z.string().min(1),
  natural: z.string().min(1),
  spoken: nullableText,
  diagnosis: z.object({
    symptom: nullableText,
    before: nullableText,
    after: nullableText,
  }),
  primary: z.object({
    skeleton: z.string().min(1),
    zh: z.string().min(1),
    trigger: z.string().trim().min(1),
    why: z.string().min(1),
    register: z.enum(['meeting', 'email', 'casual']).catch('meeting'),
    tags: z.array(z.string()).max(6).catch([]),
    seeds: z.array(z.string()).max(6).catch([]),
    native_check: z.string().catch('risky'),
    trap: nullableText,
  }),
  bonus: z.object({
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
  }).nullable().optional(),
  drill: z.object({
    brief: z.string().min(1),
    target_zh: z.string().catch(''),
  }),
}).passthrough().superRefine((value, context) => {
  if (!skeletonAnchoredInExpression(value.primary.skeleton, value.natural)) {
    context.addIssue({
      code: 'custom',
      path: ['primary', 'skeleton'],
      message: 'primary skeleton must be directly instantiated by natural',
    });
  }
});

export const reviewCueSchema = z.object({
  brief: z.string().trim().min(1),
  target_zh: z.string().trim().min(1),
  trigger: z.string().trim().min(1),
}).strict();

export const judgeSchema = z.object({
  ok: z.boolean(),
  used_target: z.boolean(),
  meaning_intact: z.boolean(),
  issue_level: z.enum(['none', 'minor', 'blocking']),
  verdict: z.string().min(1),
  fix: nullableText,
  tighter: nullableText,
  note: z.string().catch(''),
}).passthrough().superRefine((value, context) => {
  const fix = String(value.fix || '').trim();
  if (value.issue_level === 'none' && fix) {
    context.addIssue({
      code: 'custom',
      path: ['fix'],
      message: 'fix must be null when issue_level is none',
    });
  }
  if (value.issue_level !== 'none' && !fix) {
    context.addIssue({
      code: 'custom',
      path: ['fix'],
      message: 'fix must contain the complete necessary correction',
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

export const recommendationSchema = z.object({
  items: z.array(z.object({
    skeleton: z.string().min(1),
    zh: z.string().min(1),
    trigger: z.string().trim().min(1),
    why: z.string().min(1),
    example: z.string().min(1),
    drill: z.string().min(1),
    register: z.enum(['meeting', 'email', 'casual']).catch('meeting'),
    tags: z.array(z.string()).max(3).catch([]),
  })).min(5).max(6),
}).superRefine((value, context) => {
  const keys = value.items.map((item) => item.skeleton
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase());
  if (new Set(keys).size !== keys.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'recommendation skeletons must be unique',
    });
  }
});

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
}).strict();
