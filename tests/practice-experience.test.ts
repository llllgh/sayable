import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('practice experience', () => {
  it('does not render or schedule a visible answer countdown', () => {
    const source = readFileSync('js/views.js', 'utf8');
    const drill = source.slice(
      source.indexOf('export function drillCard'),
      source.indexOf('export function viewHome'),
    );

    expect(drill).not.toContain('setInterval');
    expect(drill).not.toContain('倒计时');
    expect(drill).not.toContain('id="${id}-n"');
  });

  it('keeps submit, answer, and defer actions in one action group', () => {
    const source = readFileSync('js/views.js', 'utf8');

    expect(source).toContain('class="drill-actions ${opts.skippable');
    expect(source).toContain('<button class="btn-text" id="${id}-skip">稍后</button>');
    expect(source).not.toContain('稍后再练</button></p>');
  });

  it('includes normalized English level in profile and model context', () => {
    const profileView = readFileSync('js/views2.js', 'utf8');
    const llm = readFileSync('js/llm.js', 'utf8');

    expect(profileView).toContain('normalizeEnglishLevel');
    expect(profileView).toContain('TOEFL iBT');
    expect(profileView).toContain('英语六级');
    expect(llm).toContain('英语水平：${englishLevelLabel');
  });
});
