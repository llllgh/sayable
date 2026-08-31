import { SecureStorage } from '@aparajita/capacitor-secure-storage';
import type { ServiceRegion } from '../speech/profiles';

const API_KEY = 'llm-api-key';
const REGIONS: ServiceRegion[] = ['cn', 'global'];
let initialized = false;

async function ready(): Promise<void> {
  if (initialized) return;
  await SecureStorage.setKeyPrefix('sayable_');
  initialized = true;
}

export async function getApiKey(): Promise<string> {
  await ready();
  const value = await SecureStorage.get(API_KEY, false);
  return typeof value === 'string' ? value : '';
}

export async function setApiKey(value: string): Promise<void> {
  await ready();
  const trimmed = value.trim();
  if (trimmed) {
    await SecureStorage.set(API_KEY, trimmed, false);
  } else {
    await SecureStorage.remove(API_KEY);
  }
}

export async function clearApiKey(): Promise<void> {
  await ready();
  await SecureStorage.remove(API_KEY);
}

function regionalKey(capability: 'llm' | 'speech', region: ServiceRegion): string {
  return `${capability}-api-key-${region}`;
}

async function getSecret(key: string): Promise<string> {
  await ready();
  const value = await SecureStorage.get(key, false);
  return typeof value === 'string' ? value : '';
}

async function setSecret(key: string, value: string): Promise<void> {
  await ready();
  const trimmed = value.trim();
  if (trimmed) {
    await SecureStorage.set(key, trimmed, false);
  } else {
    await SecureStorage.remove(key);
  }
}

export function getLlmApiKey(region: ServiceRegion): Promise<string> {
  return getSecret(regionalKey('llm', region));
}

export function setLlmApiKey(region: ServiceRegion, value: string): Promise<void> {
  return setSecret(regionalKey('llm', region), value);
}

export function getSpeechApiKey(region: ServiceRegion): Promise<string> {
  return getSecret(regionalKey('speech', region));
}

export function setSpeechApiKey(region: ServiceRegion, value: string): Promise<void> {
  return setSecret(regionalKey('speech', region), value);
}

export async function clearProfileCredentials(): Promise<void> {
  await ready();
  await Promise.all(REGIONS.flatMap((region) => [
    SecureStorage.remove(regionalKey('llm', region)),
    SecureStorage.remove(regionalKey('speech', region)),
  ]));
  await SecureStorage.remove(API_KEY);
}
