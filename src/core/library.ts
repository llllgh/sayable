export type RecordStatus = 'raw' | 'analyzing' | 'ready' | 'failed' | 'handled';

interface SearchableExpression {
  skeleton?: unknown;
  zh?: unknown;
  lemma?: unknown;
  sense?: unknown;
  collocations?: unknown;
  anchorSentence?: unknown;
  domainTags?: unknown;
  source?: { raw?: unknown } | null;
  seeds?: unknown;
}

interface SearchableRecord {
  text?: unknown;
  analysis?: unknown;
}

function searchable(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(searchable).join(' ');
  if (typeof value === 'object' && value !== null) {
    return Object.values(value).map(searchable).join(' ');
  }
  return '';
}

function normalized(value: unknown): string {
  return searchable(value)
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

export function normalizeRecordStatus(value: unknown): RecordStatus {
  if (value === 'analyzing' || value === 'failed' || value === 'handled') return value;
  if (value === 'ready' || value === 'done') return 'ready';
  return 'raw';
}

export function expressionMatchesQuery(
  item: SearchableExpression,
  query: unknown,
): boolean {
  const term = normalized(query);
  if (!term) return true;
  return normalized([
    item.skeleton,
    item.zh,
    item.lemma,
    item.sense,
    item.collocations,
    item.anchorSentence,
    item.domainTags,
    item.source?.raw,
    item.seeds,
  ]).includes(term);
}

export function recordMatchesQuery(
  record: SearchableRecord,
  query: unknown,
): boolean {
  const term = normalized(query);
  if (!term) return true;
  return normalized([record.text, record.analysis]).includes(term);
}

export function recordNeedsAttention(status: unknown): boolean {
  return normalizeRecordStatus(status) !== 'handled';
}
