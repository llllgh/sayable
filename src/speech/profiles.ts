export type ServiceRegion = 'cn' | 'global';
export type VoiceMode = 'system' | 'cloud';

export interface ServiceProfile {
  id: ServiceRegion;
  label: string;
  speech: {
    label: string;
    keyPlaceholder: string;
    keyHelp: string;
    asrUrl: string;
    asrResourceId: string;
    ttsUrl: string;
    ttsResourceId: string;
    ttsAppKey?: string;
    defaultVoice: string;
  };
}

export const DEFAULT_SERVICE_REGION: ServiceRegion = 'cn';
export const DEFAULT_VOICE_MODE: VoiceMode = 'system';

export const SERVICE_PROFILES: Record<ServiceRegion, ServiceProfile> = {
  cn: {
    id: 'cn',
    label: '中国大陆',
    speech: {
      label: '火山引擎语音',
      keyPlaceholder: '输入火山引擎语音 API Key',
      keyHelp: '同一个语音 Key 用于语音识别和朗读。',
      asrUrl: 'wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async',
      asrResourceId: 'volc.seedasr.sauc.duration',
      ttsUrl: 'https://openspeech.bytedance.com/api/v3/tts/unidirectional',
      ttsResourceId: 'seed-tts-2.0',
      defaultVoice: 'en_female_dacey_uranus_bigtts',
    },
  },
  global: {
    id: 'global',
    label: '海外',
    speech: {
      label: 'BytePlus Speech',
      keyPlaceholder: '输入 BytePlus Speech API Key',
      keyHelp: '同一个语音 Key 用于语音识别和朗读。',
      asrUrl: 'wss://voice.ap-southeast-1.bytepluses.com/api/v3/sauc/bigmodel_async',
      asrResourceId: 'volc.seedasr.sauc.duration',
      ttsUrl: 'https://voice.ap-southeast-1.bytepluses.com/api/v3/tts/unidirectional',
      ttsResourceId: 'seed-tts-2.0',
      ttsAppKey: 'aGjiRDfUWi',
      defaultVoice: 'en_female_dacey_uranus_bigtts',
    },
  },
};

export function normalizeServiceRegion(value: unknown): ServiceRegion {
  return value === 'global' ? 'global' : DEFAULT_SERVICE_REGION;
}

export function normalizeVoiceMode(value: unknown): VoiceMode {
  return value === 'cloud' ? 'cloud' : DEFAULT_VOICE_MODE;
}

export function getServiceProfile(value: unknown): ServiceProfile {
  return SERVICE_PROFILES[normalizeServiceRegion(value)];
}

export function hasRequiredCredentials(
  llmApiKey: unknown,
  speechApiKey: unknown,
): boolean {
  return Boolean(
    String(llmApiKey || '').trim()
    && String(speechApiKey || '').trim(),
  );
}

export function initialOnboardingRegion(
  llmApiKey: unknown,
  speechApiKey: unknown,
  currentRegion: unknown,
): ServiceRegion | '' {
  return hasRequiredCredentials(llmApiKey, speechApiKey)
    ? normalizeServiceRegion(currentRegion)
    : '';
}
