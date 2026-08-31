import { Capacitor, registerPlugin } from '@capacitor/core';

interface SharedText {
  text: string;
  receivedAt: number;
}

interface ShareInboxPlugin {
  consume(): Promise<{ items: SharedText[] }>;
}

const ShareInbox = registerPlugin<ShareInboxPlugin>('ShareInbox');

export async function consumeSharedText(): Promise<SharedText[]> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return [];
  try {
    const result = await ShareInbox.consume();
    return Array.isArray(result.items) ? result.items : [];
  } catch {
    return [];
  }
}
