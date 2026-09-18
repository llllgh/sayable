import { describe, expect, it } from 'vitest';
import {
  chooseTodayMode,
  createReviewGroup,
} from '../src/core/today';

describe('today mode selection', () => {
  it('resumes active work before applying the normal default', () => {
    expect(chooseTodayMode({
      activeSource: 'recommendation',
      dueCount: 3,
      recommendationRemaining: 4,
    })).toBe('recommendation');
    expect(chooseTodayMode({
      activeSource: 'due-review',
      dueCount: 0,
      recommendationRemaining: 4,
    })).toBe('review');
  });

  it('keeps the mode explicitly selected during this app session', () => {
    expect(chooseTodayMode({
      selectedMode: 'recommendation',
      activeSource: 'due-review',
      dueCount: 2,
      recommendationRemaining: 5,
    })).toBe('recommendation');
  });

  it('defaults to due review, then recommendations, then completion', () => {
    expect(chooseTodayMode({
      dueCount: 2,
      recommendationRemaining: 5,
    })).toBe('review');
    expect(chooseTodayMode({
      dueCount: 0,
      recommendationRemaining: null,
    })).toBe('recommendation');
    expect(chooseTodayMode({
      dueCount: 0,
      recommendationRemaining: 0,
    })).toBe('review');
  });
});

describe('today review group', () => {
  it('freezes at five unique items and puts a resumed item first', () => {
    expect(createReviewGroup(
      ['a', 'b', 'c', 'd', 'e', 'f'],
      'c',
    )).toEqual(['c', 'a', 'b', 'd', 'e']);
  });

  it('uses the actual size for a short group', () => {
    expect(createReviewGroup(['a', 'b'])).toEqual(['a', 'b']);
  });
});
