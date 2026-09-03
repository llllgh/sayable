import { describe, expect, it } from 'vitest';
import {
  SERVICE_PROFILES,
  getServiceProfile,
  hasRequiredCredentials,
  initialOnboardingRegion,
  normalizeServiceRegion,
  normalizeVoiceMode,
} from '../src/speech/profiles';
import {
  TEXT_PROVIDER_PROFILES,
  defaultTextProviderId,
  legacyTextProviderId,
  textProvidersForRegion,
} from '../src/llm/profiles';

describe('service profiles', () => {
  it('keeps regional endpoints and public model names internal', () => {
    expect(TEXT_PROVIDER_PROFILES['modelark-cn'].baseUrl).toMatch(/^https:\/\//);
    expect(TEXT_PROVIDER_PROFILES['byteplus-global'].baseUrl).toMatch(/^https:\/\//);
    expect(TEXT_PROVIDER_PROFILES['google-gemini'].baseUrl)
      .toBe('https://generativelanguage.googleapis.com/v1beta/openai');
    expect(TEXT_PROVIDER_PROFILES['modelark-cn'].defaultModel).not.toMatch(/^ep-/);
    expect(TEXT_PROVIDER_PROFILES['byteplus-global'].defaultModel).not.toMatch(/^ep-/);
    expect(TEXT_PROVIDER_PROFILES['google-gemini'].defaultModel)
      .toMatch(/^gemini-/);
    expect(SERVICE_PROFILES.cn.speech.asrUrl).toMatch(/^wss:\/\//);
    expect(SERVICE_PROFILES.global.speech.asrUrl).toMatch(/^wss:\/\//);
    expect(SERVICE_PROFILES.cn.speech.ttsUrl)
      .toMatch(/\/api\/v3\/tts\/unidirectional$/);
    expect(SERVICE_PROFILES.global.speech.ttsUrl)
      .toMatch(/\/api\/v3\/tts\/unidirectional$/);
    expect(SERVICE_PROFILES.cn.speech.label).toBe('火山引擎语音');
    expect(SERVICE_PROFILES.global.speech.label).toBe('BytePlus Speech');
    expect(defaultTextProviderId('global')).toBe('byteplus-global');
    expect(legacyTextProviderId('global')).toBe('byteplus-global');
    expect(textProvidersForRegion('cn').map(profile => profile.id))
      .toEqual(['modelark-cn']);
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
