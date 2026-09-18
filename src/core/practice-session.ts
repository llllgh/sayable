export type PracticePhase =
  | 'answering'
  | 'submitting'
  | 'feedback'
  | 'revealed'
  | 'completed';

export type PracticeAttemptStatus =
  | 'submitting'
  | 'error'
  | 'judged';

export interface PracticeCueSnapshot {
  brief: string;
  context: string;
  targetZh: string;
  trigger: string;
}

export interface PracticeItemSnapshot {
  box: number;
  dueAt: number;
  reviewNotBefore: number;
  status: string;
  lastAt: number;
}

export interface PracticeAttempt {
  id: string;
  kind: 'initial' | 'retry' | 'reveal';
  status: PracticeAttemptStatus;
  answer: string;
  rawTranscript: string;
  confirmedText: string;
  revised: boolean;
  revisedAt: number;
  revisionStatus: 'none' | 'applied' | 'schedule_pending';
  promptUsed: boolean;
  judgementSource: 'model' | 'self' | 'unknown';
  inputMode: 'text' | 'voice' | 'unknown';
  startedAt: number;
  completedAt: number;
  error: string;
  judgement: Record<string, unknown> | null;
  feedback: Record<string, unknown> | null;
}

export interface PracticeSettlement {
  attemptId: string;
  appliedAt: number;
  passed: boolean;
  before: PracticeItemSnapshot;
  after: PracticeItemSnapshot;
}

