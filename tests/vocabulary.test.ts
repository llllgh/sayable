import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../src/storage/database.ts', () => ({
  savePersistedState: vi.fn().mockResolvedValue(undefined),
  writeLocalLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../src/storage/backup.ts', () => ({}));
vi.mock('../src/platform/secure.ts', () => ({}));
import { emptyRecognition, nextRecognition, DAY } from '../src/core/vocabulary';
import { migratePersistedState } from '../src/storage/state-migrations';
import { vocabularyMaterialSchemaFor } from '../src/llm/schemas';
import * as S from '../js/store.js';
import { savePersistedState } from '../src/storage/database';
import { termAppearsInSentence } from '../src/core/learning-items';
import { sourceExtractionSchemaFor } from '../src/llm/schemas';

const start = new Date(2026, 9, 17, 12).getTime();
const material = { sentence: 'The library is a gateway to a lifetime of learning.', explanation: '这里指通向学习的途径。' };
const candidate = { kind: 'term', skeleton: 'gateway', lemma: 'gateway', zh: '网关', sense: '网关',
  termCategory: 'professional', quote: 'The gateway routes traffic between services.', suggestedGoal: 'recognition' };
const body = `${candidate.quote} ${'Teams deploy services independently and monitor traffic to keep applications reliable. '.repeat(15)}`;

describe('finite recognition review', () => {
  it('starts at first understanding and needs two distinct delayed successes', () => {
    let progress = nextRecognition(emptyRecognition(), 'understood', false, start);
    expect(progress).toMatchObject({ startedAt: start, dueAt: start + DAY, successes: [] });
    progress = nextRecognition(progress, 'understood', false, start + 2 * DAY);
    expect(progress.dueAt).toBe(start + 7 * DAY);
    progress = nextRecognition(progress, 'understood', false, start + 2 * DAY + 1000);
    expect(progress.successes).toHaveLength(1);
    progress = nextRecognition(progress, 'understood', false, start + 7 * DAY);
    expect(progress).toMatchObject({ familiar: true, dueAt: null });
  });
  it('overdue first review cannot clear both stages on one day', () => {
    let progress = nextRecognition(emptyRecognition(), 'understood', false, start);
    progress = nextRecognition(progress, 'understood', false, start + 20 * DAY);
    expect(progress.dueAt).toBe(start + 21 * DAY);
    progress = nextRecognition(progress, 'understood', false, start + 20 * DAY + 1000);
    expect(progress.successes).toHaveLength(1);
  });
  it('hinted answers retain the stage; unfamiliar restarts without fake success', () => {
    let progress = nextRecognition(emptyRecognition(), 'understood', true, start);
    progress = nextRecognition(progress, 'understood', true, start + DAY);
    expect(progress.successes).toHaveLength(0);
    expect(progress.dueAt).toBe(start + 2 * DAY);
    progress = nextRecognition(progress, 'unfamiliar', false, start + 2 * DAY);
    expect(progress).toMatchObject({ startedAt: 0, successes: [], familiar: false });
  });
});

