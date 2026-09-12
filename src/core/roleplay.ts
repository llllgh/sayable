import {
  nextReview,
  RETRY_MS,
  type ReviewState,
} from './scheduler';

export const ROLEPLAY_MIN_BOX = 3;

export type RoleplaySpeaker = 'ai' | 'user';
export type RoleplayPhase =
  | 'awaiting_first_answer'
  | 'awaiting_followup'
  | 'awaiting_second_answer'
  | 'awaiting_judgement'
  | 'completed'
  | 'invalid';

export interface RoleplayTurn {
  speaker: RoleplaySpeaker;
  text: string;
  at: number;
}

export interface RoleplayResult {
  triggerRecognized: boolean;
  intentAchieved: boolean;
  usedTarget: boolean;
  issueLevel: 'none' | 'minor' | 'blocking';
  clear: boolean;
  concise: boolean;
  verdict: string;
  fix: string | null;
  tighter: string | null;
  note: string;
}

export interface RoleplaySession {
  id: string;
  itemId: string;
  startedAt: number;
  completedAt: number;
  scenario: string;
  role: string;
  turns: RoleplayTurn[];
  result: RoleplayResult | null;
}

export interface RoleplayEligibleItem {
  box: number;
  trigger?: string;
  status?: string;
}

type JsonRecord = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizedWords(value: unknown): string[] {
  return text(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/['\u2019]/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function roleplayLeaksTarget(
  candidate: string,
  skeleton: string,
): boolean {
  const candidateWords = normalizedWords(candidate);
  const skeletonWords = normalizedWords(
    String(skeleton || '').replace(/\b[XYZ]\b/g, ' '),
  );
  if (!candidateWords.length || skeletonWords.length < 3) return false;
  const candidateText = candidateWords.join(' ');
  const skeletonText = skeletonWords.join(' ');
  if (skeletonText.length >= 12 && candidateText.includes(skeletonText)) {
    return true;
  }
  let position = 0;
  for (const word of candidateWords) {
    if (word === skeletonWords[position]) position += 1;
    if (position === skeletonWords.length) return true;
  }
  return false;
}

export function roleplayLeaksTrigger(
  candidate: string,
  trigger: string,
): boolean {
  const compact = (value: string) => text(value)
    .normalize('NFKC')
    .replace(/[\s，。！？；：、,.!?;:]/gu, '');
  const candidateText = compact(candidate);
  const triggerText = compact(trigger);
  if (!candidateText || !triggerText) return false;
  if (candidateText.includes(triggerText)) return true;
  const clauses = String(trigger || '')
    .split(/时[，,]?|[，,]/u)
    .map(compact)
    .filter(Boolean);
  const action = clauses[clauses.length - 1] || '';
  return action.length >= 4 && candidateText.includes(action);
}

export function roleplayEligibility(
  item: RoleplayEligibleItem | null | undefined,
  environment = { modelReady: true, online: true },
): boolean {
  return Boolean(
    item
    && Number(item.box) >= ROLEPLAY_MIN_BOX
    && text(item.trigger)
    && item.status !== 'retired'
    && environment.modelReady
    && environment.online,
  );
}

export function roleplayPhase(session: RoleplaySession): RoleplayPhase {
  if (session.result || session.completedAt) return 'completed';
  const aiTurns = session.turns.filter(turn => turn.speaker === 'ai').length;
  const userTurns = session.turns.filter(turn => turn.speaker === 'user').length;
  if (aiTurns === 1 && userTurns === 0) return 'awaiting_first_answer';
  if (aiTurns === 1 && userTurns === 1) return 'awaiting_followup';
  if (aiTurns === 2 && userTurns === 1) return 'awaiting_second_answer';
  if (aiTurns === 2 && userTurns === 2) return 'awaiting_judgement';
  return 'invalid';
}

export function createRoleplaySessionRecord(input: {
  id: string;
  itemId: string;
  now: number;
  role: string;
  scenario: string;
  opening: string;
}): RoleplaySession {
  const id = text(input.id);
  const itemId = text(input.itemId);
  const role = text(input.role);
  const scenario = text(input.scenario);
  const opening = text(input.opening);
  const timestamp = Number(input.now) || Date.now();
  if (!id || !itemId || !role || !scenario || !opening) {
    throw new Error('角色扮演会话数据不完整');
  }
  return {
    id,
    itemId,
    startedAt: timestamp,
    completedAt: 0,
    scenario,
    role,
    turns: [{ speaker: 'ai', text: opening, at: timestamp }],
    result: null,
  };
}

export function appendRoleplayTurn(
  session: RoleplaySession,
  speaker: RoleplaySpeaker,
  value: string,
  at: number,
): RoleplaySession {
  const content = text(value);
  if (session.completedAt || session.result) throw new Error('这次情境对话已经结束');
  if (!['ai', 'user'].includes(speaker) || !content) {
    throw new Error('对话内容不完整');
  }
  if (session.turns.length >= 4) throw new Error('这次情境对话已达到两轮上限');
  const expected = session.turns.length % 2 === 0 ? 'ai' : 'user';
  if (speaker !== expected) throw new Error('对话轮次不正确');
  return {
    ...session,
    turns: [
      ...session.turns,
      { speaker, text: content, at: Number(at) || Date.now() },
    ],
  };
}

export function normalizeRoleplayResult(value: unknown): RoleplayResult {
  const source = isRecord(value) ? value : {};
  const rawIssueLevel = source.issueLevel ?? source.issue_level;
  const issueLevel = ['none', 'minor', 'blocking'].includes(String(rawIssueLevel))
    ? rawIssueLevel as RoleplayResult['issueLevel']
    : 'blocking';
  return {
    triggerRecognized: Boolean(source.triggerRecognized ?? source.trigger_recognized),
    intentAchieved: Boolean(source.intentAchieved ?? source.intent_achieved),
    usedTarget: Boolean(source.usedTarget ?? source.used_target),
    issueLevel,
    clear: Boolean(source.clear),
    concise: Boolean(source.concise),
    verdict: text(source.verdict),
    fix: text(source.fix) || null,
    tighter: text(source.tighter) || null,
    note: text(source.note),
  };
}

export function normalizeRoleplaySession(value: unknown): RoleplaySession | null {
  if (!isRecord(value) || !Array.isArray(value.turns)) return null;
  const id = text(value.id);
  const itemId = text(value.itemId);
  const role = text(value.role);
  const scenario = text(value.scenario);
  if (!id || !itemId || !role || !scenario) return null;
  const turns = value.turns.slice(0, 4).map((turn): RoleplayTurn | null => {
    if (!isRecord(turn)) return null;
    const speaker = turn.speaker === 'ai' || turn.speaker === 'user'
      ? turn.speaker
      : null;
    const content = text(turn.text);
    if (!speaker || !content) return null;
    return {
      speaker,
      text: content,
      at: Number(turn.at) || 0,
    };
  });
  if (
    !turns.length
    || turns.some(turn => !turn)
    || turns.some((turn, index) => turn?.speaker !== (index % 2 === 0 ? 'ai' : 'user'))
  ) {
    return null;
  }
  const result = isRecord(value.result)
    ? normalizeRoleplayResult(value.result)
    : null;
  return {
    id,
    itemId,
    startedAt: Number(value.startedAt) || 0,
    completedAt: result ? Number(value.completedAt) || 0 : 0,
    scenario,
    role,
    turns: turns as RoleplayTurn[],
    result,
  };
}

export function roleplayCommunicationPassed(result: RoleplayResult): boolean {
  return result.triggerRecognized
    && result.intentAchieved
    && result.issueLevel !== 'blocking';
}

export function roleplayTargetSucceeded(result: RoleplayResult): boolean {
  return roleplayCommunicationPassed(result) && result.usedTarget;
}

export function nextRoleplayReview(
  current: ReviewState,
  result: RoleplayResult,
  now: number,
  lastPassedAt = 0,
): ReviewState {
  if (roleplayTargetSucceeded(result)) {
    return nextReview(current, true, now, lastPassedAt);
  }
  return {
    ...current,
    dueAt: now + RETRY_MS,
  };
}
