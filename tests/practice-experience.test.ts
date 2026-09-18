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

  it('lets related expressions be spoken, collected, and practiced', () => {
    const source = readFileSync('js/views.js', 'utf8');

    expect(source).toContain('id="say-bonus"');
    expect(source).toContain('id="cap-add-bonus"');
    expect(source).toContain("label: '相关表达练习'");
    expect(source).toContain('drill: bonus.drill');
  });

  it('shows passing answers with corrections as a distinct result', () => {
    const source = readFileSync('js/views.js', 'utf8');

    expect(source).toContain("'通过，但需纠正'");
    expect(source).toContain("'需要纠正（不影响本次通过）'");
    expect(source).toContain("'可选精简'");
  });

  it('persists practice attempts and guards detached async results', () => {
    const source = readFileSync('js/views.js', 'utf8');
    const drill = source.slice(
      source.indexOf('export function drillCard'),
      source.indexOf('export function viewHome'),
    );

    expect(drill).toContain('S.ensurePracticeSession');
    expect(drill).toContain('S.updatePracticeDraft');
    expect(drill).toContain('S.beginPracticeAttempt');
    expect(drill).toContain('S.settlePracticeAttempt');
    expect(drill).toContain('!root.isConnected');
    expect(drill).not.toContain('S.grade(');
  });

  it('uses separate drafts for capture and tools', () => {
    const primaryViews = readFileSync('js/views.js', 'utf8');
    const toolViews = readFileSync('js/views2.js', 'utf8');

    expect(primaryViews).toContain("S.getDraft('quickCapture')");
    expect(primaryViews).toContain("S.getDraft('expression')");
    expect(toolViews).toContain("S.getDraft('compression')");
    expect(toolViews).toContain("S.getDraft('preflight')");
  });
});
