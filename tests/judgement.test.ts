import { describe, expect, it } from 'vitest';
import {
  buildJudgementFeedback,
  compareJudgementText,
  normalizeJudgementText,
  resolveJudgement,
} from '../src/core/judgement';
import { ladderHTML } from '../js/ui.js';

describe('judgement', () => {
  it('ignores ASR capitalization and punctuation noise', () => {
    expect(normalizeJudgementText(
      'From a cost standpoint, Compacting Context help you. Reduce token spend!',
    )).toBe(
      'from a cost standpoint compacting context help you reduce token spend',
    );
  });

  it('passes a minor grammar issue when target and meaning are intact', () => {
    expect(resolveJudgement({
      ok: false,
      used_target: true,
      meaning_intact: true,
      issue_level: 'minor',
      verdict: '没过，help 应改为 helps。',
      fix: 'From a cost standpoint, compacting context helps you reduce token spend.',
      note: '目标骨架用对了。',
    })).toMatchObject({
      ok: true,
      verdict: '过了，目标结构和语义都对；局部错误已修正。',
    });
  });

  it('fails only when the target, meaning, or issue is blocking', () => {
    expect(resolveJudgement({
      ok: true,
      used_target: true,
      meaning_intact: false,
      issue_level: 'blocking',
      verdict: '过了。',
    })).toMatchObject({
      ok: false,
      verdict: '还没过，目标结构或核心语义需要调整。',
    });
  });

  it('hides a correction when it only changes ASR formatting', () => {
    expect(compareJudgementText(
      'Just To give you a rough sense of the scale. A Typical RD. Can use 10 million tokens. Per day.',
      'Just to give you a rough sense of the scale, a typical RD can use 10 million tokens per day.',
    )).toBeNull();

    expect(compareJudgementText(
      'From a cost standpoint, compacting context before you send a request. Reduces. Token usage.',
      'From a cost standpoint, compacting context before you send a request reduces token usage.',
    )).toBeNull();
  });

  it('builds a word-level diff for a substantive correction', () => {
    const diff = compareJudgementText(
      'From a cost standpoint, compacting context help you reduce token spend.',
      'From a cost standpoint, compacting context helps you reduce token spend.',
    );

    expect(diff?.summary).toBe('具体变化：“help”改为“helps”。');
    expect(diff?.before.filter(segment => segment.changed).map(segment => segment.value))
      .toEqual(['help']);
    expect(diff?.after.filter(segment => segment.changed).map(segment => segment.value))
      .toEqual(['helps']);
  });

  it('uses the formatting gate before showing model feedback', () => {
    expect(buildJudgementFeedback(
      'A Typical RD. Can use 10 million tokens. Per day.',
      {
        ok: true,
        issue_level: 'none',
        verdict: '通过，但前面多了无意义缩写片段。',
        fix: 'A typical RD can use 10 million tokens per day.',
        note: '断句可以更完整。',
      },
    )).toEqual({
      verdict: '通过，骨架和表达都对，没有需要改的地方。',
      note: '',
      correction: null,
      tighter: null,
    });
  });

  it('keeps a substantive tighter version without reviving a formatting-only fix', () => {
    const feedback = buildJudgementFeedback(
      'Just To give you a rough sense of the scale. A Typical RD. Can use 10 million tokens. Per day.',
      {
        ok: true,
        issue_level: 'none',
        fix: 'Just to give you a rough sense of the scale, a typical RD can use 10 million tokens per day.',
        tighter: 'Just to give you a rough sense, a typical RD handles about 10 million tokens daily.',
        verdict: '通过。',
        note: '断句问题。',
      },
    );

    expect(feedback.correction).toBeNull();
    expect(feedback.tighter?.changes.length).toBeGreaterThan(0);
    expect(feedback.verdict).toBe(
      '通过，骨架和表达都对。下面是一种更紧凑的说法。',
    );
    expect(feedback.note).toBe('');
  });

  it('labels the read-only review ladder in result cards', () => {
    const html = ladderHTML(2, false, { labeled: true });
    expect(html).toContain('复习阶梯 2 / 5');
    expect(html).toContain('aria-label="复习阶梯 2 / 5"');
  });
});
