export type TodayMode = 'review' | 'recommendation';

export function chooseTodayMode(input: {
  selectedMode?: TodayMode | null;
  activeSource?: string;
  dueCount: number;
  recommendationRemaining?: number | null;
}): TodayMode {
  if (input.selectedMode) return input.selectedMode;
  if (input.activeSource === 'recommendation') return 'recommendation';
  if (input.activeSource === 'due-review') return 'review';
  if (input.dueCount > 0) return 'review';
  if (input.recommendationRemaining === null
    || Number(input.recommendationRemaining) > 0) {
    return 'recommendation';
  }
  return 'review';
}

export function createReviewGroup(
  dueItemIds: string[],
  resumedItemId = '',
  limit = 5,
): string[] {
  const ordered = resumedItemId
    ? [resumedItemId, ...dueItemIds]
    : dueItemIds;
  return [...new Set(ordered.filter(Boolean))]
    .slice(0, Math.max(1, limit));
}
