import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));

import {
  beginPracticeAttempt,
  completePracticeSession,
  ensurePracticeSession,
  expiredRecommendationPracticeSession,
  failPracticeAttempt,
  flush,
  grade,
  makeItem,
  markPracticePromptUsed,
  revisePracticeAttempt,
  settlePracticeAttempt,
  startPracticeRetry,
  state,
  updatePracticeDraft,
} from '../js/store.js';

describe('practice session store', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(async () => {
    await flush();
    state.items = [];
    state.practiceSessions = [];
    state.log = [];
    state.drafts = {
      quickCapture: '',
      expression: '',
      compression: '',
      preflight: '',
    };
  });

  it('restores a source-specific answer draft', () => {
    const item = makeItem({
      skeleton: 'We remain on track for X',
      zh: '我们仍可按计划完成 X',
    });
    state.items.push(item);

    const session = ensurePracticeSession(item.id, {
      source: 'due-review',
      sourceId: item.id,
      cue: { brief: '向客户更新项目进度', ctx: '项目会议' },
    });
    updatePracticeDraft(session.id, 'We remain on track for Friday.');
    const restored = ensurePracticeSession(item.id, {
      source: 'due-review',
      sourceId: item.id,
      cue: { brief: '不应覆盖已开始会话的题目' },
    });

    expect(restored.id).toBe(session.id);
    expect(restored.answerDraft).toBe('We remain on track for Friday.');
    expect(restored.cue.brief).toBe('向客户更新项目进度');
  });

  it('exposes an unfinished recommendation only after its local day expires', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 17, 23, 58));
    const item = makeItem({
      skeleton: 'We remain on track for X',
      zh: '我们仍可按计划完成 X',
    });
    state.items.push(item);
    const session = ensurePracticeSession(item.id, {
      source: 'recommendation',
      sourceId: 'recommendation-yesterday',
      cue: { brief: '向客户更新项目进度' },
    });
    updatePracticeDraft(session.id, 'We remain on track for Friday.');

    expect(expiredRecommendationPracticeSession(
      new Date(2026, 8, 17, 23, 59),
    )).toBeNull();
    expect(expiredRecommendationPracticeSession(
      new Date(2026, 8, 18, 0, 1),
    )).toMatchObject({
      id: session.id,
      answerDraft: 'We remain on track for Friday.',
      sourceId: 'recommendation-yesterday',
    });
  });

  it('applies scheduling once after an earlier failed request', () => {
    const item = makeItem({
      skeleton: 'Could we align on X?',
      zh: '我们能否就 X 达成一致？',
    });
    state.items.push(item);
    const session = ensurePracticeSession(item.id, {
      source: 'notification',
      sourceId: item.id,
      cue: { brief: '确认双方计划' },
    });

    const interrupted = beginPracticeAttempt(session.id, {
      answer: 'Could we align on the launch date?',
      inputMode: 'text',
    });
    if (!interrupted) throw new Error('expected an interrupted attempt');
    failPracticeAttempt(session.id, interrupted.id, 'network unavailable');
    const attempt = beginPracticeAttempt(session.id, {
      answer: 'Could we align on the launch date?',
      inputMode: 'text',
    });
    if (!attempt) throw new Error('expected a retry attempt');
    expect(attempt.kind).toBe('initial');

    const settled = settlePracticeAttempt(session.id, attempt.id, true, {
      judgement: { ok: true, verdict: '表达自然' },
      feedback: { kind: 'passed', verdict: '表达自然' },
      ctx: '发布会议',
    });
    const repeated = settlePracticeAttempt(session.id, attempt.id, true, {
      judgement: { ok: true },
    });

    expect(repeated).toBe(settled);
    expect(item.history).toHaveLength(1);
    expect(item.mine).toHaveLength(1);
    expect(item.history[0]).toMatchObject({
      sessionId: session.id,
      attemptId: attempt.id,
      ok: true,
    });
    expect(settled.settlement).toMatchObject({
      attemptId: attempt.id,
      passed: true,
      before: { box: 0 },
      after: { box: 1 },
    });
  });

  it('starts a new session only after the prior one is completed', () => {
    const item = makeItem({
      skeleton: 'The key point is X',
      zh: '关键点是 X',
    });
    state.items.push(item);
    const first = ensurePracticeSession(item.id, {
      source: 'library',
      sourceId: item.id,
      cue: { brief: '总结关键点' },
    });
    const attempt = beginPracticeAttempt(first.id, {
      answer: '',
      kind: 'reveal',
    });
    if (!attempt) throw new Error('expected a reveal attempt');
    settlePracticeAttempt(first.id, attempt.id, false, { why: 'revealed' });
    completePracticeSession(first.id);
    const second = ensurePracticeSession(item.id, {
      source: 'library',
      sourceId: item.id,
      cue: { brief: '再次总结关键点' },
    });

    expect(second.id).not.toBe(first.id);
    expect(state.practiceSessions).toHaveLength(2);
  });

  it('records feedback retries without applying scheduling twice', () => {
    const item = makeItem({
      skeleton: 'The risk is not X but Y',
      zh: '风险不在 X，而在 Y',
    });
    state.items.push(item);
    const session = ensurePracticeSession(item.id, {
      source: 'due-review',
      sourceId: item.id,
      cue: { brief: '说明真正的风险' },
    });
    const initial = beginPracticeAttempt(session.id, {
      answer: 'The risk is the timeline.',
      inputMode: 'text',
    });
    if (!initial) throw new Error('expected an initial attempt');
    settlePracticeAttempt(session.id, initial.id, false, {
      judgement: { ok: false },
    });
    const scheduledAfterInitial = {
      box: item.box,
      dueAt: item.dueAt,
    };

    startPracticeRetry(session.id);
    markPracticePromptUsed(session.id);
    const retry = beginPracticeAttempt(session.id, {
      answer: 'The risk is not cost but timing.',
      inputMode: 'voice',
      rawTranscript: 'The risk is not cost but timing.',
    });
    if (!retry) throw new Error('expected a feedback retry');
    settlePracticeAttempt(session.id, retry.id, true, {
      judgement: { ok: true },
    });

    expect(retry.kind).toBe('retry');
    expect(retry.promptUsed).toBe(true);
    expect(session.promptUsed).toBe(true);
    expect(item).toMatchObject(scheduledAfterInitial);
    expect(item.history).toHaveLength(1);
    expect(session.attempts.filter(
      (attempt: { status: string }) => attempt.status === 'judged',
    ))
      .toHaveLength(2);
    expect(session.retryCount).toBe(1);
  });

  it('limits a task to two effective feedback retries', () => {
    const item = makeItem({
      skeleton: 'What matters is X',
      zh: '重要的是 X',
    });
    state.items.push(item);
    const session = ensurePracticeSession(item.id, {
      source: 'capture',
      sourceId: item.id,
      cue: { brief: '说明重点' },
    });
    const initial = beginPracticeAttempt(session.id, {
      answer: 'The point is speed.',
    });
    if (!initial) throw new Error('expected an initial attempt');
    settlePracticeAttempt(session.id, initial.id, false);

    for (let index = 0; index < 2; index += 1) {
      startPracticeRetry(session.id);
      const retry = beginPracticeAttempt(session.id, {
        answer: `What matters is speed ${index}.`,
      });
      if (!retry) throw new Error('expected a retry');
      settlePracticeAttempt(session.id, retry.id, false);
    }

    expect(startPracticeRetry(session.id)).toBeNull();
    expect(beginPracticeAttempt(session.id, {
      answer: 'What matters is speed.',
      kind: 'retry',
    })).toBeNull();
    expect(item.history).toHaveLength(1);
  });

  it('replaces one voice attempt and its settlement after transcript revision', () => {
    const item = makeItem({
      skeleton: 'We remain on track for X',
      zh: '我们仍可按计划完成 X',
    });
    state.items.push(item);
    const session = ensurePracticeSession(item.id, {
      source: 'recommendation',
      sourceId: 'recommendation-1',
      cue: { brief: '更新交付进度' },
    });
    const initial = beginPracticeAttempt(session.id, {
      answer: 'We remain track Friday.',
      inputMode: 'voice',
      rawTranscript: 'We remain track Friday.',
    });
    if (!initial) throw new Error('expected a voice attempt');
    settlePracticeAttempt(session.id, initial.id, false);

    revisePracticeAttempt(
      session.id,
      initial.id,
      'We remain on track for Friday.',
      true,
      { judgement: { ok: true } },
    );

    expect(item.history).toHaveLength(1);
    expect(item.history[0]).toMatchObject({
      ok: true,
      answer: 'We remain on track for Friday.',
      sessionId: session.id,
      attemptId: initial.id,
    });
    expect(session.settlement).toMatchObject({ passed: true });
    expect(initial).toMatchObject({
      rawTranscript: 'We remain track Friday.',
      confirmedText: 'We remain on track for Friday.',
      revised: true,
      revisionStatus: 'applied',
    });
  });

  it('does not roll back a later session when revising an older transcript', () => {
    const item = makeItem({
      skeleton: 'We remain on track for X',
      zh: '我们仍可按计划完成 X',
    });
    state.items.push(item);
    const session = ensurePracticeSession(item.id, {
      source: 'due-review',
      sourceId: 'old-review',
      cue: { brief: '更新进度' },
    });
    const initial = beginPracticeAttempt(session.id, {
      answer: 'We remain track Friday.',
      inputMode: 'voice',
      rawTranscript: 'We remain track Friday.',
    });
    if (!initial) throw new Error('expected a voice attempt');
    settlePracticeAttempt(session.id, initial.id, false);
    grade(item.id, true, { answer: 'We remain on track for Monday.' });
    const laterSchedule = { box: item.box, dueAt: item.dueAt };

    revisePracticeAttempt(
      session.id,
      initial.id,
      'We remain on track for Friday.',
      true,
      { judgement: { ok: true } },
    );

    expect(item).toMatchObject(laterSchedule);
    expect(initial.revisionStatus).toBe('schedule_pending');
    expect(item.history).toHaveLength(2);
  });
});
