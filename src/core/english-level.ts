export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
export type CefrLevel = typeof CEFR_LEVELS[number];

export const ENGLISH_LEVEL_SCALES = [
  'cefr',
  'ielts',
  'toefl',
  'toeic',
  'cet4',
  'cet6',
] as const;
export type EnglishLevelScale = typeof ENGLISH_LEVEL_SCALES[number];

export interface EnglishLevel {
  scale: EnglishLevelScale;
  score: string;
  cefr: CefrLevel;
  approximate: boolean;
}

const SCALE_LABELS: Record<EnglishLevelScale, string> = {
  cefr: 'CEFR',
  ielts: 'IELTS',
  toefl: 'TOEFL iBT',
  toeic: 'TOEIC L&R',
  cet4: '大学英语四级',
  cet6: '大学英语六级',
};

function numericScore(value: unknown): number | null {
  const match = String(value ?? '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const score = Number(match[0]);
  return Number.isFinite(score) ? score : null;
}

function cefrFromNumeric(
  scale: Exclude<EnglishLevelScale, 'cefr'>,
  score: number,
): CefrLevel | null {
  if (score < 0) return null;

  if (scale === 'ielts') {
    if (score > 9) return null;
    if (score >= 8.5) return 'C2';
    if (score >= 7) return 'C1';
    if (score >= 5.5) return 'B2';
    if (score >= 4) return 'B1';
    if (score >= 3) return 'A2';
    return 'A1';
  }

  if (scale === 'toefl') {
    if (score > 120) return null;
    if (score >= 95) return 'C1';
    if (score >= 72) return 'B2';
    if (score >= 42) return 'B1';
    if (score >= 32) return 'A2';
    return 'A1';
  }

  if (scale === 'toeic') {
    if (score > 990) return null;
    if (score >= 945) return 'C1';
    if (score >= 785) return 'B2';
    if (score >= 550) return 'B1';
    if (score >= 225) return 'A2';
    return 'A1';
  }

  if (score > 710) return null;
  if (scale === 'cet4') {
    if (score >= 550) return 'B2';
    if (score >= 425) return 'B1';
    return 'A2';
  }

  if (score >= 550) return 'C1';
  if (score >= 425) return 'B2';
  return 'B1';
}

export function normalizeEnglishLevel(
  scaleValue: unknown,
  scoreValue: unknown,
): EnglishLevel | null {
  const scale = String(scaleValue || '').toLowerCase() as EnglishLevelScale;
  if (!ENGLISH_LEVEL_SCALES.includes(scale)) return null;
  const score = String(scoreValue ?? '').trim();
  if (!score) return null;

  if (scale === 'cefr') {
    const match = score.toUpperCase().match(/\b(A1|A2|B1|B2|C1|C2)\b/);
    if (!match) return null;
    return {
      scale,
      score,
      cefr: match[1] as CefrLevel,
      approximate: false,
    };
  }

  const numeric = numericScore(score);
  if (numeric === null) return null;
  const cefr = cefrFromNumeric(scale, numeric);
  if (!cefr) return null;

  return {
    scale,
    score,
    cefr,
    approximate: true,
  };
}

export function englishLevelLabel(level: Partial<EnglishLevel> | null | undefined): string {
  if (!level?.cefr) return '';
  const scale = SCALE_LABELS[level.scale as EnglishLevelScale] || '自评';
  return `${scale} ${level.score || ''} · CEFR ${level.cefr}`.replace(/\s+/g, ' ').trim();
}
