import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDailyRecommendationDeck,
  localDateKey,
  normalizeDailyRecommendationDeck,
  recommendationIndex,
} from '../src/core/recommendations';
import { recommendationSchema } from '../src/llm/schemas';

function candidates(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    skeleton: `move from X to Y ${index}`,
    zh: `从 X 转向 Y ${index}`,
    why: `适合场景 ${index}`,
    example: `We moved from option ${index} to a clearer plan.`,
    drill: `说明第 ${index} 个变化`,
    register: 'meeting',
    tags: ['推进'],
  }));
}

describe('daily recommendations', () => {
  it('uses the local calendar day as the cache key', () => {
    expect(localDateKey(new Date(2026, 8, 1, 23, 59, 59)))
      .toBe('2026-09-01');
  });

  it('creates and shuffles a persistent deck with at least five cards', () => {
    let id = 0;
    const deck = createDailyRecommendationDeck({
      date: '2026-09-01',
      generatedAt: 100,
      items: candidates(),
      idFactory: () => `recommendation-${id++}`,
      random: () => 0,
    });

    expect(deck.items).toHaveLength(5);
    expect(deck.items.map(item => item.skeleton))
      .not.toEqual(candidates().map(item => item.skeleton));
    expect(deck.currentIndex).toBe(0);
  });

  it('rejects a batch with fewer than five distinct expressions', () => {
    const duplicated = candidates(4);
    duplicated.push({ ...duplicated[0] });

    expect(() => createDailyRecommendationDeck({
      items: duplicated,
      idFactory: () => crypto.randomUUID(),
    })).toThrow('至少需要 5 个不同表达');
  });

  it('normalizes imported decks and clamps their current card', () => {
    const deck = normalizeDailyRecommendationDeck({
      date: '2026-09-01',
      generatedAt: 100,
      currentIndex: 99,
      items: candidates().map((item, index) => ({
        ...item,
        id: `recommendation-${index}`,
        collectedItemId: index === 1 ? 'library-item' : '',
      })),
    });

    expect(deck?.currentIndex).toBe(4);
    expect(deck?.items[1].collectedItemId).toBe('library-item');
    expect(recommendationIndex(deck!, -4)).toBe(0);
  });

  it('requires five unique recommendations from the model', () => {
    expect(recommendationSchema.safeParse({ items: candidates(4) }).success)
      .toBe(false);

    const duplicated = candidates();
    duplicated[4] = { ...duplicated[0] };
    expect(recommendationSchema.safeParse({ items: duplicated }).success)
      .toBe(false);
    expect(recommendationSchema.safeParse({ items: candidates() }).success)
      .toBe(true);
  });

  it('keeps the route, swipe controls, and collection path wired', () => {
    const main = readFileSync('js/main.js', 'utf8');
    const home = readFileSync('js/views.js', 'utf8');
    const view = readFileSync('js/recommendations.js', 'utf8');

    expect(main).toContain('recommend: viewRecommendations');
    expect(home).toContain('data-nav="recommend"');
    expect(view).toContain("card.addEventListener('pointerup'");
    expect(view).toContain("srcKind: 'recommendation'");
    expect(view).toContain('drillCard(item');
  });
});