describe('vocabulary state and persistence', () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(start);
    S.state.items = []; S.state.sourceDocuments = []; S.state.sourceCandidates = [];
    S.state.vocabularyTasks = []; S.state.recognitionSessions = [];
    S.state.practiceSessions = []; S.state.log = [];
    vi.mocked(savePersistedState).mockResolvedValue(undefined);
  });
  afterEach(() => vi.useRealTimers());
  function imported() {
    const document = S.createSourceDocument({ body, title: 'Transcript' });
    S.completeSourceChunk(document.id, 0, [candidate]);
    return { document, candidate: S.state.sourceCandidates[0] };
  }
  it('selection does not count as learning, preserves evidence and excludes recommendations', async () => {
    const { document, candidate } = imported();
    S.selectSourceCandidate(candidate.id, 'recognition');
    expect(S.pendingSourceCandidatePool()).toHaveLength(0);
    const task = await S.saveVocabularySelection(document.id);
    const item = S.getItem(task.itemIds[0]);
    expect(item).toMatchObject({ learningGoal: 'recognition', learningStarted: false, dueAt: null });
    expect(S.dueItems()).toHaveLength(0);
    S.deleteSourceDocument(document.id);
    expect(item.evidence[0].quote).toBe(candidate.quote);
    expect(S.pendingVocabularyTask()?.id).toBe(task.id);
  });
  it('familiar candidate is sense scoped and can be undone', () => {
    const { candidate } = imported();
    S.selectSourceCandidate(candidate.id, 'known');
    expect(S.pendingSourceCandidatePool()).toHaveLength(0);
    expect(S.state.items).toHaveLength(0);
    S.selectSourceCandidate(candidate.id, '');
    expect(S.pendingSourceCandidatePool()).toHaveLength(1);
  });
  it('merges the same sense across sources but keeps a different sense', async () => {
    const first = imported();
    S.selectSourceCandidate(first.candidate.id, 'recognition');
    await S.saveVocabularySelection(first.document.id);
    const second = S.createSourceDocument({ body, title: 'Second' });
    S.completeSourceChunk(second.id, 0, [candidate, { ...candidate, sense: '通向某事的途径', zh: '通向某事的途径' }]);
    expect(S.sourceCandidatesFor(second.id)).toHaveLength(2);
    expect(S.sourceCandidatesFor(second.id)[0].itemId).toBe(S.state.items[0].id);
    expect(S.state.items[0].evidence).toHaveLength(2);
    expect(S.sourceCandidatesFor(second.id)[1].itemId).toBe('');
  });
  it('recognition is idempotent and never creates output or mastery evidence', () => {
    const item = S.addItem({ ...candidate, learningGoal: 'recognition', learningStarted: false });
    const session = S.beginRecognitionSession(item.id, 'test', material);
    S.hintRecognition(session.id);
    S.settleRecognition(session.id, 'understood');
    vi.setSystemTime(start + DAY);
    S.settleRecognition(session.id, 'understood');
    expect(item.recognition.startedAt).toBe(start);
    expect(item.recognition.successes).toHaveLength(0);
    expect(item.box).toBe(0); expect(item.mine).toHaveLength(0);
    expect(S.metrics().owned).toBe(0);
  });
  it('old output response after a goal switch retains history without changing new schedule', () => {
    const item = S.addItem(candidate);
    item.box = 3;
    const session = S.ensurePracticeSession(item.id);
    const attempt = S.beginPracticeAttempt(session.id, { answer: 'The gateway routes traffic.' });
    S.setLearningGoal(item.id, 'recognition');
    S.settlePracticeAttempt(session.id, attempt!.id, true);
    expect(item.box).toBe(3); expect(item.dueAt).toBeNull();
    expect(item.history[0].scheduleApplied).toBe(false);
    S.setLearningGoal(item.id, 'production');
    expect(item.box).toBe(3);
    expect(item.dueAt).toBeNull();
    expect(S.activePracticeSession(item.id, 'practice')).toBeNull();
  });
  it('recognition response after switching back cannot mutate active output progress', () => {
    const item = S.addItem({ ...candidate, learningGoal: 'recognition' });
    const session = S.beginRecognitionSession(item.id, 'test', material);
    S.setLearningGoal(item.id, 'production');
    const before = item.dueAt;
    S.settleRecognition(session.id, 'understood');
    expect(item.dueAt).toBe(before);
    expect(session.scheduleApplied).toBe(false);
    expect(item.recognition.startedAt).toBe(0);
  });
  it('rollback keeps selection reviewable when durable save fails', async () => {
    const { document, candidate } = imported();
    S.selectSourceCandidate(candidate.id, 'recognition');
    vi.mocked(savePersistedState).mockRejectedValue(new Error('disk full'));
    await expect(S.saveVocabularySelection(document.id)).rejects.toThrow('disk full');
    expect(S.state.items).toHaveLength(0);
    expect(S.state.sourceCandidates[0].selection).toBe('recognition');
    expect(S.state.vocabularyTasks).toHaveLength(0);
    vi.mocked(savePersistedState).mockResolvedValue(undefined);
    S.save(); await S.flush();
  });
  it('freezes five members, does not open the next group on return and restores backup evidence', async () => {
    const { document } = imported();
    const quotes = Array.from({ length: 6 }, (_, index) => ({
      ...candidate, lemma: `gateway${index}`, skeleton: `gateway${index}`, sense: `义项${index}`, zh: `义项${index}`,
      id: `candidate${index}`, documentId: document.id, quote: candidate.quote,
      selection: 'recognition', itemId: '', evidence: [],
    }));
    S.state.sourceCandidates = quotes;
    const saved = await S.saveVocabularySelection(document.id);
    const task = S.resumeVocabularyTask(saved.id);
    expect(task.groupIds).toHaveLength(5);
    for (const itemId of task.groupIds) S.completeVocabularyItem(task.id, itemId);
    expect(S.remainingVocabulary(task)).toHaveLength(1);
    S.resumeVocabularyTask(task.id);
    expect(task.groupIds).toHaveLength(5);
    expect(task.groupIds.every((id: string) => task.completedIds.includes(id))).toBe(true);
    const backup = JSON.parse(S.exportJSON());
    expect(backup.vocabularyTasks[0].groupIds).toEqual(task.groupIds);
    expect(backup.items.every((item: any) => item.dueAt === null)).toBe(true);
    expect(backup.settings.apiKey).toBeUndefined();
  });
  it('a revised old output answer cannot restore a disabled goal snapshot', () => {
    const item = S.addItem(candidate);
    const session = S.ensurePracticeSession(item.id);
    const attempt = S.beginPracticeAttempt(session.id, { answer: 'The gateway routes traffic.' })!;
    S.settlePracticeAttempt(session.id, attempt.id, true);
    S.setLearningGoal(item.id, 'recognition');
    S.revisePracticeAttempt(session.id, attempt.id, 'The gateway connects networks.', true);
    expect(item.dueAt).toBeNull();
    expect(item.learningGoal).toBe('recognition');
    expect(item.recognition.successes).toHaveLength(0);
  });
  it('restores a previously practiced output ladder with a fresh due time', () => {
    const item = S.addItem(candidate);
    const session = S.ensurePracticeSession(item.id);
    const attempt = S.beginPracticeAttempt(session.id, { answer: 'The gateway connects networks.' })!;
    S.settlePracticeAttempt(session.id, attempt.id, true);
    const box = item.box;
    S.setLearningGoal(item.id, 'recognition');
    vi.setSystemTime(start + 10 * DAY);
    S.setLearningGoal(item.id, 'production');
    expect(item.box).toBe(box);
    expect(item.dueAt).toBe(start + 10 * DAY);
    expect(item.recognition.successes).toHaveLength(0);
    expect(item.usedReal).toHaveLength(0);
  });
  it('v13 migration preserves legacy term progress and carries new recovery state', () => {
    const result: any = migratePersistedState({
      formatVersion: 13, items: [{ ...candidate, box: 4, dueAt: start, history: [{ ok: true }], usedReal: [{ at: start }] }],
      vocabularyTasks: [{ id: 'task', itemIds: ['word'], groupIds: ['word'], completedIds: [] }],
      recognitionSessions: [{ id: 'session', itemId: 'word', ...material, hinted: true }],
    });
    expect(result.items[0]).toMatchObject({ learningGoal: 'production', box: 4, dueAt: start, recognition: { successes: [] } });
    expect(result.vocabularyTasks[0].groupIds).toEqual(['word']);
    expect(result.recognitionSessions[0].hinted).toBe(true);
    expect(result.formatVersion).toBe(14);
  });
});

