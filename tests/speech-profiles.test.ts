import { describe, expect, it } from 'vitest';
import {
  SERVICE_PROFILES,
  getServiceProfile,
  hasRequiredCredentials,
  initialOnboardingRegion,
  normalizeServiceRegion,
  normalizeVoiceMode,
} from '../src/speech/profiles';

describe('service profiles', () => {
  it('keeps regional endpoints and public model names internal', () => {
    expect(SERVICE_PROFILES.cn.llm.baseUrl).toMatch(/^https:\/\//);
    expect(SERVICE_PROFILES.global.llm.baseUrl).toMatch(/^https:\/\//);
    expect(SERVICE_PROFILES.cn.llm.defaultModel).not.toMatch(/^ep-/);
    expect(SERVICE_PROFILES.global.llm.defaultModel).not.toMatch(/^ep-/);
    expect(SERVICE_PROFILES.cn.speech.asrUrl).toMatch(/^wss:\/\//);
    expect(SERVICE_PROFILES.global.speech.asrUrl).toMatch(/^wss:\/\//);
    expect(SERVICE_PROFILES.cn.speech.ttsUrl)
      .toMatch(/\/api\/v3\/tts\/unidirectional$/);
    expect(SERVICE_PROFILES.global.speech.ttsUrl)
      .toMatch(/\/api\/v3\/tts\/unidirectional$/);
    expect(SERVICE_PROFILES.global.llm.defaultModel)
      .toBe('deepseek-v4-flash-ga-260731');
  });

  it('uses safe defaults for unknown persisted values', () => {
    expect(normalizeServiceRegion('unknown')).toBe('cn');
    expect(normalizeVoiceMode('unknown')).toBe('system');
    expect(getServiceProfile('unknown').id).toBe('cn');
  });

  it('requires both model and speech credentials for onboarding', () => {
    expect(hasRequiredCredentials('model-key', 'speech-key')).toBe(true);
    expect(hasRequiredCredentials('model-key', '')).toBe(false);
    expect(hasRequiredCredentials('', 'speech-key')).toBe(false);
  });

  it('does not preselect a region for a clean installation', () => {
    expect(initialOnboardingRegion('', '', 'cn')).toBe('');
    expect(initialOnboardingRegion('', '', 'global')).toBe('');
    expect(initialOnboardingRegion('model-key', 'speech-key', 'global'))
      .toBe('global');
  });
});
