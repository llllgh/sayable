import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));
import * as S from '../js/store.js';
import { migratePersistedState } from '../src/storage/state-migrations';
import { normalizePracticeSession } from '../src/core/practice-session';

function seed() {
  const item = S.makeItem({ skeleton: 'We can mitigate X', zh: '我们能降低某风险',
    seeds: ['We can mitigate outages by testing.'], drill: { brief: '说明测试减少中断', target_zh: '测试能减少中断。', answer: 'Original reference.' } });
  S.state.items.push(item);
  for (const sourceId of ['one', 'two']) {
    const session = S.ensurePracticeSession(item.id, { source: 'due-review', sourceId,
      cue: { brief: '说明检查可以降低风险' } });
    const attempt = S.beginPracticeAttempt(session.id, { answer: 'We can mitigate risks by checks.', inputMode: 'text' })!;
    S.settlePracticeAttempt(session.id, attempt.id, true, { judgement: {
      used_target: true, issue_level: 'minor', fix: 'We can mitigate risks by checking.',
      problem_tags: [{ category: 'grammar', quote: 'by checks', reason: '使用更合适的动名词结构。' }],
    } });
    S.completePracticeSession(session.id);
  }
  return item;
}
const drill = { brief: '说明备份方案能降低资料丢失风险', target_zh: '跨区域备份能降低资料丢失风险。',
  trigger: '当讨论灾备方案时，提出降低风险的措施', answer: 'We can mitigate data loss through regional backups.' };

describe('independent problem practice', () => {
  beforeEach(async () => {
    await S.flush();
    S.state.items = []; S.state.practiceSessions = [];
    S.state.problemDecisions = []; S.state.problemPractice = null;
    S.state.log = []; S.state.dailyRecommendations = null;
  });
  it('requires user confirmation and preserves a single request during repeated clicks', () => {
    seed();
    expect(() => S.beginProblemPractice('grammar')).toThrow('确认');
    S.confirmExpressionProblem('grammar');
    const first = S.beginProblemPractice('grammar');
    const second = S.beginProblemPractice('grammar');
    expect(first.request).toBe(true); expect(second.request).toBe(false);
    expect(second.task.id).toBe(first.task.id);
    expect(S.completeProblemPracticeCue('stale', drill)).toBeNull();
    expect(S.state.problemPractice.status).toBe('generating');
  });
  it('snapshots a ready task without overwriting the original drill, draft or recommendation progress', () => {
    const item = seed(); const original = { ...item.drill };
    S.confirmExpressionProblem('grammar');
    const { task } = S.beginProblemPractice('grammar');
    S.completeProblemPracticeCue(task.requestId, drill);
    const session = S.getPracticeSession(task.sessionId)!;
    expect(session).toMatchObject({ source: 'problem-practice', sourceId: task.id, problemFocus: { referenceAnswer: drill.answer } });
    S.updatePracticeDraft(session.id, 'Draft from a new scenario.');
    expect(S.beginProblemPractice('grammar').request).toBe(false);
    expect(item.drill).toEqual(original);
    expect(S.state.dailyRecommendations).toBeNull();
    const backup = JSON.parse(S.exportJSON());
    expect(backup.formatVersion).toBe(15);
    expect(backup.settings.apiKey).toBeUndefined();
    expect(normalizePracticeSession(backup.practiceSessions.at(-1))?.answerDraft).toBe('Draft from a new scenario.');
    expect(backup.problemDecisions).toHaveLength(2);
    expect(migratePersistedState({ ...backup, formatVersion: 14 })).toMatchObject({ problemPractice: { status: 'ready', sessionId: session.id } });
  });
  it('rejects a response after a goal change and ignores responses from failed requests', () => {
    const item = seed();
    S.confirmExpressionProblem('grammar');
    const { task } = S.beginProblemPractice('grammar');
    item.goalRevision++;
    expect(S.completeProblemPracticeCue(task.requestId, drill)).toBeNull();
    expect(S.state.problemPractice.status).toBe('error');
    const next = S.beginProblemPractice('grammar');
    S.failProblemPracticeCue(next.task.requestId, 'service unavailable');
    expect(S.completeProblemPracticeCue(next.task.requestId, drill)).toBeNull();
    expect(S.pendingProblemPractice()?.error).toBe('service unavailable');
  });
  it('keeps started tasks after old evidence is ignored and counts only finished output', () => {
    const item = seed(); S.confirmExpressionProblem('grammar');
    const { task } = S.beginProblemPractice('grammar'); S.completeProblemPracticeCue(task.requestId, drill);
    const session = S.getPracticeSession(task.sessionId)!;
    const entry = S.expressionProblemEvidence()[0];
    S.decideExpressionProblem(entry.id, 'ignore', entry.category);
    expect(S.pendingProblemPractice()?.sessionId).toBe(session.id);
    const attempt = S.beginPracticeAttempt(session.id, { answer: drill.answer })!;
    S.settlePracticeAttempt(session.id, attempt.id, true, { judgement: { used_target: true, issue_level: 'none' } });
    expect(S.pendingProblemPractice()).not.toBeNull();
    S.completePracticeSession(session.id);
    expect(S.pendingProblemPractice()).toBeNull();
    // Restoring ignored feedback exposes the true training count, not an improvement claim.
    S.decideExpressionProblem(entry.id, 'confirm', entry.category);
    expect(S.expressionProblems()[0].completedCount).toBe(1);
    expect(item.history.filter((entry: any) => entry.sessionId === session.id)).toHaveLength(1);
  });
  it('cannot generate from archived or recognition-only evidence', () => {
    const item = seed(); S.confirmExpressionProblem('grammar');
    item.status = 'retired';
    expect(() => S.beginProblemPractice('grammar')).toThrow('归档');
    item.status = 'learning'; item.learningGoal = 'recognition';
    expect(() => S.beginProblemPractice('grammar')).toThrow('看懂即可');
  });
  it('recovers a missing ready session and rejects responses after leaving the task', async () => {
    seed(); S.confirmExpressionProblem('grammar');
    const { task } = S.beginProblemPractice('grammar');
    S.completeProblemPracticeCue(task.requestId, drill);
    S.state.practiceSessions = S.state.practiceSessions.filter(session => session.id !== task.sessionId);
    expect(S.pendingProblemPractice()).toMatchObject({ status: 'error', error: '这次练习记录已不可用，请重新出题' });
    await S.flush();
    const retry = S.beginProblemPractice('grammar');
    S.leaveProblemPractice();
    expect(S.completeProblemPracticeCue(retry.task.requestId, drill)).toBeNull();
    expect(S.pendingProblemPractice()).toBeNull();
    expect(S.state.practiceSessions).toHaveLength(2);
  });
});