it('material validation rejects unchanged contexts and accepts recognition without collocations', () => {
  const item = { ...candidate, learningGoal: 'recognition', source: { raw: candidate.quote } };
  const valid = { ...material, usage: '指网络网关', sentence: 'Our new gateway connects the remote office to the central network.' };
  const schema = vocabularyMaterialSchemaFor(item);
  expect(schema.safeParse(valid).success).toBe(true);
  expect(schema.parse({ ...valid, collocations: ['gateway service'], drill: {
    brief: '描述另一个网络', target_zh: '这个网关连接两个网络。', answer: 'This gateway connects two networks.',
  } })).toMatchObject({ collocations: [], drill: null });
  expect(schema.safeParse({ ...valid, usage: 'A network entry point' }).success).toBe(false);
  expect(schema.safeParse({ ...valid, explanation: 'It connects networks.' }).success).toBe(false);
  expect(vocabularyMaterialSchemaFor(item).safeParse({ ...valid, sentence: candidate.quote }).success).toBe(false);
  expect(vocabularyMaterialSchemaFor({ ...item, learningGoal: 'production' }).safeParse(valid).success).toBe(false);
});

it('keeps valid source candidates when a sibling is malformed and accepts inflected fixed phrases', () => {
  const result = sourceExtractionSchemaFor(body).parse({ items: [{ wrong: true }, candidate] });
  expect(result.items).toHaveLength(1);
  expect(result.filteredCount).toBe(1);
  expect(termAppearsInSentence('rule out', 'They ruled out a hardware fault.')).toBe(true);
  expect(termAppearsInSentence('rule out', 'She is ruling out other explanations.')).toBe(true);
  const englishSense = { ...candidate, sense: 'A network entry point' };
  expect(sourceExtractionSchemaFor(body).parse({ items: [englishSense, candidate] }).items).toHaveLength(1);
  expect(sourceExtractionSchemaFor(body).parse({ items: [englishSense] }).filteredCount).toBe(1);
  const nullableSkeleton = sourceExtractionSchemaFor(body).parse({
    items: [{ ...candidate, skeleton: null }],
  });
  expect(nullableSkeleton.items[0]).toMatchObject({ skeleton: 'gateway', lemma: 'gateway' });
  expect(nullableSkeleton.filteredCount).toBe(0);
  expect(sourceExtractionSchemaFor(body).parse({
    items: [{ ...candidate, skeleton: null, lemma: null }],
  }).items).toHaveLength(0);
});
