export const GUIDED_REVIEW_MAX_BOX = 2;

export type ReviewPromptMode = 'guided' | 'recall';

export interface ReviewSupportInput {
  box: number;
  kind?: 'expression' | 'term';
  skeleton: string;
  lemma?: string;
  collocations?: string[];
  anchorSentence?: string;
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

  if (input.kind === 'term') {
    const lemma = String(input.lemma || input.skeleton || '').trim();
    const collocations = (input.collocations || [])
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 3);
    return {
      mode,
      skeleton: [lemma, ...collocations].filter(Boolean).join(' · '),
      example: String(
        input.anchorSentence
        || input.seeds?.find(seed => String(seed || '').trim())
        || '',
      ).trim(),
    };
  }

  return {
    mode,
    skeleton: String(input.skeleton || '').trim(),
    example: String(input.seeds?.find(seed => String(seed || '').trim()) || '').trim(),
  };
}
