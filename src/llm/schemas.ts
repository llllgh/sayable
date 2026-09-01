import { z } from 'zod';

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
    why: z.string().min(1),
    register: z.enum(['meeting', 'email', 'casual']).catch('meeting'),
    tags: z.array(z.string()).max(6).catch([]),
    seeds: z.array(z.string()).max(6).catch([]),
    native_check: z.string().catch('risky'),
    trap: nullableText,
  }),
  bonus: z.object({
    skeleton: z.string(),
    zh: z.string(),
  }).nullable().optional(),
  drill: z.object({
    brief: z.string().min(1),
    target_zh: z.string().catch(''),
  }),
}).passthrough();

export const judgeSchema = z.object({
  ok: z.boolean(),
  used_target: z.boolean(),
  verdict: z.string().min(1),
  fix: nullableText,
  tighter: nullableText,
  note: z.string().catch(''),
}).passthrough();

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
    why: z.string().catch(''),
    seeds: z.array(z.string()).catch([]),
    drill: z.string().catch(''),
  })).max(2).catch([]),
  avoid: z.string().catch(''),
}).passthrough();

export const recommendationSchema = z.object({
  items: z.array(z.object({
    skeleton: z.string().min(1),
    zh: z.string().min(1),
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
