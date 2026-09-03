export const GUIDED_REVIEW_MAX_BOX = 2;

export type ReviewPromptMode = 'guided' | 'recall';

export interface ReviewSupportInput {
  box: number;
  skeleton: string;
  seeds?: string[];
}

export interface ReviewSupport {
  mode: ReviewPromptMode;
  skeleton: string;
  example: string;
}

export function reviewPromptMode(box: number): ReviewPromptMode {
  return Math.max(0, Number(box) || 0) <= GUIDED_REVIEW_MAX_BOX
    ? 'guided'
    : 'recall';
}

export function reviewSupport(input: ReviewSupportInput): ReviewSupport {
  const mode = reviewPromptMode(input.box);
  if (mode === 'recall') {
    return { mode, skeleton: '', example: '' };
  }

  return {
    mode,
    skeleton: String(input.skeleton || '').trim(),
    example: String(input.seeds?.find(seed => String(seed || '').trim()) || '').trim(),
  };
}
