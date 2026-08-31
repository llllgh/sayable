export interface SpeechWord {
  text: string;
  startMs?: number;
  endMs?: number;
  confidence?: number;
}

export interface SpeechTiming {
  durationMs?: number;
  voicedMs?: number;
  longPauses?: number;
  words?: SpeechWord[];
}

export interface SpeechAssessment {
  overall: number;
  intelligibility: number;
  completeness: number;
  fluency: number;
  rhythm: number;
  wordsPerMinute: number;
  pauseRatio: number;
  issues: string[];
}

const PLACEHOLDER = /^[xyz]$/i;

export function tokenizeEnglish(value: string): string[] {
  return (value.normalize('NFKC').toLowerCase().match(/[a-z0-9]+(?:'[a-z]+)?/g) || [])
    .filter((word) => !PLACEHOLDER.test(word));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function editDistance(left: string[], right: string[]): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let row = 1; row <= left.length; row += 1) {
    let diagonal = previous[0];
    previous[0] = row;
    for (let column = 1; column <= right.length; column += 1) {
      const above = previous[column];
      previous[column] = left[row - 1] === right[column - 1]
        ? diagonal
        : 1 + Math.min(diagonal, above, previous[column - 1]);
      diagonal = above;
    }
  }
  return previous[right.length];
}

function lcsLength(left: string[], right: string[]): number {
  const row = new Array(right.length + 1).fill(0);
  for (const leftWord of left) {
    let diagonal = 0;
    for (let index = 1; index <= right.length; index += 1) {
      const above = row[index];
      row[index] = leftWord === right[index - 1]
        ? diagonal + 1
        : Math.max(row[index], row[index - 1]);
      diagonal = above;
    }
  }
  return row[right.length];
}

function rateScore(wordsPerMinute: number): number {
  if (!wordsPerMinute) return 0;
  if (wordsPerMinute >= 105 && wordsPerMinute <= 180) return 100;
  if (wordsPerMinute < 105) return clamp(100 - (105 - wordsPerMinute) * 1.25);
  return clamp(100 - (wordsPerMinute - 180) * 1.1);
}

function rhythmScore(words: SpeechWord[], pauseRatio: number, longPauses: number): number {
  const durations = words
    .map((word) => Number(word.endMs || 0) - Number(word.startMs || 0))
    .filter((duration) => duration >= 40 && duration <= 1600);
  if (durations.length < 3) {
    return clamp(100 - pauseRatio * 55 - longPauses * 10);
  }

  const mean = durations.reduce((sum, duration) => sum + duration, 0) / durations.length;
  const variance = durations.reduce(
    (sum, duration) => sum + ((duration - mean) ** 2),
    0,
  ) / durations.length;
  const coefficient = Math.sqrt(variance) / Math.max(1, mean);
  return clamp(100 - coefficient * 55 - pauseRatio * 35 - longPauses * 8);
}

export function assessSpeech(
  reference: string,
  transcript: string,
  timing: SpeechTiming = {},
): SpeechAssessment {
  const expected = tokenizeEnglish(reference);
  const heard = tokenizeEnglish(transcript);
  const placeholderCount = (
    reference.normalize('NFKC').toLowerCase().match(/\b[xyz]\b/g) || []
  ).length;
  const denominator = Math.max(1, expected.length, heard.length);
  const distance = Math.max(
    0,
    editDistance(expected, heard) - Math.min(
      placeholderCount,
      Math.max(0, heard.length - expected.length),
    ),
  );
  const matched = lcsLength(expected, heard);
  const intelligibility = expected.length
    ? clamp((1 - distance / denominator) * 100)
    : 100;
  const completeness = expected.length
    ? clamp((matched / expected.length) * 100)
    : 100;

  const durationMs = Math.max(
    Number(timing.durationMs || 0),
    ...((timing.words || []).map((word) => Number(word.endMs || 0))),
  );
  const wordsPerMinute = durationMs > 0
    ? Math.round((heard.length * 60_000) / durationMs)
    : 0;
  const pauseRatio = durationMs > 0 && timing.voicedMs != null
    ? Math.max(0, Math.min(1, 1 - Number(timing.voicedMs) / durationMs))
    : 0;
  const longPauses = Math.max(0, Number(timing.longPauses || 0));
  const fluency = clamp(
    rateScore(wordsPerMinute) * 0.65
    + (100 - pauseRatio * 100) * 0.35
    - longPauses * 6,
  );
  const rhythm = rhythmScore(timing.words || [], pauseRatio, longPauses);
  const overall = clamp(
    intelligibility * 0.35
    + completeness * 0.30
    + fluency * 0.20
    + rhythm * 0.15,
  );

  const issues: string[] = [];
  if (completeness < 80) issues.push('有目标结构未被清楚识别');
  if (wordsPerMinute && wordsPerMinute < 95) issues.push('语速偏慢，可以减少词间等待');
  if (wordsPerMinute > 195) issues.push('语速偏快，可以给重音留出空间');
  if (pauseRatio > 0.38 || longPauses > 1) issues.push('停顿偏多，先按意群连起来');
  if (!issues.length) issues.push('整体清楚，继续保持自然连贯');

  return {
    overall,
    intelligibility,
    completeness,
    fluency,
    rhythm,
    wordsPerMinute,
    pauseRatio: Math.round(pauseRatio * 100) / 100,
    issues,
  };
}
