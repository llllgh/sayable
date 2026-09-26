import { skeletonAnchoredInExpression } from './capture';
import {
  learningItemKey,
  normalizeLearningItemKind,
  normalizeTermCategory,
  termAppearsInSentence,
  type LearningItemKind,
  type TermCategory,
} from './learning-items';

export const MIN_SOURCE_WORDS = 80;
export const MAX_SOURCE_CHARACTERS = 120_000;
export const SOURCE_CHUNK_CHARACTERS = 5_200;
export const SOURCE_CHUNK_OVERLAP = 320;

export type SourceDocumentStatus =
  | 'processing'
  | 'ready'
  | 'failed'
  | 'interrupted';

export interface SourceDocument {
  id: string;
  title: string;
  sourceUrl: string;
  body: string;
  status: SourceDocumentStatus;
  chunkCount: number;
  nextChunkIndex: number;
  candidateCount: number;
  error: string;
  createdAt: number;
  updatedAt: number;
}

export interface SourceCandidate {
  id: string;
  documentId: string;
  chunkIndex: number;
  kind: LearningItemKind;
  termCategory: TermCategory | '';
  skeleton: string;
  zh: string;
  lemma: string;
  sense: string;
  quote: string;
  sourceTitle: string;
  sourceUrl: string;
  consumedAt: number;
  recommendationId: string;
  createdAt: number;
}

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function timestamp(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function normalizeSourceText(value: unknown): string {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r\n?/gu, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/gu, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function sourceWordCount(value: unknown): number {
  return normalizeSourceText(value)
    .match(/[A-Za-z]+(?:['\u2019-][A-Za-z]+)*/gu)
    ?.length ?? 0;
}

export function sourceTextIssue(value: unknown): string {
  const body = normalizeSourceText(value);
  if (!body) return '请粘贴英文长文本';
  if (body.length > MAX_SOURCE_CHARACTERS) {
    return `单次最多处理 ${MAX_SOURCE_CHARACTERS.toLocaleString()} 个字符`;
  }
  if (sourceWordCount(body) < MIN_SOURCE_WORDS) {
    return `正文至少需要 ${MIN_SOURCE_WORDS} 个英文词`;
  }
  return '';
}

function preferredBreak(textValue: string, start: number, hardEnd: number): number {
  const softStart = start + Math.floor((hardEnd - start) * 0.65);
  const window = textValue.slice(softStart, hardEnd);
  const boundaries = [
    window.lastIndexOf('\n\n'),
    window.lastIndexOf('\n'),
  ];
  for (const match of window.matchAll(/[.!?](?:["')\]]+)?\s+/gu)) {
    boundaries.push((match.index || 0) + match[0].length);
  }
  boundaries.push(window.lastIndexOf(' '));
  const relative = Math.max(...boundaries);
  return relative > 0 ? softStart + relative : hardEnd;
}

export function chunkSourceText(
  value: unknown,
  maxCharacters = SOURCE_CHUNK_CHARACTERS,
  overlapCharacters = SOURCE_CHUNK_OVERLAP,
): string[] {
  const body = normalizeSourceText(value);
  if (!body) return [];
  const target = Math.max(800, Math.floor(maxCharacters));
  const overlap = Math.max(0, Math.min(
    Math.floor(overlapCharacters),
    Math.floor(target / 4),
  ));
  const chunks: string[] = [];
  let start = 0;

  while (start < body.length) {
    const hardEnd = Math.min(body.length, start + target);
    const end = hardEnd < body.length
      ? preferredBreak(body, start, hardEnd)
      : body.length;
    const chunk = body.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end >= body.length) break;

    let nextStart = Math.max(start + 1, end - overlap);
    const nextWhitespace = body.indexOf(' ', nextStart);
    if (nextWhitespace >= 0 && nextWhitespace < end) {
      nextStart = nextWhitespace + 1;
    }
    start = nextStart;
  }

  return chunks;
}

function comparable(value: unknown): string {
  return text(value)
    .normalize('NFKC')
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('en-US');
}

export function quoteAppearsInSource(quote: unknown, source: unknown): boolean {
  const needle = comparable(quote);
  return needle.length >= 12 && comparable(source).includes(needle);
}

export function sourceCandidateGrounded(
  value: unknown,
  sourceChunk: unknown,
): boolean {
  if (!isRecord(value)) return false;
  const quote = text(value.quote);
  if (!quoteAppearsInSource(quote, sourceChunk)) return false;
  const kind = normalizeLearningItemKind(value.kind);
  if (kind === 'term') {
    return termAppearsInSentence(value.lemma || value.skeleton, quote);
  }
  return skeletonAnchoredInExpression(text(value.skeleton), quote);
}

export function sourceCandidateKey(value: unknown): string {
  return learningItemKey(value);
}

export function normalizeSourceDocument(value: unknown): SourceDocument | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const body = normalizeSourceText(value.body);
  if (!id || !body) return null;
  const chunkCount = Math.max(
    1,
    Math.floor(Number(value.chunkCount) || chunkSourceText(body).length || 1),
  );
  const rawStatus = text(value.status);
  const status: SourceDocumentStatus = rawStatus === 'processing'
    ? 'interrupted'
    : ['ready', 'failed', 'interrupted'].includes(rawStatus)
      ? rawStatus as SourceDocumentStatus
      : 'interrupted';

  return {
    id,
    title: text(value.title) || '未命名来源',
    sourceUrl: text(value.sourceUrl),
    body,
    status,
    chunkCount,
    nextChunkIndex: Math.max(
      0,
      Math.min(chunkCount, Math.floor(Number(value.nextChunkIndex) || 0)),
    ),
    candidateCount: Math.max(0, Math.floor(Number(value.candidateCount) || 0)),
    error: status === 'interrupted'
      ? text(value.error) || '上次提炼未完成，请继续'
      : text(value.error),
    createdAt: timestamp(value.createdAt),
    updatedAt: timestamp(value.updatedAt),
  };
}

export function normalizeSourceCandidate(
  value: unknown,
): SourceCandidate | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const documentId = text(value.documentId);
  const kind = normalizeLearningItemKind(value.kind);
  const skeleton = kind === 'term'
    ? text(value.lemma || value.skeleton)
    : text(value.skeleton);
  const zh = kind === 'term'
    ? text(value.sense || value.zh)
    : text(value.zh);
  const quote = text(value.quote);
  if (!id || !documentId || !skeleton || !zh || !quote) return null;

  return {
    id,
    documentId,
    chunkIndex: Math.max(0, Math.floor(Number(value.chunkIndex) || 0)),
    kind,
    termCategory: kind === 'term'
      ? normalizeTermCategory(value.termCategory)
      : '',
    skeleton,
    zh,
    lemma: kind === 'term' ? text(value.lemma) || skeleton : '',
    sense: kind === 'term' ? text(value.sense) || zh : '',
    quote,
    sourceTitle: text(value.sourceTitle) || '未命名来源',
    sourceUrl: text(value.sourceUrl),
    consumedAt: timestamp(value.consumedAt),
    recommendationId: text(value.recommendationId),
    createdAt: timestamp(value.createdAt),
  };
}

export function normalizeSourceDocuments(value: unknown): SourceDocument[] {
  return (Array.isArray(value) ? value : [])
    .map(normalizeSourceDocument)
    .filter((item): item is SourceDocument => Boolean(item))
    .sort((left, right) => right.createdAt - left.createdAt);
}

export function normalizeSourceCandidates(value: unknown): SourceCandidate[] {
  const seen = new Set<string>();
  const result: SourceCandidate[] = [];
  for (const entry of Array.isArray(value) ? value : []) {
    const candidate = normalizeSourceCandidate(entry);
    const key = sourceCandidateKey(candidate);
    if (!candidate || !key || seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

export function pendingSourceCandidates(input: {
  candidates: unknown;
  existingItems?: unknown;
  allowEverydayTerms?: boolean;
  limit?: number;
}): SourceCandidate[] {
  const existingKeys = new Set(
    (Array.isArray(input.existingItems) ? input.existingItems : [])
      .map(learningItemKey)
      .filter(Boolean),
  );
  return normalizeSourceCandidates(input.candidates)
    .filter(candidate => !candidate.consumedAt)
    .filter(candidate => !existingKeys.has(sourceCandidateKey(candidate)))
    .filter(candidate => (
      input.allowEverydayTerms
      || candidate.kind !== 'term'
      || candidate.termCategory !== 'everyday'
    ))
    .sort((left, right) => (
      left.createdAt - right.createdAt
      || left.chunkIndex - right.chunkIndex
    ))
    .slice(0, Math.max(1, Math.floor(input.limit || 12)));
}
