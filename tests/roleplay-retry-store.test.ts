import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));

import {
  activeRoleplaySession,
  addRoleplayTurn,
  completeRoleplayRetry,
  completeRoleplaySession,
  createRoleplaySession,
  flush,
  makeItem,
  startRoleplayRetry,
  state,
  updateRoleplayRetryDraft,
} from '../js/store.js';

describe('roleplay local retry store', () => {
  beforeEach(async () => {
    await flush();
    state.items = [];
    state.roleplaySessions = [];
    state.log = [];
  });

  it('keeps the original two-turn result and schedule unchanged', () => {
    const item = makeItem({
      skeleton: 'A good starting point would be to X',
      zh: '一个好的起点是 X',
      trigger: '当对方担心风险时，提出较小的第一步',
    });
    item.box = 3;
    state.items.push(item);
    let session = createRoleplaySession(item.id, {
      role: '客户',
      scenario: '客户担心扩大范围的风险',
      opening: 'Rolling this out everywhere feels risky.',
    });
    session = addRoleplayTurn(
      session.id,
      'user',
      'We can start with one team.',
    );
    session = addRoleplayTurn(
      session.id,
      'ai',
      'What scope would you choose?',
    );
    session = addRoleplayTurn(
      session.id,
      'user',
      'One department should be enough.',
    );
    session = completeRoleplaySession(session.id, {
      trigger_recognized: true,
      intent_achieved: true,
      used_target: false,
      issue_level: 'none',
      clear: true,
      concise: true,
      verdict: '沟通完成，但没有调用目标表达。',
      fix: null,
      tighter: null,
      note: '',
      retry_turn: 1,
    });
    const schedule = {
      box: item.box,
      dueAt: item.dueAt,
      historyLength: item.history.length,
      turns: session.turns.length,
    };

    startRoleplayRetry(session.id);
    expect(activeRoleplaySession(item.id)?.id).toBe(session.id);
    updateRoleplayRetryDraft(
      session.id,
      'A good starting point would be to pilot one team.',
      { promptUsed: true },
    );
    completeRoleplayRetry(session.id, {
      answer: 'A good starting point would be to pilot one team.',
      inputMode: 'text',
      ok: true,
      judgement: { ok: true },
    });

    expect(item).toMatchObject({
      box: schedule.box,
      dueAt: schedule.dueAt,
    });
    expect(item.history).toHaveLength(schedule.historyLength);
    expect(session.turns).toHaveLength(schedule.turns);
    expect(session.retryAttempts).toHaveLength(1);
    expect(session.retryAttempts?.[0]).toMatchObject({
      turn: 1,
      ok: true,
      promptUsed: true,
    });
  });
});
