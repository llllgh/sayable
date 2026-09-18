import { describe, expect, it } from 'vitest';
import {
  createPracticeSessionRecord,
  normalizePracticeSession,
  practiceSessionKey,
} from '../src/core/practice-session';

describe('practice session records', () => {
  it('creates stable source keys and cue snapshots', () => {
    const session = createPracticeSessionRecord({
      id: 'session-1',
      itemId: 'item-1',
      source: 'recommendation',
      sourceId: 'recommendation-1',
      now: 100,
      cue: {
        brief: '向客户确认时间',
        context: '项目会议',
        targetZh: '我们能否周五前确认？',
        trigger: '需要明确截止时间时',
      },
    });

    expect(practiceSessionKey(
      session.itemId,
      session.source,
      session.sourceId,
    )).toBe('item-1\u001frecommendation\u001frecommendation-1');
    expect(session).toMatchObject({
      phase: 'answering',
      answerDraft: '',
      attempts: [],
      settlement: null,
    });
  });

  it('recovers interrupted submissions as retryable errors with the answer intact', () => {
    const normalized = normalizePracticeSession({
      id: 'session-1',
      itemId: 'item-1',
      source: 'due-review',
      sourceId: 'item-1',
      startedAt: 100,
      updatedAt: 200,
      phase: 'submitting',
      cue: { brief: 'Give an update' },
      answerDraft: 'We remain on track.',
      attempts: [{
        id: 'attempt-1',
        kind: 'initial',
        status: 'submitting',
        answer: 'We remain on track.',
        inputMode: 'voice',
        startedAt: 200,
      }],
    });

    expect(normalized).toMatchObject({
      phase: 'answering',
      answerDraft: 'We remain on track.',
    });
    expect(normalized?.attempts[0]).toMatchObject({
      status: 'error',
      inputMode: 'voice',
      answer: 'We remain on track.',
      error: '上次检查在应用关闭时中断，请重新提交',
    });
  });

  it('restores an interrupted feedback retry to the editable answer phase', () => {
    const normalized = normalizePracticeSession({
      id: 'session-1',
      itemId: 'item-1',
      source: 'due-review',
      startedAt: 100,
      updatedAt: 300,
      phase: 'submitting',
      answerDraft: 'The risk is not cost but timing.',
      cue: { brief: '说明真正的风险' },
      attempts: [
        {
          id: 'initial',
          kind: 'initial',
          status: 'judged',
          answer: 'The risk is timing.',
          startedAt: 100,
          completedAt: 200,
        },
        {
          id: 'retry',
          kind: 'retry',
          status: 'submitting',
          answer: 'The risk is not cost but timing.',
          startedAt: 300,
        },
      ],
      settlement: {
        attemptId: 'initial',
        appliedAt: 200,
        passed: false,
        before: { box: 1, dueAt: 100 },
        after: { box: 0, dueAt: 400 },
      },
    });

    expect(normalized?.phase).toBe('answering');
    expect(normalized?.attempts[1]).toMatchObject({
      kind: 'retry',
      status: 'error',
      answer: 'The risk is not cost but timing.',
    });
  });
});
