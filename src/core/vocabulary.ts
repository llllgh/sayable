function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export type LearningGoal = 'recognition' | 'production';
export const DAY = 86_400_000;
export function normalizeLearningGoal(value: unknown): LearningGoal {
  return value === 'recognition' ? 'recognition' : 'production';
}
export function goalLabel(value: unknown): string {
  return value === 'recognition' ? '看懂即可' : '希望会用';
}
export interface RecognitionProgress {
  startedAt: number;
  successes: number[];
  dueAt: number | null;
  familiar: boolean;
}
export function emptyRecognition(): RecognitionProgress {
  return { startedAt: 0, successes: [], dueAt: null, familiar: false };
}
export function normalizeRecognition(value: any): RecognitionProgress {
  return {
    startedAt: Number(value?.startedAt) || 0,
    successes: Array.isArray(value?.successes)
      ? value.successes.filter((at: unknown) => Number.isFinite(at) && Number(at) > 0).slice(0, 2)
      : [],
    dueAt: Number.isFinite(value?.dueAt) ? value.dueAt : null,
    familiar: value?.familiar === true,
  };
}
/** Only an independent, due check can advance a delayed stage. */
export function nextRecognition(
  input: RecognitionProgress,
  result: 'understood' | 'unfamiliar',
  hinted: boolean,
  at: number,
): RecognitionProgress {
  const progress = normalizeRecognition(input);
  if (result === 'unfamiliar') {
    return { startedAt: 0, successes: [], dueAt: at + DAY, familiar: false };
  }
  if (!progress.startedAt) {
    return { startedAt: at, successes: [], dueAt: at + DAY, familiar: false };
  }
  if (hinted) return { ...progress, dueAt: at + DAY };
  if (progress.familiar || progress.dueAt === null || at < progress.dueAt) return progress;
  const date = localDateKey(new Date(at));
  if (progress.successes.some(success => localDateKey(new Date(success)) === date)) {
    return { ...progress, dueAt: Math.max(progress.dueAt, at + DAY) };
  }
  const successes = [...progress.successes, at];
  const familiar = successes.length >= 2;
  return {
    ...progress,
    successes,
    familiar,
    dueAt: familiar ? null : Math.max(progress.startedAt + 7 * DAY, at + DAY),
  };
}

export function normalizeVocabularyTask(value: any): any {
  if (!value || typeof value !== 'object' || !value.id) return null;
  const ids = Array.isArray(value.itemIds) ? [...new Set(value.itemIds.filter((id: unknown) => typeof id === 'string'))] : [];
  return {
    ...value,
    itemIds: ids,
    completedIds: Array.isArray(value.completedIds) ? value.completedIds.filter((id: unknown) => ids.includes(id)) : [],
    groupIds: Array.isArray(value.groupIds) ? value.groupIds.filter((id: unknown) => ids.includes(id)).slice(0, 5) : [],
    paused: value.paused === true,
  };
}

export function normalizeRecognitionSession(value: any): any {
  if (!value?.id || !value.itemId || !value.sentence || !value.explanation) return null;
  return {
    ...value,
    goalRevision: Number(value.goalRevision) || 0,
    hinted: value.hinted === true,
    answerDraft: String(value.answerDraft || ''),
    result: ['understood', 'unfamiliar'].includes(value.result) ? value.result : '',
    settledAt: Number(value.settledAt) || 0,
    completedAt: Number(value.completedAt) || 0,
  };
}
