import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  appendRoleplayTurn,
  createRoleplaySessionRecord,
  nextRoleplayReview,
  normalizeRoleplayResult,
  normalizeRoleplaySession,
  roleplayCommunicationPassed,
  roleplayEligibility,
  roleplayLeaksTarget,
  roleplayLeaksTrigger,
  roleplayPhase,
  roleplayTargetSucceeded,
  type RoleplayResult,
  type RoleplaySession,
} from '../src/core/roleplay';
import {
  roleplayContinueSchema,
  roleplayJudgeSchema,
  roleplayStartSchema,
} from '../src/llm/schemas';

const passingResult: RoleplayResult = {
  triggerRecognized: true,
  intentAchieved: true,
  usedTarget: true,
  issueLevel: 'minor',
  clear: true,
  concise: true,
  verdict: '沟通完成',
  fix: null,
  tighter: null,
  note: '',
  retryTurn: 2,
};

function session(turns: RoleplaySession['turns']): RoleplaySession {
  return {
    id: 'session-1',
    itemId: 'item-1',
    startedAt: 100,
    completedAt: 0,
    scenario: '客户担心扩大范围的风险',
    role: '客户 CTO',
    turns,
    result: null,
  };
}

describe('Level 4 roleplay', () => {
  it('only unlocks for online, configured items in active recall', () => {
    const item = {
      box: 3,
      trigger: '当客户担心风险时，提出先小范围试点',
      status: 'learning',
    };
    expect(roleplayEligibility(item)).toBe(true);
    expect(roleplayEligibility({ ...item, box: 2 })).toBe(false);
    expect(roleplayEligibility({ ...item, trigger: '' })).toBe(false);
    expect(roleplayEligibility({ ...item, status: 'retired' })).toBe(false);
    expect(roleplayEligibility(item, { modelReady: false, online: true }))
      .toBe(false);
    expect(roleplayEligibility(item, { modelReady: true, online: false }))
      .toBe(false);
  });

  it('enforces exactly two alternating user turns', () => {
    expect(roleplayPhase(session([
      { speaker: 'ai', text: 'We are concerned about risk.', at: 100 },
    ]))).toBe('awaiting_first_answer');
    expect(roleplayPhase(session([
      { speaker: 'ai', text: 'We are concerned about risk.', at: 100 },
      { speaker: 'user', text: 'We could start with one team.', at: 110 },
    ]))).toBe('awaiting_followup');
    expect(roleplayPhase(session([
      { speaker: 'ai', text: 'We are concerned about risk.', at: 100 },
      { speaker: 'user', text: 'We could start with one team.', at: 110 },
      { speaker: 'ai', text: 'What would that look like?', at: 120 },
    ]))).toBe('awaiting_second_answer');
  });

  it('creates and appends durable turns without mutating prior snapshots', () => {
    const started = createRoleplaySessionRecord({
      id: 'session-1',
      itemId: 'item-1',
      now: 100,
      role: '客户 CTO',
      scenario: '客户担心风险',
      opening: 'Rolling this out everywhere feels risky.',
    });
    const answered = appendRoleplayTurn(
      started,
      'user',
      'We could start with one department.',
      110,
    );

    expect(started.turns).toHaveLength(1);
    expect(answered.turns).toHaveLength(2);
    expect(roleplayPhase(answered)).toBe('awaiting_followup');
    expect(() => appendRoleplayTurn(answered, 'user', 'Another answer', 120))
      .toThrow('对话轮次不正确');
  });

  it('separates communication success from target-pattern success', () => {
    const alternative = { ...passingResult, usedTarget: false };
    expect(roleplayCommunicationPassed(alternative)).toBe(true);
    expect(roleplayTargetSucceeded(alternative)).toBe(false);
    expect(roleplayTargetSucceeded(passingResult)).toBe(true);
  });

  it('normalizes model output into the persisted result contract', () => {
    expect(normalizeRoleplayResult({
      trigger_recognized: true,
      intent_achieved: true,
      used_target: false,
      issue_level: 'none',
      clear: true,
      concise: false,
      verdict: '沟通完成',
      fix: '',
      tighter: 'We could start with one team.',
      note: '可以更短。',
    })).toEqual({
      triggerRecognized: true,
      intentAchieved: true,
      usedTarget: false,
      issueLevel: 'none',
      clear: true,
      concise: false,
      verdict: '沟通完成',
      fix: null,
      tighter: 'We could start with one team.',
      note: '可以更短。',
      retryTurn: 2,
    });
  });

  it('rejects malformed imported sessions and preserves valid ones', () => {
    const valid = normalizeRoleplaySession({
      id: 'session-1',
      itemId: 'item-1',
      startedAt: 100,
      completedAt: 200,
      scenario: '客户担心风险',
      role: '客户 CTO',
      turns: [
        { speaker: 'ai', text: 'How would you reduce the risk?', at: 100 },
        { speaker: 'user', text: 'We could start with one team.', at: 120 },
      ],
      result: passingResult,
    });
    expect(valid?.result).toEqual(passingResult);
    expect(normalizeRoleplaySession({
      ...valid!,
      turns: [{ speaker: 'user', text: 'Wrong first speaker.', at: 100 }],
    })).toBeNull();
  });

  it('only advances the ladder after target-pattern success', () => {
    const now = 1_000_000;
    expect(nextRoleplayReview(
      { box: 3, dueAt: now },
      passingResult,
      now,
    ).box).toBe(4);

    const alternative = nextRoleplayReview(
      { box: 3, dueAt: now },
      { ...passingResult, usedTarget: false },
      now,
    );
    expect(alternative.box).toBe(3);
    expect(alternative.dueAt).toBe(now + 8 * 60 * 60 * 1000);
  });

  it('rejects role lines that reveal the target skeleton', () => {
    const skeleton = 'A good starting point would be to X before scaling to Y';
    expect(roleplayLeaksTarget(
      'A good starting point would be to pilot one team before scaling to all departments.',
      skeleton,
    )).toBe(true);
    expect(roleplayLeaksTarget(
      'Rolling this out everywhere feels risky. How would you reduce the exposure?',
      skeleton,
    )).toBe(false);
    expect(roleplayLeaksTarget(
      'What matters is not model capability but workflow integration.',
      'What matters is not X, but Y.',
    )).toBe(true);
  });

  it('rejects scenario copy that reveals the expected action', () => {
    const trigger = '当客户担心一次性投入过大时，提出先小范围试点';
    expect(roleplayLeaksTrigger(
      '客户担心一次性投入过大，需要你提出先小范围试点',
      trigger,
    )).toBe(true);
    expect(roleplayLeaksTrigger(
      '客户计划扩大部署范围，但对治理风险没有把握',
      trigger,
    )).toBe(false);
  });

  it('validates all three structured model responses', () => {
    expect(roleplayStartSchema.safeParse({
      role: '客户 CTO',
      scenario: '客户担心治理风险',
      opening: 'Rolling this out everywhere feels risky.',
    }).success).toBe(true);
    expect(roleplayContinueSchema.safeParse({
      followup: 'What scope would you start with?',
    }).success).toBe(true);
    expect(roleplayJudgeSchema.safeParse({
      trigger_recognized: true,
      intent_achieved: true,
      used_target: false,
      issue_level: 'none',
      clear: true,
      concise: true,
      verdict: '沟通完成，但没有调用目标骨架。',
      fix: null,
      tighter: null,
      note: '',
      retry_turn: 1,
    }).success).toBe(true);
  });

  it('wires the route, two-turn UI, persistence, and three model calls', () => {
    const main = readFileSync('js/main.js', 'utf8');
    const view = readFileSync('js/roleplay.js', 'utf8');
    const store = readFileSync('js/store.js', 'utf8');
    const llm = readFileSync('js/llm.js', 'utf8');

    expect(main).toContain("hash.startsWith('roleplay/')");
    expect(view).toContain("S.addRoleplayTurn(session.id, 'user'");
    expect(view).toContain('await S.flush()');
    expect(view).toContain('session.turns.filter');
    expect(view).toContain('session.turns.slice(0, userTurnIndex)');
    expect(view).toContain('S.completeRoleplayRetry');
    expect(view).not.toContain('item.trigger');
    expect(store).toContain('roleplaySessions');
    expect(store).toContain('nextRoleplayReview');
    expect(llm).toContain("task: 'roleplay_start'");
    expect(llm).toContain("task: 'roleplay_continue'");
    expect(llm).toContain("task: 'roleplay_judge'");
    expect(llm).toContain("task: 'roleplay_retry'");
  });

  it('restores a local retry without adding another dialogue turn', () => {
    const normalized = normalizeRoleplaySession({
      id: 'session-1',
      itemId: 'item-1',
      startedAt: 100,
      completedAt: 200,
      scenario: '客户担心风险',
      role: '客户 CTO',
      turns: [
        { speaker: 'ai', text: 'How would you reduce the risk?', at: 100 },
        { speaker: 'user', text: 'We can start small.', at: 120 },
        { speaker: 'ai', text: 'What scope would you choose?', at: 140 },
        { speaker: 'user', text: 'One department.', at: 160 },
      ],
      result: { ...passingResult, retryTurn: 1 },
      retryActive: true,
      retryDraft: 'A good starting point would be',
      retryPromptUsed: true,
      retryAttempts: [],
    });

    expect(normalized).toMatchObject({
      retryActive: true,
      retryDraft: 'A good starting point would be',
      retryPromptUsed: true,
    });
    expect(normalized?.turns).toHaveLength(4);
  });

  it('ships a 20-case sanitized regression set', () => {
    const cases = readFileSync('eval/roleplay-cases.jsonl', 'utf8')
      .trim()
      .split('\n')
      .map(line => JSON.parse(line));
    expect(cases).toHaveLength(20);
    expect(new Set(cases.map(item => item.id)).size).toBe(20);
    for (const item of cases) {
      expect(item.skeleton).toBeTruthy();
      expect(item.trigger).toBeTruthy();
      expect(item.opening_intent).toBeTruthy();
      expect(item.must_not_contain.length).toBeGreaterThan(0);
    }
  });
});
