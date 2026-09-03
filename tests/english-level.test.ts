import { describe, expect, it } from 'vitest';
import {
  englishLevelLabel,
  normalizeEnglishLevel,
} from '../src/core/english-level';

describe('English level normalization', () => {
  it('accepts direct CEFR self-assessment', () => {
    expect(normalizeEnglishLevel('cefr', 'b2')).toMatchObject({
      cefr: 'B2',
      approximate: false,
    });
  });

  it.each([
    ['ielts', '6.5', 'B2'],
    ['toefl', '100', 'C1'],
    ['toeic', '800', 'B2'],
    ['cet4', '500', 'B1'],
    ['cet6', '550', 'C1'],
  ])('maps %s %s to %s for exercise difficulty', (scale, score, cefr) => {
    expect(normalizeEnglishLevel(scale, score)?.cefr).toBe(cefr);
  });

  it('rejects missing and out-of-range scores', () => {
    expect(normalizeEnglishLevel('ielts', '')).toBeNull();
    expect(normalizeEnglishLevel('toefl', '121')).toBeNull();
  });

  it('formats the source score and normalized level', () => {
    expect(englishLevelLabel(normalizeEnglishLevel('ielts', '7')))
      .toBe('IELTS 7 · CEFR C1');
  });
});
