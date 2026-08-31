import { SecureStorage } from '@aparajita/capacitor-secure-storage';

const API_KEY = 'llm-api-key';
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
