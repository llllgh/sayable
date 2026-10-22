import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
vi.mock('../src/platform/network.ts', () => ({ isOnline: () => true }));
vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));
import * as S from '../js/store.js';
import * as L from '../js/llm.js';

describe.skipIf(process.env.LOCUE_PROBLEMS_LIVE !== '1')('live expression problem loop', () => {
  it('classifies real model judgements, generates a new scene and judges the targeted answer', async () => {
    // Existing local test configuration: comment lines 11–13 hold Google native credentials.
    // No credentials or request headers are written to the evidence or console.
    const relay = process.env.LOCUE_PROBLEMS_PROVIDER === 'relay';
    const raw = readFileSync('.env', 'utf8');
    const configuration = parseEnv(relay ? raw : raw.split(/\r?\n/).slice(10, 13)
      .map(line => line.replace(/^\s*#\s?/, '')).join('\n'));
    const endpoint = String(configuration.GEMINI_BASE_URL || '').replace(/\/$/, '')
      .replace(/\/v1beta\/openai$/, '/v1beta');
    Object.assign(S.state.settings, {
      providerMode: 'custom', apiKey: configuration.GEMINI_API_KEY,
      baseUrl: endpoint.endsWith('/v1beta') ? endpoint : `${endpoint}/v1beta`,
      model: configuration.GEMINI_MODEL_ID, protocol: 'gemini',
      maxRetry: 0, dailyLimit: 60, supportsJsonMode: true, onboarded: true,
    });
    expect(S.isLive()).toBe(true);
    S.state.items = []; S.state.practiceSessions = [];
    S.state.problemDecisions = []; S.state.problemPractice = null; S.state.log = [];
    const item = S.makeItem({
      skeleton: 'Reviewing X helps us Y',
      zh: '检查某事有助于我们完成某事',
      seeds: ['Reviewing deployment logs helps us identify failures before release.'],
      drill: { brief: '说明检查日志帮助团队发现发布故障', target_zh: '检查部署日志有助于我们在发布前发现故障。' },
    });
    S.state.items.push(item);
    const directory = process.env.LOCUE_PROBLEMS_OUTPUT_DIR || join(tmpdir(), 'locue-f19-live');
    mkdirSync(directory, { recursive: true });
    const evidence: Record<string, unknown> = { protocol: 'gemini', provider: relay ? 'Configured relay' : 'Google native', judgements: [] };
    const saveEvidence = (name = 'snapshot.json') => {
      writeFileSync(join(directory, 'cloud.json'), JSON.stringify(evidence, null, 2));
      const snapshot = JSON.parse(S.exportJSON());
      // Fixture snapshots contain only generated test data and no provider configuration.
      snapshot.settings = { onboarded: true, providerMode: 'custom', apiKey: '', baseUrl: '', model: '' };
      writeFileSync(join(directory, name), JSON.stringify(snapshot, null, 2));
    };
    const cases = [
      { brief: '说明检查部署日志帮助团队在发布前发现故障', answer: 'Reviewing deployment logs help us identify failures before release.' },
      { brief: '说明检查预算帮助团队在审批前发现超支', answer: 'Reviewing the budget help us spot cost overruns before approval.' },
    ];
    for (const [index, test] of cases.entries()) {
      const session = S.ensurePracticeSession(item.id, { source: 'library-practice', sourceId: `live-f19-${index}`,
        cue: { brief: test.brief, target_zh: test.brief } });
      const attempt = S.beginPracticeAttempt(session.id, { answer: test.answer, inputMode: 'text' })!;
      const judgement = await L.judge({ skeleton: item.skeleton, zh: item.zh, seeds: item.seeds, ...test });
      (evidence.judgements as unknown[]).push(judgement);
      S.settlePracticeAttempt(session.id, attempt.id, Boolean(judgement.ok), { judgement });
      S.completePracticeSession(session.id); saveEvidence();
      expect(S.expressionProblemEvidence().some(entry => entry.sessionId === session.id && entry.category === 'grammar')).toBe(true);
      console.log(JSON.stringify({ stage: 'first-answer', index, tags: judgement.problem_tags, passed: judgement.ok }));
    }
    expect(S.expressionProblems()[0]).toMatchObject({ id: 'grammar', count: 2, trainable: false });
    S.confirmExpressionProblem('grammar');
    const started = S.beginProblemPractice('grammar');
    const drill = await L.regenerateReviewCue(item, {
      label: started.group!.label, focus: started.group!.focus, evidence: started.evidence!,
    });
    evidence.drill = drill;
    S.completeProblemPracticeCue(started.task.requestId, drill); saveEvidence('ready-snapshot.json');
    expect(item.drill.answer).toBeUndefined();
    const session = S.getPracticeSession(started.task.sessionId)!;
    const attempt = S.beginPracticeAttempt(session.id, { answer: drill.answer, inputMode: 'text' })!;
    const judgement = await L.judge({ skeleton: item.skeleton, zh: item.zh, brief: drill.brief,
      answer: drill.answer, seeds: item.seeds, problemFocus: started.group!.focus });
    evidence.targetedJudgement = judgement;
    S.settlePracticeAttempt(session.id, attempt.id, Boolean(judgement.ok), { judgement });
    S.completePracticeSession(session.id);
    expect(judgement.ok).toBe(true);
    expect(S.expressionProblems()[0].completedCount).toBe(1);
    evidence.completedCount = S.expressionProblems()[0].completedCount; saveEvidence();
    console.log(JSON.stringify({ stage: 'targeted-complete', drill, passed: judgement.ok, completedCount: 1 }));
  }, 180_000);
});
