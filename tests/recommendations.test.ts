import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createDailyRecommendationDeck,
  drillDiffersFromExample,
  localDateKey,
  normalizeDailyRecommendationDeck,
  recommendationIndex,
  recommendationProgress,
  selectRemainingRecommendation,
} from '../src/core/recommendations';
import { recommendationSchema } from '../src/llm/schemas';

function candidates(count = 5) {
  return Array.from({ length: count }, (_, index) => ({
    skeleton: `shift priority ${index} from X to Y`,
    zh: `把第 ${index} 项重点从 X 转向 Y`,
    trigger: `当讨论方案 ${index} 的推进路径时，说明需要改变方向`,
    why: `适合场景 ${index}`,
    example: `We should shift priority ${index} from speed to reliability.`,
    example_zh: `我们应该把第 ${index} 项重点从速度转向可靠性。`,
    drill: {
      brief: `在预算评审中说明第 ${index} 项投入方向的变化`,
      target_zh: `我们应该把第 ${index} 项预算重点从获客转向客户留存。`,
      answer: `We should shift priority ${index} from acquisition to retention.`,
    },
    register: 'meeting',
    tags: ['推进'],
  }));
}

function termCandidate(overrides = {}) {
  return {
    kind: 'term',
    skeleton: 'latency',
    zh: '系统响应请求所需的延迟时间',
    lemma: 'latency',
    sense: '系统响应请求所需的延迟时间',
    collocations: ['reduce latency', 'latency budget'],
    anchorSentence: 'We need to reduce latency before the regional rollout.',
    relatedExpressionIds: ['expression-1'],
    domainTags: ['软件架构', '性能'],
    trigger: '当讨论系统响应速度时，准确说明延迟及其约束',
    why: '适合性能评审和架构讨论',
    example: 'We need to reduce latency before the regional rollout.',
    example_zh: '我们需要在区域上线前降低延迟。',
    drill: {
      brief: '在接口评审中说明缓存可以降低响应延迟',
      target_zh: '增加本地缓存可以降低关键接口的延迟。',
      answer: 'Adding a local cache can reduce latency on the critical endpoint.',
    },
    register: 'meeting',
    tags: ['性能'],
    ...overrides,
  };
}

