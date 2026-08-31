import { Network } from '@capacitor/network';

let connected = navigator.onLine;
let initialized = false;

export async function initNetwork(onReconnect?: () => void): Promise<void> {
  if (initialized) return;
  initialized = true;
  try {
    const status = await Network.getStatus();
    connected = status.connected;
    await Network.addListener('networkStatusChange', (next) => {
      const wasOffline = !connected;
      connected = next.connected;
      if (wasOffline && connected) onReconnect?.();
    });
  } catch {
    connected = navigator.onLine;
    window.addEventListener('online', () => {
      connected = true;
      onReconnect?.();
    });
    window.addEventListener('offline', () => {
      connected = false;
    });
  }
}

export function isOnline(): boolean {
  return connected && navigator.onLine;
}
