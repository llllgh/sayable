import type { PracticeSession } from './practice-session';
import { normalizeJudgementText } from './judgement';

export const PROBLEM_CATEGORIES = [
  { id: 'grammar', label: '语法与句式', focus: '留意主谓、词形与句子结构，保持核心意思清楚。' },
  { id: 'word_choice', label: '用词准确', focus: '选择符合当前语境的词，准确表达对象和动作。' },
  { id: 'collocation', label: '固定搭配', focus: '留意词语与介词的搭配，在完整句子中自然使用。' },
  { id: 'conciseness', label: '表达精简', focus: '原句可以成立，尝试减少重复，用更短的句子保留重点。' },
  { id: 'target_usage', label: '目标表达调用', focus: '在新场景中主动使用这次的目标表达，保留正确槽位关系。' },
] as const;
export type ProblemCategory = typeof PROBLEM_CATEGORIES[number]['id'];
export interface ProblemTag { category: ProblemCategory; quote: string; reason: string }
export interface ProblemDecision {
  evidenceId: string; category: ProblemCategory; action: 'confirm' | 'ignore'; at: number;
}
export interface ProblemEvidence extends ProblemTag {
  id: string; sessionId: string; itemId: string; at: number;
  answer: string; brief: string; targetZh: string; suggestion: string;
  kind: 'correction' | 'optional' | 'target'; confirmed: boolean; ignored: boolean;
}
export interface ProblemPracticeTask {
  id: string; category: ProblemCategory; evidenceIds: string[]; itemId: string;
  goalRevision: number; requestId: string; status: 'generating' | 'ready' | 'error';
  sessionId: string; error: string; updatedAt: number;
}

export function isProblemCategory(value: unknown): value is ProblemCategory {
  return PROBLEM_CATEGORIES.some(category => category.id === value);
}
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const ids = (value: unknown) => [...new Set((Array.isArray(value) ? value : []).map(text).filter(Boolean))];

// Tags are advisory metadata. Invalid tags must never invalidate the judgement.
export function normalizeProblemTags(value: unknown): ProblemTag[] {
  const result: ProblemTag[] = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const tag = record(raw);
    const quote = text(tag.quote), reason = text(tag.reason);
    if (!isProblemCategory(tag.category) || !quote || !/[\u3400-\u9fff]/u.test(reason)) continue;
    if (!result.some(existing => existing.category === tag.category)) {
      result.push({ category: tag.category, quote, reason });
    }
  }
  return result.slice(0, 5);
}

export function normalizeProblemDecisions(value: unknown): ProblemDecision[] {
  const decisions = new Map<string, ProblemDecision>();
  for (const raw of Array.isArray(value) ? value : []) {
    const entry = record(raw);
    if (!text(entry.evidenceId) || !isProblemCategory(entry.category)
      || !['confirm', 'ignore'].includes(text(entry.action))) continue;
    decisions.set(text(entry.evidenceId), {
      evidenceId: text(entry.evidenceId), category: entry.category,
      action: entry.action as ProblemDecision['action'], at: Number(entry.at) || 0,
    });
  }
  return [...decisions.values()].slice(-1000);
}

export function normalizeProblemPractice(value: unknown): ProblemPracticeTask | null {
  const task = record(value);
  if (!text(task.id) || !text(task.itemId) || !isProblemCategory(task.category)) return null;
  const interrupted = task.status === 'generating';
  return {
    id: text(task.id), category: task.category, itemId: text(task.itemId),
    evidenceIds: ids(task.evidenceIds), goalRevision: Number(task.goalRevision) || 0,
    requestId: text(task.requestId), sessionId: text(task.sessionId),
    status: task.status === 'ready' && text(task.sessionId) ? 'ready' : 'error',
    error: interrupted ? '上次出题未完成，请重试' : text(task.error),
    updatedAt: Number(task.updatedAt) || 0,
  };
}

function fingerprint(value: string): string {
  let first = 0x811c9dc5, second = 5381;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193);
    second = Math.imul(second, 33) ^ code;
  }
  return `${value.length}-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
}

export function problemEvidence(
  sessions: PracticeSession[], decisions: ProblemDecision[] = [],
): ProblemEvidence[] {
  const choice = new Map(decisions.map(decision => [decision.evidenceId, decision]));
  const evidence = new Map<string, ProblemEvidence>();
  for (const session of sessions) {
    if (session.learningGoal === 'recognition') continue;
    // Failed requests may precede the actual first judgement; retries are separate.
    const attempt = session.attempts.find(candidate => candidate.kind === 'initial'
      && candidate.status === 'judged' && candidate.judgementSource === 'model');
    if (!attempt?.judgement) continue;
    const answer = attempt.confirmedText || attempt.answer;
    if (!answer.trim()) continue;
    const judgement = attempt.judgement;
    const fix = text(judgement.fix), tighter = text(judgement.tighter);
    const substantiveFix = fix && normalizeJudgementText(fix) !== normalizeJudgementText(answer)
      && judgement.issue_level !== 'none';
    const optional = !substantiveFix && tighter
      && normalizeJudgementText(tighter) !== normalizeJudgementText(answer);
    const tags = normalizeProblemTags(judgement.problem_tags).filter(tag =>
      answer.includes(tag.quote) && (tag.category === 'target_usage'
        ? judgement.used_target === false
        : tag.category === 'conciseness' ? optional : substantiveFix));
    if (judgement.used_target === false && !tags.some(tag => tag.category === 'target_usage')) {
      tags.push({ category: 'target_usage', quote: answer,
        reason: '这次尚未使用目标表达；这是练习目标缺口，不代表句子有语法错误。' });
    }
    for (const tag of tags) {
      const id = `${session.id}:${attempt.id}:${tag.category}:${fingerprint(JSON.stringify([
        answer, tag.quote, tag.reason, fix, tighter,
      ]))}`;
      const decision = choice.get(id);
      evidence.set(id, {
        ...tag, id, sessionId: session.id, itemId: session.itemId,
        category: decision?.category || tag.category,
        at: attempt.revisedAt || attempt.completedAt || session.updatedAt,
        answer, brief: session.cue.brief, targetZh: session.cue.targetZh,
        suggestion: tag.category === 'conciseness' ? tighter : fix,
        kind: tag.category === 'target_usage' ? 'target'
          : tag.category === 'conciseness' ? 'optional' : 'correction',
        confirmed: decision?.action === 'confirm', ignored: decision?.action === 'ignore',
      });
    }
  }
  return [...evidence.values()].sort((a, b) => b.at - a.at);
}

export function problemGroups(sessions: PracticeSession[], decisions: ProblemDecision[] = []) {
  const evidence = problemEvidence(sessions, decisions);
  return PROBLEM_CATEGORIES.map(category => {
    const entries = evidence.filter(entry => !entry.ignored && entry.category === category.id);
    const count = new Set(entries.map(entry => entry.sessionId)).size;
    const confirmedCount = new Set(entries.filter(entry => entry.confirmed).map(entry => entry.sessionId)).size;
    return { ...category, entries, count, confirmedCount, repeated: count >= 2,
      trainable: confirmedCount >= 2, latestAt: entries[0]?.at || 0,
      completedCount: new Set(sessions.filter(session => session.completedAt
        && session.problemFocus?.category === category.id
        && session.attempts.some(attempt => attempt.status === 'judged' && attempt.kind !== 'reveal'))
        .map(session => session.id)).size };
  }).filter(group => group.count >= 2).sort((a, b) => b.latestAt - a.latestAt);
}
