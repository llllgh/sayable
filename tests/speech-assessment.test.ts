import { describe, expect, it } from 'vitest';
import { assessSpeech, tokenizeEnglish } from '../src/speech/assessment';

describe('speech assessment', () => {
  it('ignores skeleton placeholders', () => {
    expect(tokenizeEnglish('The bottleneck shifted from X to Y.')).toEqual([
      'the',
      'bottleneck',
      'shifted',
      'from',
      'to',
    ]);
  });

  it('scores a clear and complete response highly', () => {
    const result = assessSpeech(
      'The bottleneck has shifted from X to Y',
      'The bottleneck has shifted from generation to verification',
      {
        durationMs: 3_800,
        voicedMs: 3_200,
        longPauses: 0,
        words: [
          { text: 'The', startMs: 0, endMs: 180 },
          { text: 'bottleneck', startMs: 180, endMs: 620 },
          { text: 'has', startMs: 620, endMs: 790 },
          { text: 'shifted', startMs: 790, endMs: 1_120 },
          { text: 'from', startMs: 1_120, endMs: 1_310 },
          { text: 'generation', startMs: 1_310, endMs: 1_850 },
          { text: 'to', startMs: 1_850, endMs: 2_000 },
          { text: 'verification', startMs: 2_000, endMs: 2_650 },
        ],
      },
    );

    expect(result.intelligibility).toBe(100);
    expect(result.completeness).toBe(100);
    expect(result.fluency).toBeGreaterThanOrEqual(80);
    expect(result.issues).toContain('整体清楚，继续保持自然连贯');
  });

  it('reports omissions and excessive pauses', () => {
    const result = assessSpeech(
      'What matters is not X but Y',
      'What matters',
      {
        durationMs: 6_000,
        voicedMs: 1_500,
        longPauses: 3,
      },
    );

    expect(result.completeness).toBeLessThan(60);
    expect(result.fluency).toBeLessThan(50);
    expect(result.issues).toContain('有目标结构未被清楚识别');
    expect(result.issues).toContain('停顿偏多，先按意群连起来');
  });
});