export interface PracticeSession {
  id: string;
  itemId: string;
  source: string;
  sourceId: string;
  startedAt: number;
  updatedAt: number;
  completedAt: number;
  phase: PracticePhase;
  cue: PracticeCueSnapshot;
  answerDraft: string;
  retryCount: number;
  promptUsed: boolean;
  attempts: PracticeAttempt[];
  settlement: PracticeSettlement | null;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeCue(value: unknown): PracticeCueSnapshot {
  const cue = isRecord(value) ? value : {};
  return {
    brief: text(cue.brief).trim(),
    context: text(cue.context ?? cue.ctx).trim(),
    targetZh: text(cue.targetZh ?? cue.target_zh).trim(),
    trigger: text(cue.trigger).trim(),
  };
}

function normalizeItemSnapshot(value: unknown): PracticeItemSnapshot | null {
  if (!isRecord(value)) return null;
  const box = Number(value.box);
  const dueAt = Number(value.dueAt);
  if (!Number.isFinite(box) || !Number.isFinite(dueAt)) return null;
  return {
    box,
    dueAt,
    reviewNotBefore: Number(value.reviewNotBefore) || 0,
    status: text(value.status) || 'learning',
    lastAt: Number(value.lastAt) || 0,
  };
}

function normalizeAttempt(value: unknown): PracticeAttempt | null {
  if (!isRecord(value)) return null;
  const id = text(value.id).trim();
  if (!id) return null;
  const rawKind = text(value.kind);
  const kind = rawKind === 'retry' || rawKind === 'reveal'
    ? rawKind
    : 'initial';
  const rawStatus = text(value.status);
  const interrupted = rawStatus === 'submitting';
  const status: PracticeAttemptStatus = rawStatus === 'judged'
    ? 'judged'
    : interrupted || rawStatus === 'error'
      ? 'error'
      : 'error';
  const rawInputMode = text(value.inputMode);
  const inputMode = rawInputMode === 'text' || rawInputMode === 'voice'
    ? rawInputMode
    : 'unknown';
  return {
    id,
    kind,
    status,
    answer: text(value.answer),
    rawTranscript: text(value.rawTranscript),
    confirmedText: text(value.confirmedText ?? value.answer),
    revised: Boolean(value.revised),
    revisedAt: timestamp(value.revisedAt),
    revisionStatus: value.revisionStatus === 'applied'
      || value.revisionStatus === 'schedule_pending'
      ? value.revisionStatus
      : 'none',
    promptUsed: Boolean(value.promptUsed),
    judgementSource: value.judgementSource === 'model'
      || value.judgementSource === 'self'
      ? value.judgementSource
      : 'unknown',
    inputMode,
    startedAt: timestamp(value.startedAt),
    completedAt: interrupted ? 0 : timestamp(value.completedAt),
    error: interrupted
      ? '上次检查在应用关闭时中断，请重新提交'
      : text(value.error),
    judgement: isRecord(value.judgement) ? value.judgement : null,
    feedback: isRecord(value.feedback) ? value.feedback : null,
  };
}

function normalizeSettlement(
  value: unknown,
  attempts: PracticeAttempt[],
): PracticeSettlement | null {
  if (!isRecord(value)) return null;
  const attemptId = text(value.attemptId).trim();
  const before = normalizeItemSnapshot(value.before);
  const after = normalizeItemSnapshot(value.after);
  if (!attemptId || !before || !after) return null;
  if (!attempts.some(attempt => attempt.id === attemptId)) return null;
  return {
    attemptId,
    appliedAt: timestamp(value.appliedAt),
    passed: Boolean(value.passed),
    before,
    after,
  };
}

export function practiceSessionKey(
  itemId: string,
  source: string,
  sourceId = '',
): string {
  return [itemId.trim(), source.trim(), sourceId.trim()].join('\u001f');
}

export function createPracticeSessionRecord(input: {
  id: string;
  itemId: string;
  source: string;
  sourceId?: string;
  now: number;
  cue?: Partial<PracticeCueSnapshot>;
  answer?: string;
}): PracticeSession {
  const id = text(input.id).trim();
  const itemId = text(input.itemId).trim();
  const source = text(input.source).trim();
  if (!id || !itemId || !source) {
    throw new Error('练习会话数据不完整');
  }
  const startedAt = timestamp(input.now) || Date.now();
  return {
    id,
    itemId,
    source,
    sourceId: text(input.sourceId).trim(),
    startedAt,
    updatedAt: startedAt,
    completedAt: 0,
    phase: 'answering',
    cue: normalizeCue(input.cue),
    answerDraft: text(input.answer),
    retryCount: 0,
    promptUsed: false,
    attempts: [],
    settlement: null,
  };
}

export function normalizePracticeSession(value: unknown): PracticeSession | null {
  if (!isRecord(value)) return null;
  const id = text(value.id).trim();
  const itemId = text(value.itemId).trim();
  const source = text(value.source).trim();
  if (!id || !itemId || !source) return null;

  const attempts = (Array.isArray(value.attempts) ? value.attempts : [])
    .map(normalizeAttempt)
    .filter((attempt): attempt is PracticeAttempt => Boolean(attempt))
    .slice(-20);
  const settlement = normalizeSettlement(value.settlement, attempts);
  const completedAt = timestamp(value.completedAt);
  const settledAttempt = settlement
    ? attempts.find(attempt => attempt.id === settlement.attemptId)
    : null;
  const retryCount = attempts.filter(
    attempt => attempt.kind === 'retry' && attempt.status === 'judged',
  ).length;
  const storedPhase = text(value.phase);
  const interruptedRetry = attempts.some(
    attempt => attempt.kind === 'retry'
      && attempt.status === 'error'
      && !attempt.completedAt,
  );
  const phase: PracticePhase = completedAt
    ? 'completed'
    : settlement && (storedPhase === 'answering' || interruptedRetry)
      ? 'answering'
    : settlement
      ? settledAttempt?.kind === 'reveal' ? 'revealed' : 'feedback'
      : 'answering';

  return {
    id,
    itemId,
    source,
    sourceId: text(value.sourceId).trim(),
    startedAt: timestamp(value.startedAt),
    updatedAt: timestamp(value.updatedAt),
    completedAt,
    phase,
    cue: normalizeCue(value.cue),
    answerDraft: text(value.answerDraft),
    retryCount,
    promptUsed: Boolean(value.promptUsed)
      || attempts.some(attempt => attempt.promptUsed),
    attempts,
    settlement,
  };
}

export function practiceItemSnapshot(value: {
  box?: number;
  dueAt?: number;
  reviewNotBefore?: number;
  status?: string;
  lastAt?: number;
}): PracticeItemSnapshot {
  return {
    box: Number(value.box) || 0,
    dueAt: Number(value.dueAt) || 0,
    reviewNotBefore: Number(value.reviewNotBefore) || 0,
    status: text(value.status) || 'learning',
    lastAt: Number(value.lastAt) || 0,
  };
}
