import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WEEKLY_NEW_TARGET,
  RETRY_MS,
  applyReviewNotBefore,
  initialReviewDelayDays,
  isOwned,
  nextReview,
} from '../src/core/scheduler';

const DAY = 86_400_000;
const NOW = new Date('2026-08-31T12:00:00Z').getTime();

describe('scheduler', () => {
  it('advances through the fixed ladder', () => {
    let state = { box: 0, dueAt: NOW };
    state = nextReview(state, true, NOW);
    expect(state).toEqual({ box: 1, dueAt: NOW + DAY });
    state = nextReview(state, true, NOW + DAY);
    expect(state).toEqual({ box: 2, dueAt: NOW + 4 * DAY });
  });

  it('moves back one box and retries after eight hours', () => {
    expect(nextReview({ box: 3, dueAt: NOW }, false, NOW)).toEqual({
      box: 2,
      dueAt: NOW + RETRY_MS,
    });
  });

  it('does not move below box zero', () => {
    expect(nextReview({ box: 0, dueAt: NOW }, false, NOW).box).toBe(0);
  });

  it('does not advance twice on the same local day', () => {
    const current = { box: 2, dueAt: NOW + 3 * DAY };
    expect(nextReview(current, true, NOW, NOW - 60_000)).toEqual(current);
  });

  it('requires three real uses before an item is owned', () => {
    expect(isOwned(4, 2)).toBe(false);
    expect(isOwned(4, 3)).toBe(true);
  });

  it('accepts 15 new items per week without delaying review', () => {
    expect(DEFAULT_WEEKLY_NEW_TARGET).toBe(15);
    expect(initialReviewDelayDays(14)).toBe(0);
  });

  it('spreads items above the weekly target across later days', () => {
    expect(initialReviewDelayDays(15)).toBe(2);
    expect(initialReviewDelayDays(17)).toBe(2);
    expect(initialReviewDelayDays(18)).toBe(3);
    expect(initialReviewDelayDays(21)).toBe(4);
  });

  it('keeps the deferred floor after an immediate first practice', () => {
    const next = nextReview({ box: 0, dueAt: NOW }, true, NOW);
    const deferredUntil = NOW + 3 * DAY;

    expect(applyReviewNotBefore(next, deferredUntil)).toEqual({
      box: 1,
      dueAt: deferredUntil,
    });
  });
});
