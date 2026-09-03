import type { LlmProtocol } from './provider';
import type { ServiceRegion } from '../speech/profiles';

export type TextProviderId =
  | 'modelark-cn'
  | 'byteplus-global'
  | 'google-gemini';

export interface TextProviderProfile {
  id: TextProviderId;
  label: string;
  region: ServiceRegion;
  protocol: LlmProtocol;
  baseUrl: string;
  defaultModel: string;
  keyPlaceholder: string;
  keyHelp: string;
}

export const TEXT_PROVIDER_IDS: TextProviderId[] = [
  'modelark-cn',
  'byteplus-global',
  'google-gemini',
];

export const TEXT_PROVIDER_PROFILES: Record<TextProviderId, TextProviderProfile> = {
  'modelark-cn': {
    id: 'modelark-cn',
    label: '火山方舟',
    region: 'cn',
    protocol: 'chat_completions',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'deepseek-v4-flash-ga-260731',
    keyPlaceholder: '输入火山方舟 API Key',
    keyHelp: '使用已开通对应模型的火山方舟 API Key。',
  },
  'byteplus-global': {
    id: 'byteplus-global',
    label: 'BytePlus ModelArk',
    region: 'global',
    protocol: 'responses',
    baseUrl: 'https://ark.ap-southeast.bytepluses.com/api/v3',
    defaultModel: 'deepseek-v4-flash-ga-260731',
    keyPlaceholder: '输入 BytePlus API Key',
    keyHelp: '使用已开通对应模型的 BytePlus ModelArk API Key。',
  },
  'google-gemini': {
    id: 'google-gemini',
    label: 'Google Gemini',
    region: 'global',
    protocol: 'chat_completions',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.8-flash',
    keyPlaceholder: '输入 Gemini API Key',
    keyHelp: '使用 Google AI Studio 创建的 Gemini API Key。',
  },
};

const DEFAULT_BY_REGION: Record<ServiceRegion, TextProviderId> = {
  cn: 'modelark-cn',
  global: 'byteplus-global',
};

const LEGACY_BY_REGION: Record<ServiceRegion, TextProviderId> = {
  cn: 'modelark-cn',
  global: 'byteplus-global',
};

export function textProvidersForRegion(
  region: ServiceRegion,
): TextProviderProfile[] {
  return TEXT_PROVIDER_IDS
    .map(id => TEXT_PROVIDER_PROFILES[id])
    .filter(profile => profile.region === region);
}

export function defaultTextProviderId(region: ServiceRegion): TextProviderId {
  return DEFAULT_BY_REGION[region];
}

export function legacyTextProviderId(region: ServiceRegion): TextProviderId {
  return LEGACY_BY_REGION[region];
}

export function normalizeTextProviderId(
  value: unknown,
  region: ServiceRegion,
): TextProviderId {
  const id = String(value || '') as TextProviderId;
  const profile = TEXT_PROVIDER_PROFILES[id];
  return profile?.region === region ? id : defaultTextProviderId(region);
}

export function getTextProviderProfile(
  value: unknown,
  region: ServiceRegion,
): TextProviderProfile {
  return TEXT_PROVIDER_PROFILES[normalizeTextProviderId(value, region)];
}
