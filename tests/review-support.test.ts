import { describe, expect, it } from 'vitest';
import {
  reviewPromptMode,
  reviewSupport,
} from '../src/core/review-support';

describe('review support', () => {
  it('keeps English support through the first three ladder stages', () => {
    expect(reviewPromptMode(0)).toBe('guided');
    expect(reviewPromptMode(1)).toBe('guided');
    expect(reviewPromptMode(2)).toBe('guided');
  });

  it('switches to Chinese-only recall from the seven-day stage', () => {
    expect(reviewPromptMode(3)).toBe('recall');
    expect(reviewPromptMode(5)).toBe('recall');
  });

  it('returns a skeleton and one complete example only in guided mode', () => {
    const input = {
      box: 1,
      skeleton: 'Could we touch base [time] to discuss [topic]?',
      seeds: ['Could we touch base tomorrow to discuss the launch?'],
    };

    expect(reviewSupport(input)).toEqual({
      mode: 'guided',
      skeleton: input.skeleton,
      example: input.seeds[0],
    });
    expect(reviewSupport({ ...input, box: 3 })).toEqual({
      mode: 'recall',
      skeleton: '',
      example: '',
    });
  });
});