describe('daily recommendations', () => {
  it('distinguishes a transferred scenario from a direct answer replay', () => {
    const example = '智能体成本与其说取决于显卡，不如说取决于上下文管理。';

    expect(drillDiffersFromExample(
      example,
      '智能体的成本与其说取决于显卡，不如说取决于上下文管理。',
    )).toBe(false);
    expect(drillDiffersFromExample(
      example,
      '项目延期与其说是执行速度的问题，不如说是需求范围没有收紧。',
    )).toBe(true);
  });

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
    })).toThrow('至少需要 5 个不同学习单元');
  });

  it('keeps a professional term alongside four expressions', () => {
    const deck = createDailyRecommendationDeck({
      items: [...candidates(4), termCandidate()],
      idFactory: () => crypto.randomUUID(),
      random: () => 0.5,
    });

    expect(deck.items.filter(item => item.kind === 'term')).toHaveLength(1);
    expect(deck.items.find(item => item.kind === 'term')).toMatchObject({
      lemma: 'latency',
      collocations: ['reduce latency', 'latency budget'],
      domainTags: ['软件架构', '性能'],
    });
  });

  it('does not admit generic or multiple term cards', () => {
    const generic = termCandidate({
      skeleton: 'important',
      lemma: 'important',
      anchorSentence: 'This is important for the project.',
      example: 'This is important for the project.',
      drill: {
        brief: '说明一项工作很重要',
        target_zh: '这项检查对上线很重要。',
        answer: 'This check is important for the launch.',
      },
    });
    expect(recommendationSchema.safeParse({
      items: [...candidates(4), generic],
    }).success).toBe(false);

    expect(recommendationSchema.safeParse({
      items: [
        ...candidates(4),
        termCandidate(),
        termCandidate({
          skeleton: 'throughput',
          lemma: 'throughput',
          sense: '系统在单位时间内处理的任务量',
          collocations: ['increase throughput', 'peak throughput'],
          anchorSentence: 'The new queue increased throughput during peak hours.',
          example: 'The new queue increased throughput during peak hours.',
          drill: {
            brief: '说明批处理提高了数据吞吐量',
            target_zh: '批处理提高了夜间任务的吞吐量。',
            answer: 'Batching increased throughput for the overnight jobs.',
          },
        }),
      ],
    }).success).toBe(false);
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
    expect(deck?.items[1].practicedAt).toBe(0);
    expect(recommendationIndex(deck!, -4)).toBe(0);
  });

  it('only selects recommendations that have not been practiced', () => {
    const deck = normalizeDailyRecommendationDeck({
      date: '2026-09-02',
      generatedAt: 100,
      currentIndex: 1,
      items: candidates().map((item, index) => ({
        ...item,
        id: `recommendation-${index}`,
        practicedAt: index === 1 || index === 3 ? 200 + index : 0,
      })),
    })!;

    const selection = selectRemainingRecommendation(deck);
    expect(selection?.card.id).toBe('recommendation-2');
    expect(selection?.position).toBe(1);
    expect(selection?.remaining.map(card => card.id)).toEqual([
      'recommendation-0',
      'recommendation-2',
      'recommendation-4',
    ]);
    expect(recommendationProgress(deck)).toEqual({
      total: 5,
      completed: 2,
      remaining: 3,
    });
  });

  it('returns a completed state when every recommendation was practiced', () => {
    const deck = normalizeDailyRecommendationDeck({
      date: '2026-09-02',
      generatedAt: 100,
      currentIndex: 4,
      items: candidates().map((item, index) => ({
        ...item,
        id: `recommendation-${index}`,
        practicedAt: 200 + index,
      })),
    })!;

    expect(selectRemainingRecommendation(deck)).toBeNull();
    expect(recommendationProgress(deck).remaining).toBe(0);
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

    const missingTrigger = candidates();
    delete (missingTrigger[0] as Partial<(typeof missingTrigger)[number]>).trigger;
    expect(recommendationSchema.safeParse({ items: missingTrigger }).success)
      .toBe(false);
  });

  it('rejects a drill that repeats the example instead of transferring it', () => {
    const repeated = candidates();
    repeated[0].drill = {
      brief: '换一种说法复述例句',
      target_zh: '我们应该把第 0 项重点从速度转向可靠性。',
      answer: 'We should shift priority 0 from speed to reliability.',
    };

    expect(recommendationSchema.safeParse({ items: repeated }).success)
      .toBe(false);
  });

  it('rejects an example that does not instantiate its skeleton', () => {
    const detached = candidates();
    detached[0].example = 'The current plan looks reliable enough.';

    expect(recommendationSchema.safeParse({ items: detached }).success)
      .toBe(false);
  });

  it('keeps the route, swipe controls, and collection path wired', () => {
    const main = readFileSync('js/main.js', 'utf8');
    const home = readFileSync('js/views.js', 'utf8');
    const secondary = readFileSync('js/views2.js', 'utf8');
    const view = readFileSync('js/recommendations.js', 'utf8');
    const store = readFileSync('js/store.js', 'utf8');

    expect(main).toContain('recommend: viewRecommendations');
    expect(home).toContain('data-today-mode="recommendation"');
    expect(view).toContain("card.addEventListener('pointerup'");
    expect(view).toContain("srcKind: 'recommendation'");
    expect(view).toContain("recommendation.kind === 'term'");
    expect(view).toContain('collocations: recommendation.collocations');
    expect(view).toContain('drillCard(item');
    expect(view).toContain('markRecommendationPracticed');
    expect(view).toContain('今日推荐已完成');
    expect(view).toContain("setTodayMode('recommendation')");
    expect(view).toContain('收录并练习 · 复习顺延');
    expect(view).not.toContain('openBudgetSwap');
    expect(view).not.toContain('S.retire');
    expect(view).not.toContain('替换后开始练习');
    expect(view).not.toContain('继续深入练习');
    expect(view).toContain('target_zh: recommendation.drill.target_zh');
    expect(view).toContain('brief: recommendation.drill.brief');
    expect(view).toContain('referenceAnswer: recommendation.drill.answer');
    expect(view).toContain('S.expiredRecommendationPracticeSession()');
    expect(view).toContain('继续未完成练习');
    expect(view).toContain(
      "referenceAnswer: recommendation?.drill?.answer || item.seeds?.[0] || ''",
    );
    const expiredPractice = view.slice(
      view.indexOf('function renderExpiredPractice'),
      view.indexOf('function renderComplete'),
    );
    expect(expiredPractice).toContain('S.todayRecommendationDeck()');
    expect(expiredPractice).toContain('renderStart(app)');
    expect(expiredPractice).not.toContain('markRecommendationPracticed');
    expect(view.indexOf('const expiredPractice = expiredPracticeContext()'))
      .toBeLessThan(view.indexOf('const cached = S.todayRecommendationDeck()'));
    expect(view).not.toContain('target_zh: recommendation.zh');
    expect(view).toContain('trigger: recommendation.trigger');
    expect(home).not.toContain('cap-swap');
    expect(secondary).not.toContain('S.budgetLeft');
    expect(secondary).not.toContain('本周名额已满');
    expect(store).toContain(
      'export const WEEKLY_NEW_TARGET = DEFAULT_WEEKLY_NEW_TARGET',
    );
  });
});
