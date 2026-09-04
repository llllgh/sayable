import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('native security configuration', () => {
  it('disables Capacitor argument logging so plugin credentials are not logged', () => {
    const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));

    expect(config.android.loggingBehavior).toBe('none');
  });

  it('keeps clean-install onboarding fields empty and region unselected', () => {
    const source = readFileSync('js/views2.js', 'utf8');
    const onboarding = source.slice(
      source.indexOf('export function onboardingSheet'),
      source.indexOf('/* ---------------------------------------------------------------- 设置 */'),
    );

    expect(onboarding).toContain('initialOnboardingRegion(');
    expect(onboarding).not.toMatch(/id="ob-key"[^>]*\svalue=/);
    expect(onboarding).not.toMatch(/id="ob-speech-key"[^>]*\svalue=/);
  });

  it('adds visibility controls to every API key input', () => {
    const source = readFileSync('js/views2.js', 'utf8');

    expect(source).toContain('data-secret-target="${id}"');
    expect(source).toContain("secretInputHTML('ob-key'");
    expect(source).toContain("secretInputHTML('ob-speech-key'");
    expect(source).toContain("secretInputHTML('s-key'");
    expect(source).toContain("secretInputHTML('s-speech-key'");
    expect(source).toContain("input.type = revealed ? 'text' : 'password'");
    expect(source).toContain("revealed ? '隐藏 API Key' : '显示 API Key'");
  });
});
