export const LADDER_DAYS = [0, 1, 3, 7, 21, 60] as const;
export const RETRY_MS = 8 * 60 * 60 * 1000;

export interface ReviewState {
  box: number;
  dueAt: number;
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
