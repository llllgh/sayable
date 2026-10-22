import { describe, expect, it } from 'vitest';
import { createPracticeSessionRecord, normalizePracticeSession, type PracticeSession } from '../src/core/practice-session';
import { normalizeProblemPractice, problemEvidence, problemGroups, type ProblemDecision } from '../src/core/expression-problems';
import { judgeSchema, problemCueSchemaFor } from '../src/llm/schemas';

function session(id: string, overrides: Record<string, unknown> = {}): PracticeSession {
  const result = createPracticeSessionRecord({ id, itemId: 'item', source: 'due-review', now: 100,
    cue: { brief: '说明检查能减少延误', targetZh: '提前检查能减少延误。' } });
  result.attempts = [{
    id: 'first', kind: 'initial', status: 'judged', answer: 'Checking the plan help us.',
    confirmedText: 'Checking the plan help us.', rawTranscript: '', revised: false, revisedAt: 0,
    revisionStatus: 'none', promptUsed: true, judgementSource: 'model', inputMode: 'text',
    startedAt: 100, completedAt: 200, error: '', feedback: null,
    judgement: { used_target: true, issue_level: 'minor', fix: 'Checking the plan helps us.',
      problem_tags: [{ category: 'grammar', quote: 'help', reason: '动名词主语使用单数谓语。' }] },
    ...overrides,
  }];
  return result;
}

describe('evidence-based expression problems', () => {
  it('requires two distinct first judgements and does not count duplicates or retries', () => {
    const first = session('one');
    first.attempts.push({ ...first.attempts[0], id: 'retry', kind: 'retry' });
    expect(problemGroups([first, first])).toEqual([]);
    const groups = problemGroups([first, session('two')]);
    expect(groups[0]).toMatchObject({ id: 'grammar', count: 2, confirmedCount: 0, trainable: false });
  });
  it('excludes reveal, failed service, self judgement and recognition but accepts standard guided first answers', () => {
    expect(problemEvidence([
      session('reveal', { kind: 'reveal' }), session('self', { judgementSource: 'self' }),
      session('error', { status: 'error' }), { ...session('recognition'), learningGoal: 'recognition' },
    ])).toEqual([]);
    expect(problemEvidence([session('guided')])).toHaveLength(1);
  });
  it('does not infer old language errors from free text; retains reliable target failures', () => {
    expect(problemEvidence([session('old', { judgement: { note: '语法和搭配不自然', fix: 'Corrected.' } })])).toEqual([]);
    expect(problemEvidence([session('old', { judgement: { used_target: false } })])[0])
      .toMatchObject({ category: 'target_usage', kind: 'target' });
  });
  it('filters invented quotes, punctuation-only corrections and mislabeled optional fixes', () => {
    const base = session('one');
    base.attempts[0].judgement!.problem_tags = [
      { category: 'grammar', quote: 'invented', reason: '需要修正。' },
      { category: 'conciseness', quote: 'help', reason: '可以精简。' },
    ];
    expect(problemEvidence([base])).toEqual([]);
    base.attempts[0].judgement = {
      issue_level: 'minor', fix: 'checking the plan help us!',
      problem_tags: [{ category: 'grammar', quote: 'help', reason: '需要修正。' }],
    };
    expect(problemEvidence([base])).toEqual([]);
  });
  it('supports confirmation, reclassification and ignoring without changing sessions', () => {
    const sessions = [session('one'), session('two')];
    const entries = problemEvidence(sessions);
    const decisions: ProblemDecision[] = entries.map(entry => ({ evidenceId: entry.id, category: 'collocation', action: 'confirm', at: 300 }));
    expect(problemGroups(sessions, decisions)[0]).toMatchObject({ id: 'collocation', confirmedCount: 2, trainable: true });
    decisions[0].action = 'ignore';
    expect(problemGroups(sessions, decisions)).toEqual([]);
    expect(sessions[0].attempts[0].answer).toBe('Checking the plan help us.');
  });
  it('invalidates old confirmation after a transcript revision', () => {
    const sessions = [session('one'), session('two')];
    const entries = problemEvidence(sessions);
    const decisions = entries.map(entry => ({ evidenceId: entry.id, category: entry.category, action: 'confirm' as const, at: 300 }));
    sessions[0].attempts[0].confirmedText = 'Checking this plan help us.';
    expect(problemGroups(sessions, decisions)[0]).toMatchObject({ confirmedCount: 1, trainable: false });
  });
  it('separates optional language refinements from target gaps and completed training', () => {
    const optional = session('optional', { judgement: {
      issue_level: 'none', fix: null, tighter: 'Plan checks help.',
      problem_tags: [{ category: 'conciseness', quote: 'Checking', reason: '原句可接受，可以更短。' }],
    } });
    expect(problemEvidence([optional])[0]).toMatchObject({ kind: 'optional' });
    const completed = session('complete');
    completed.completedAt = 300;
    completed.problemFocus = { category: 'grammar', evidenceIds: [], referenceAnswer: 'Reference.' };
    const reveal = { ...completed, id: 'only-reveal', attempts: [{ ...completed.attempts[0], kind: 'reveal' as const }] };
    expect(problemGroups([session('one'), session('two'), completed, reveal])[0].completedCount).toBe(1);
  });
  it('restores the hidden answer snapshot and interrupts only a generating task', () => {
    const target = session('target');
    target.problemFocus = { category: 'grammar', evidenceIds: ['e'], referenceAnswer: 'Hidden reference.' };
    expect(normalizePracticeSession(target)?.problemFocus).toEqual(target.problemFocus);
    expect(normalizeProblemPractice({ id: 't', itemId: 'item', category: 'grammar', status: 'generating' }))
      .toMatchObject({ status: 'error', error: '上次出题未完成，请重试' });
  });
});

describe('problem contracts', () => {
  it('never fails the main judgement because one optional tag is invalid', () => {
    const value = { ok: true, used_target: true, meaning_intact: true, issue_level: 'none', verdict: '通过',
      fix: null, tighter: null, problem_tags: [null, { category: 'unknown' },
        { category: 'grammar', quote: 'help', reason: '主谓一致。' }] };
    expect(judgeSchema.parse(value).problem_tags).toHaveLength(1);
  });
  it('requires an English target, a Chinese task and a new scenario beyond evidence answers', () => {
    const item = { kind: 'term', skeleton: 'mitigate', seeds: ['We can mitigate delivery risks by ordering parts early.'] };
    const evidence = problemEvidence([session('one')]);
    const cue = { trigger: '当服务出现故障时，提出降低风险的方案', brief: '说明多区域备份能降低服务中断的风险',
      target_zh: '多区域备份能降低服务中断的风险。', answer: 'Regional backups can mitigate the risk of service outages.' };
    expect(problemCueSchemaFor(item, evidence).safeParse(cue).success).toBe(true);
    expect(problemCueSchemaFor(item, evidence).safeParse({ ...cue, answer: item.seeds[0] }).success).toBe(false);
    expect(problemCueSchemaFor(item, evidence).safeParse({ ...cue, brief: 'Use mitigate here' }).success).toBe(false);
    expect(problemCueSchemaFor(item, evidence).safeParse({ ...cue, target_zh: evidence[0].targetZh }).success).toBe(false);
  });
});
