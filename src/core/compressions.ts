export interface CompressionPattern {
  skeleton: string;
  zh: string;
  why: string;
  seeds: string[];
}

export interface CompressionCut {
  what: string;
  why: string;
}

export interface CompressionRecord {
  id: string;
  at: number;
  long: string;
  short: string;
  longWords: number;
  shortWords: number;
  kept: string;
  symptom: string;
  cuts: CompressionCut[];
  patterns: CompressionPattern[];
}

interface CompressionResult {
  short?: unknown;
  kept?: unknown;
  symptom?: unknown;
  cuts?: unknown;
  patterns?: unknown;
}

interface NewCompression {
  id: string;
  at: number;
  long: string;
  longWords: number;
  shortWords: number;
  result: CompressionResult;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveInteger(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

function normalizePattern(value: unknown): CompressionPattern | null {
  if (typeof value === 'string') {
    const skeleton = value.trim();
    return skeleton ? { skeleton, zh: '', why: '', seeds: [] } : null;
  }
  if (!isRecord(value)) return null;
  const skeleton = text(value.skeleton);
  if (!skeleton) return null;
  return {
    skeleton,
    zh: text(value.zh),
    why: text(value.why),
    seeds: Array.isArray(value.seeds)
      ? value.seeds.map(text).filter(Boolean).slice(0, 3)
      : [],
  };
}

function normalizeCut(value: unknown): CompressionCut | null {
  if (!isRecord(value)) return null;
  const what = text(value.what);
  const why = text(value.why);
  return what || why ? { what, why } : null;
}

function normalizedPatterns(value: unknown): CompressionPattern[] {
  return Array.isArray(value)
    ? value.map(normalizePattern).filter((item): item is CompressionPattern => Boolean(item))
    : [];
}

function normalizedCuts(value: unknown): CompressionCut[] {
  return Array.isArray(value)
    ? value.map(normalizeCut).filter((item): item is CompressionCut => Boolean(item))
    : [];
}

export function createCompressionRecord(input: NewCompression): CompressionRecord {
  return {
    id: input.id,
    at: input.at,
    long: input.long.trim(),
    short: text(input.result.short),
    longWords: positiveInteger(input.longWords),
    shortWords: positiveInteger(input.shortWords),
    kept: text(input.result.kept),
    symptom: text(input.result.symptom),
    cuts: normalizedCuts(input.result.cuts),
    patterns: normalizedPatterns(input.result.patterns),
  };
}

export function normalizeCompressionRecord(value: unknown): CompressionRecord | null {
  if (!isRecord(value)) return null;
  const long = text(value.long);
  const short = text(value.short);
  if (!long || !short) return null;
  const at = Number(value.at);
  return {
    id: text(value.id) || `legacy-${Number.isFinite(at) ? at : 0}-${short.length}`,
    at: Number.isFinite(at) ? at : 0,
    long,
    short,
    longWords: positiveInteger(value.longWords),
    shortWords: positiveInteger(value.shortWords),
    kept: text(value.kept),
    symptom: text(value.symptom),
    cuts: normalizedCuts(value.cuts),
    patterns: normalizedPatterns(value.patterns),
  };
}
