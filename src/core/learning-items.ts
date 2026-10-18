import { normalizeLearningGoal, normalizeRecognition } from './vocabulary';

export type LearningItemKind = 'expression' | 'term';
export type TermCategory = 'professional' | 'precision' | 'everyday';

export interface TermFields {
  termCategory: TermCategory;
  lemma: string;
  sense: string;
  collocations: string[];
  anchorSentence: string;
  relatedExpressionIds: string[];
  domainTags: string[];
}

type JsonRecord = Record<string, unknown>;

const GENERIC_TERMS = new Set([
  'advantage',
  'change',
  'challenge',
  'different',
  'good',
  'important',
  'improve',
  'issue',
  'make',
  'need',
  'problem',
  'process',
  'result',
  'solution',
  'thing',
  'use',
  'work',
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function list(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean).slice(0, limit)
    : [];
}

export function normalizeLearningItemKind(value: unknown): LearningItemKind {
  return value === 'term' ? 'term' : 'expression';
}

export function normalizeTermCategory(value: unknown): TermCategory {
  if (value === 'precision' || value === 'everyday') return value;
  return 'professional';
}

export function termCategoryLabel(value: unknown): string {
  const category = normalizeTermCategory(value);
  if (category === 'precision') return '精确用词';
  if (category === 'everyday') return '生活用语';
  return '专业词汇';
}

export function termAppearsInSentence(
  lemmaValue: unknown,
  sentenceValue: unknown,
): boolean {
  const lemma = text(lemmaValue).toLocaleLowerCase('en-US');
  const sentence = text(sentenceValue).toLocaleLowerCase('en-US');
  if (!lemma || !sentence) return false;
  const escape = (value: string) => value
    .replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  const variants = new Set([lemma]);
  if (!lemma.includes(' ')) {
    variants.add(`${lemma}s`);
    variants.add(`${lemma}es`);
    variants.add(`${lemma}ed`);
    variants.add(`${lemma}ing`);
    if (lemma.endsWith('e')) {
      variants.add(`${lemma.slice(0, -1)}ed`);
      variants.add(`${lemma.slice(0, -1)}ing`);
    }
    if (/[^aeiou]y$/u.test(lemma)) {
      variants.add(`${lemma.slice(0, -1)}ies`);
      variants.add(`${lemma.slice(0, -1)}ied`);
    }
  } else {
    const [verb, ...rest] = lemma.split(' ');
    const suffix = rest.join(' ');
    for (const form of [`${verb}s`, `${verb}ed`, `${verb}ing`,
      ...(verb.endsWith('e') ? [`${verb}d`, `${verb.slice(0, -1)}ing`] : [])]) {
      variants.add(`${form} ${suffix}`);
    }
  }
  const pattern = [...variants]
    .sort((left, right) => right.length - left.length)
    .map(escape)
    .join('|');
  return new RegExp(`(^|[^a-z])(?:${pattern})([^a-z]|$)`, 'iu')
    .test(sentence);
}

export function isProfessionalTermCandidate(value: unknown): boolean {
  return isTermCandidate(value)
    && normalizeTermCategory((value as JsonRecord).termCategory) === 'professional';
}

export function isTermCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const termCategory = normalizeTermCategory(value.termCategory);
  const lemma = text(value.lemma || value.skeleton);
  const normalizedLemma = lemma.toLocaleLowerCase('en-US');
  const sense = text(value.sense || value.zh);
  const collocations = list(value.collocations, 6);
  const anchorSentence = text(value.anchorSentence)
    || list(value.seeds, 1)[0]
    || '';
  const domainTags = list(value.domainTags || value.tags, 6);
  const wordCount = lemma.split(/\s+/u).filter(Boolean).length;

  return Boolean(
    lemma
    && wordCount <= 3
    && !(/\b[XYZ]\b|\[[^\]]+\]/u.test(lemma))
    && !GENERIC_TERMS.has(normalizedLemma)
    && sense
    && collocations.length >= 2
    && anchorSentence
    && termAppearsInSentence(lemma, anchorSentence)
    && (termCategory !== 'professional' || domainTags.length)
    && (termCategory !== 'precision' || wordCount === 1),
  );
}

export function normalizeLearningItem<T extends JsonRecord>(value: T): T & {
  kind: LearningItemKind;
} & Partial<TermFields> {
  const kind = normalizeLearningItemKind(value.kind);
  if (kind === 'expression') {
    return {
      ...value,
      kind,
    };
  }

  const lemma = text(value.lemma || value.skeleton);
  const sense = text(value.sense || value.zh);
  const collocations = list(value.collocations, 6);
  const anchorSentence = text(value.anchorSentence)
    || list(value.seeds, 1)[0]
    || '';
  const relatedExpressionIds = list(value.relatedExpressionIds, 12);
  const domainTags = list(value.domainTags || value.tags, 6);
  const termCategory = normalizeTermCategory(value.termCategory);

  return {
    ...value,
    kind,
    learningGoal: normalizeLearningGoal(value.learningGoal),
    goalRevision: Number(value.goalRevision) || 0,
    recognition: normalizeRecognition(value.recognition),
    termCategory,
    skeleton: lemma,
    zh: sense,
    lemma,
    sense,
    collocations,
    anchorSentence,
    relatedExpressionIds,
    domainTags,
  };
}

export function learningItemKey(value: unknown): string {
  if (!isRecord(value)) return '';
  const kind = normalizeLearningItemKind(value.kind);
  const primary = kind === 'term'
    ? text(value.lemma || value.skeleton)
    : text(value.skeleton);
  if (!primary) return '';
  const primaryKey = primary
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim();
  const sense = text(value.sense || value.zh).normalize('NFKC')
    .toLocaleLowerCase('en-US').replace(/\s+/gu, ' ').trim();
  return kind === 'term' ? `${kind}:${primaryKey}:${sense}` : `${kind}:${primaryKey}`;
}
