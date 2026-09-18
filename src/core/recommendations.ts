import {
  isProfessionalTermCandidate,
  learningItemKey,
  normalizeLearningItemKind,
  type LearningItemKind,
} from './learning-items';

export const MIN_DAILY_RECOMMENDATIONS = 5;
export const MAX_DAILY_RECOMMENDATIONS = 6;
export const TARGET_DAILY_TERMS = 1;

export type RecommendationRegister = 'meeting' | 'email' | 'casual';

export interface RecommendationDrill {
  brief: string;
  target_zh: string;
  answer: string;
}

export interface RecommendationCard {
  id: string;
  kind: LearningItemKind;
  skeleton: string;
  zh: string;
  lemma: string;
  sense: string;
  collocations: string[];
  anchorSentence: string;
  relatedExpressionIds: string[];
  domainTags: string[];
  trigger: string;
  why: string;
  example: string;
  example_zh: string;
  drill: RecommendationDrill;
  register: RecommendationRegister;
  tags: string[];
  collectedItemId: string;
  practicedAt: number;
}

export interface DailyRecommendationDeck {
  date: string;
  generatedAt: number;
  currentIndex: number;
  items: RecommendationCard[];
}

export interface RemainingRecommendationSelection {
  card: RecommendationCard;
  position: number;
  originalIndex: number;
  remaining: RecommendationCard[];
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeRegister(value: unknown): RecommendationRegister {
  return value === 'email' || value === 'casual' ? value : 'meeting';
}

export function recommendationKey(value: unknown): string {
  return text(value).replace(/\s+/g, ' ').toLowerCase();
}

function comparableChinese(value: unknown): string {
  return text(value)
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

function bigrams(value: string): string[] {
  if (value.length < 2) return value ? [value] : [];
  return Array.from({ length: value.length - 1 }, (_, index) => (
    value.slice(index, index + 2)
  ));
}

export function drillDiffersFromExample(
  exampleZh: unknown,
  targetZh: unknown,
): boolean {
  const example = comparableChinese(exampleZh);
  const target = comparableChinese(targetZh);
  if (!example || !target) return false;

  const shorter = Math.min(example.length, target.length);
  const longer = Math.max(example.length, target.length);
  if (
    (example.includes(target) || target.includes(example))
    && shorter / longer >= 0.7
  ) {
    return false;
  }

  const remaining = new Map<string, number>();
  for (const pair of bigrams(example)) {
    remaining.set(pair, (remaining.get(pair) || 0) + 1);
  }
  let overlap = 0;
  const targetPairs = bigrams(target);
  for (const pair of targetPairs) {
    const count = remaining.get(pair) || 0;
    if (!count) continue;
    overlap += 1;
    remaining.set(pair, count - 1);
  }
  const totalPairs = bigrams(example).length + targetPairs.length;
  const similarity = totalPairs ? (2 * overlap) / totalPairs : 1;
  return similarity < 0.58;
}

function normalizeCard(
  value: unknown,
  idFactory?: () => string,
): RecommendationCard | null {
  if (!isRecord(value)) return null;
  const kind = normalizeLearningItemKind(value.kind);
  const skeleton = kind === 'term'
    ? text(value.lemma) || text(value.skeleton)
    : text(value.skeleton);
  const zh = kind === 'term'
    ? text(value.sense) || text(value.zh)
    : text(value.zh);
  const example = text(value.example);
  const exampleZh = text(value.example_zh);
  const drill = isRecord(value.drill) ? value.drill : null;
  const drillBrief = text(drill?.brief);
  const drillTargetZh = text(drill?.target_zh);
  const drillAnswer = text(drill?.answer);
  if (
    !skeleton
    || !zh
    || !example
    || !exampleZh
    || !drillBrief
    || !drillTargetZh
    || !drillAnswer
    || !drillDiffersFromExample(exampleZh, drillTargetZh)
    || (kind === 'term' && !isProfessionalTermCandidate(value))
  ) return null;

  const id = text(value.id) || idFactory?.() || '';
  if (!id) return null;

  return {
    id,
    kind,
    skeleton,
    zh,
    lemma: kind === 'term' ? text(value.lemma) || skeleton : '',
    sense: kind === 'term' ? text(value.sense) || zh : '',
    collocations: kind === 'term' && Array.isArray(value.collocations)
      ? value.collocations.map(text).filter(Boolean).slice(0, 6)
      : [],
    anchorSentence: kind === 'term'
      ? text(value.anchorSentence) || example
      : '',
    relatedExpressionIds: kind === 'term' && Array.isArray(value.relatedExpressionIds)
      ? value.relatedExpressionIds.map(text).filter(Boolean).slice(0, 12)
      : [],
    domainTags: kind === 'term' && Array.isArray(value.domainTags)
      ? value.domainTags.map(text).filter(Boolean).slice(0, 6)
      : [],
    trigger: text(value.trigger) || text(value.why),
    why: text(value.why),
    example,
    example_zh: exampleZh,
    drill: {
      brief: drillBrief,
      target_zh: drillTargetZh,
      answer: drillAnswer,
    },
    register: normalizeRegister(value.register),
    tags: Array.isArray(value.tags)
      ? value.tags.map(text).filter(Boolean).slice(0, 3)
      : [],
    collectedItemId: text(value.collectedItemId),
    practicedAt: Math.max(0, Number(value.practicedAt) || 0),
  };
}

function uniqueCards(
  values: unknown[],
  idFactory?: () => string,
): RecommendationCard[] {
  const seen = new Set<string>();
  const cards: RecommendationCard[] = [];
  for (const value of values) {
    const card = normalizeCard(value, idFactory);
    const key = card ? learningItemKey(card) : '';
    if (!card || !key || seen.has(key)) continue;
    seen.add(key);
    cards.push(card);
  }
  return cards.slice(0, MAX_DAILY_RECOMMENDATIONS);
}

function shuffled<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const candidate = Math.floor(random() * (index + 1));
    const swapIndex = Math.max(0, Math.min(index, candidate));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function localDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function createDailyRecommendationDeck(input: {
  date?: string;
  generatedAt?: number;
  items: unknown[];
  idFactory: () => string;
  random?: () => number;
}): DailyRecommendationDeck {
  const cards = uniqueCards(input.items, input.idFactory);
  if (cards.length < MIN_DAILY_RECOMMENDATIONS) {
    throw new Error(`今日推荐至少需要 ${MIN_DAILY_RECOMMENDATIONS} 个不同学习单元`);
  }
  const termCount = cards.filter(card => card.kind === 'term').length;
  if (termCount > TARGET_DAILY_TERMS || cards.length - termCount < 4) {
    throw new Error('今日推荐需包含至少 4 个表达，专业词汇最多 1 个');
  }

  return {
    date: input.date || localDateKey(),
    generatedAt: Number(input.generatedAt) || Date.now(),
    currentIndex: 0,
    items: shuffled(cards, input.random || Math.random),
  };
}

export function normalizeDailyRecommendationDeck(
  value: unknown,
): DailyRecommendationDeck | null {
  if (!isRecord(value) || !Array.isArray(value.items)) return null;
  const date = text(value.date);
  const cards = uniqueCards(value.items);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !cards.length) return null;

  const rawIndex = Math.floor(Number(value.currentIndex) || 0);
  return {
    date,
    generatedAt: Number(value.generatedAt) || 0,
    currentIndex: Math.max(0, Math.min(cards.length - 1, rawIndex)),
    items: cards,
  };
}

export function recommendationIndex(
  deck: DailyRecommendationDeck,
  requested: number,
): number {
  return Math.max(
    0,
    Math.min(deck.items.length - 1, Math.floor(requested)),
  );
}

export function recommendationProgress(deck: DailyRecommendationDeck): {
  total: number;
  completed: number;
  remaining: number;
} {
  const completed = deck.items.filter(card => card.practicedAt > 0).length;
  return {
    total: deck.items.length,
    completed,
    remaining: deck.items.length - completed,
  };
}

export function selectRemainingRecommendation(
  deck: DailyRecommendationDeck,
): RemainingRecommendationSelection | null {
  const indexed = deck.items
    .map((card, originalIndex) => ({ card, originalIndex }))
    .filter(({ card }) => card.practicedAt <= 0);
  if (!indexed.length) return null;

  const requested = recommendationIndex(deck, deck.currentIndex);
  let position = indexed.findIndex(({ originalIndex }) => (
    originalIndex === requested
  ));
  if (position < 0) {
    position = indexed.findIndex(({ originalIndex }) => (
      originalIndex > requested
    ));
  }
  if (position < 0) position = 0;

  return {
    card: indexed[position].card,
    position,
    originalIndex: indexed[position].originalIndex,
    remaining: indexed.map(({ card }) => card),
  };
}
