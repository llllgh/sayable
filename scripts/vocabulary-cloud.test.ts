import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
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

const transcript = `When our guest joined the team, she inherited a tremendous amount of technical debt. She did not try to eliminate every problem at once. Instead, she looked for small changes that could mitigate the risk of a major outage. The gateway was a particular concern because every customer request passed through it. A single failure there could disrupt the entire service.
She asked the engineers to rule out configuration errors before replacing the hardware. That turned out to be a good starting point. The team discovered that a recent update had introduced a subtle change to the retry behavior. Extra retries increased traffic and made the original problem worse.
The lesson was not that retries are always bad. They can be useful, provided that teams understand the trade-offs. What matters is knowing when a small improvement becomes a tremendous burden. She encouraged everyone to articulate their assumptions clearly and to distinguish temporary workarounds from lasting solutions.
Later, she described the project as a gateway to new opportunities. The same engineers who had been maintaining old systems began building tools that other teams could use. They were still cautious, but they no longer felt that every new request would derail their plans.`;

describe.skipIf(process.env.LOCUE_VOCABULARY_LIVE !== '1')('live vocabulary service', () => {
  it('extracts grounded candidates and prepares both learning paths using live service', async () => {
    process.loadEnvFile('.env');
    const prefix = process.env.LOCUE_VOCABULARY_PROVIDER || (process.env.ARK_API_KEY ? 'ARK' : 'GEMINI');
    Object.assign(S.state.settings, {
      providerMode: 'custom', apiKey: process.env[`${prefix}_API_KEY`],
      baseUrl: process.env.LOCUE_VOCABULARY_BASE_URL || process.env[`${prefix}_BASE_URL`],
      model: process.env.LOCUE_VOCABULARY_MODEL || process.env[`${prefix}_MODEL_ID`],
      protocol: process.env.LOCUE_VOCABULARY_PROTOCOL || process.env[`${prefix}_PROTOCOL`] || 'chat_completions',
      maxRetry: 0, dailyLimit: 60,
      supportsJsonMode: process.env.LOCUE_VOCABULARY_JSON_MODE === '0' ? false : null,
    });
    S.state.log = [];
    const outputDirectory = process.env.LOCUE_VOCABULARY_OUTPUT_DIR || join(tmpdir(), 'locue-vocabulary-validation');
    mkdirSync(outputDirectory, { recursive: true });
    const evidence: Record<string, unknown> = { transcript, protocol: S.state.settings.protocol };
    const persistEvidence = () => writeFileSync(join(outputDirectory, 'cloud.json'), JSON.stringify(evidence, null, 2));
    const fetchOriginal = globalThis.fetch.bind(globalThis);
    const rawExtraction: unknown[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (...args) => {
      const response = await fetchOriginal(...args);
      const body = await response.clone().json().catch(() => null);
      if (body?.choices?.[0]?.message?.content) rawExtraction.push(body.choices[0].message.content);
      if (body?.candidates?.[0]?.content?.parts) {
        rawExtraction.push(body.candidates[0].content.parts
          .filter((part: { thought?: boolean; text?: unknown }) => !part.thought && typeof part.text === 'string')
          .map((part: { text: string }) => part.text).join(''));
      }
      return response;
    });
    let extracted;
    try {
      extracted = await L.extractSourceChunk(transcript, { title: '工程访谈测试语料' });
    } finally {
      fetchSpy.mockRestore();
      evidence.rawExtraction = rawExtraction; persistEvidence();
    }
    evidence.extracted = extracted;
    persistEvidence();
    console.log(JSON.stringify({ stage: 'extraction', candidates: extracted.items.length, filtered: extracted.filteredCount }));
    expect(extracted.items.length).toBeGreaterThan(0);
    expect(extracted.items.some(item => item.kind === 'term')).toBe(true);
    let gateway = extracted.items.find(item => item.kind === 'term' && item.lemma?.toLowerCase() === 'gateway');
    let mitigate = extracted.items.find(item => item.kind === 'term' && item.lemma?.toLowerCase() === 'mitigate');
    const supplemented: unknown[] = [];
    if (!gateway) {
      gateway = await L.explainSelectedVocabulary('gateway', 'The gateway was a particular concern because every customer request passed through it.');
      supplemented.push(gateway);
    }
    if (!mitigate) {
      mitigate = await L.explainSelectedVocabulary('mitigate', 'Instead, she looked for small changes that could mitigate the risk of a major outage.');
      supplemented.push(mitigate);
    }
    evidence.supplemented = supplemented; persistEvidence();
    expect(gateway?.kind).toBe('term'); expect(mitigate?.kind).toBe('term');
    const recognition = await L.prepareVocabularyMaterial({
      ...gateway, learningGoal: 'recognition', source: { raw: gateway!.quote },
    });
    evidence.recognition = recognition; persistEvidence();
    console.log(JSON.stringify({ stage: 'recognition', ready: Boolean(recognition.sentence) }));
    const production = await L.prepareVocabularyMaterial({
      ...mitigate, learningGoal: 'production', source: { raw: mitigate!.quote },
    });
    evidence.production = production; persistEvidence();
    console.log(JSON.stringify({ stage: 'production', ready: Boolean(production.drill?.answer) }));
    const targetJudgement = await L.judge({
      kind: 'term', termCategory: mitigate.termCategory, skeleton: mitigate.lemma,
      zh: mitigate.sense, brief: production.drill!.brief,
      answer: production.drill!.answer, seeds: [production.anchorSentence],
    });
    expect(targetJudgement.ok).toBe(true);
    const alternativeJudgement = await L.judge({
      kind: 'term', termCategory: mitigate.termCategory, skeleton: mitigate.lemma,
      zh: mitigate.sense, brief: production.drill!.brief,
      answer: production.drill!.answer.replace(/mitigate/giu, 'reduce'), seeds: [production.anchorSentence],
    });
    expect(alternativeJudgement.used_target).toBe(false);
    expect(alternativeJudgement.ok).toBe(false);
    evidence.judgements = { targetJudgement, alternativeJudgement }; persistEvidence();
    console.log(JSON.stringify({ stage: 'judgement', targetPassed: targetJudgement.ok, alternativeAdvancesTarget: alternativeJudgement.ok }));
    const manual = await L.explainSelectedVocabulary('inherited', 'When our guest joined the team, she inherited a tremendous amount of technical debt.');
    expect(manual.kind).toBe('term');
    evidence.manual = manual; persistEvidence();
    console.log(JSON.stringify({ candidates: extracted.items.length, filtered: extracted.filteredCount,
      recognition: Boolean(recognition.sentence), production: Boolean(production.drill?.answer), manual: manual.lemma }));
  }, 240_000);
});
