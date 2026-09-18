export type LearningItemKind = 'expression' | 'term';

export interface ProfessionalTermFields {
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

export function termAppearsInSentence(
  lemmaValue: unknown,
  sentenceValue: unknown,
): boolean {
  const lemma = text(lemmaValue).toLocaleLowerCase('en-US');
  const sentence = text(sentenceValue).toLocaleLowerCase('en-US');
  if (!lemma || !sentence) return false;
  const escaped = lemma
    .split(/\s+/u)
    .map(part => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'))
    .join('\\s+');
  return new RegExp(`(^|[^a-z])${escaped}(?:s|es|ed|ing)?([^a-z]|$)`, 'iu')
    .test(sentence);
}

export function isProfessionalTermCandidate(value: unknown): boolean {
  if (!isRecord(value)) return false;
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
    && domainTags.length,
  );
}

export function normalizeLearningItem<T extends JsonRecord>(value: T): T & {
  kind: LearningItemKind;
} & Partial<ProfessionalTermFields> {
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

  return {
    ...value,
    kind,
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
  return `${kind}:${primary
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/\s+/gu, ' ')
    .trim()}`;
}
