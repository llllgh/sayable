export const LADDER_DAYS = [0, 1, 3, 7, 21, 60] as const;
export const RETRY_MS = 8 * 60 * 60 * 1000;
export const DEFAULT_WEEKLY_NEW_TARGET = 15;
export const DEFERRED_REVIEW_BATCH_SIZE = 3;

export interface ReviewState {
  box: number;
  dueAt: number;
}

export function initialReviewDelayDays(
  itemsAddedBeforeThisOne: number,
  weeklyTarget = DEFAULT_WEEKLY_NEW_TARGET,
  dailyBatchSize = DEFERRED_REVIEW_BATCH_SIZE,
): number {
  const overflowPosition = Math.max(
    0,
    Math.floor(itemsAddedBeforeThisOne) - Math.max(0, weeklyTarget) + 1,
  );
  if (!overflowPosition) return 0;
  return 1 + Math.ceil(overflowPosition / Math.max(1, dailyBatchSize));
}

export function applyReviewNotBefore(
  review: ReviewState,
  reviewNotBefore: number,
): ReviewState {
  return {
    ...review,
    dueAt: Math.max(review.dueAt, Number(reviewNotBefore) || 0),
  };
}

function sameLocalDay(left: number, right: number): boolean {
  if (!left || !right) return false;
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

export function nextReview(
  current: ReviewState,
  passed: boolean,
  now: number,
  lastPassedAt = 0,
): ReviewState {
  if (passed && sameLocalDay(now, lastPassedAt)) return current;
  const box = passed
    ? Math.min(current.box + 1, LADDER_DAYS.length - 1)
    : Math.max(current.box - 1, 0);
  return {
    box,
    dueAt: passed ? now + LADDER_DAYS[box] * 86_400_000 : now + RETRY_MS,
  };
}

export function isOwned(box: number, realUseCount: number): boolean {
  return box >= 4 && realUseCount >= 3;
}
