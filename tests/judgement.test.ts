import { describe, expect, it } from 'vitest';
import {
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

  it('labels the read-only review ladder in result cards', () => {
    const html = ladderHTML(2, false, { labeled: true });
    expect(html).toContain('复习阶梯 2 / 5');
    expect(html).toContain('aria-label="复习阶梯 2 / 5"');
  });
});
