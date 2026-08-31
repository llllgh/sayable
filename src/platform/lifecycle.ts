import { App as CapacitorApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Keyboard, KeyboardResize } from '@capacitor/keyboard';
import * as Store from '../../js/store.js';
import { processOutbox } from '../outbox';
import {
  consumeRecallReplies,
  initializeNotifications,
  rescheduleRecallNotifications,
} from './notifications';
import { consumeSharedText } from './share-inbox';

interface PlatformCallbacks {
  go: (route: string, argument?: unknown) => void;
  openDrill: (itemId: string, answer?: string) => void;
  closeOverlay: () => boolean;
}

function notificationStride(): number {
  const responses = (Store.state.log as Array<{ at: number; type: string }>)
    .filter((entry: any) => entry.type === 'notification_open')
    .sort((left: any, right: any) => right.at - left.at);
  const lastResponseAt = responses[0]?.at
    || Number((Store.state.settings as any).notificationsEnabledAt || Date.now());
  const inactiveDays = Math.floor((Date.now() - lastResponseAt) / 86_400_000);
  if (inactiveDays >= 7) return 7;
  if (inactiveDays >= 3) return 2;
  return 1;
}

export async function rescheduleNotifications(): Promise<number> {
  return rescheduleRecallNotifications(
    Store.state.items,
    Store.state.settings,
    notificationStride(),
  );
}

async function ingestShares(): Promise<number> {
  const items = await consumeSharedText();
  for (const item of items) Store.addFlash(item.text, null, 'share');
  return items.length;
}

async function ingestReplies(
  openDrill: (itemId: string, answer?: string) => void,
): Promise<number> {
  const replies = await consumeRecallReplies();
  if (replies.length) Store.addNotificationReplies(replies);
  const first = (Store.state as any).notificationReplies?.[0];
  if (first?.itemId) openDrill(first.itemId, first.answer);
  return first?.itemId ? 1 : 0;
}

function deepLinkItemId(urlValue: string): string {
  try {
    const url = new URL(urlValue);
    if (url.hostname === 'drill') return url.pathname.replace(/^\/+/, '');
    const match = url.pathname.match(/\/drill\/([^/]+)/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function handleDeepLink(urlValue: string, callbacks: PlatformCallbacks): void {
  try {
    const url = new URL(urlValue);
    if (url.hostname === 'capture') {
      callbacks.go('capture');
      return;
    }
  } catch {
    return;
  }
  const itemId = deepLinkItemId(urlValue);
  if (itemId) callbacks.openDrill(itemId);
}

export async function initializePlatform(callbacks: PlatformCallbacks): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;

  if (Capacitor.getPlatform() === 'android') {
    await Keyboard.setResizeMode({ mode: KeyboardResize.Body }).catch(() => undefined);
  }

  await initializeNotifications((itemId, answer) => {
    Store.track('notification_open', itemId);
    callbacks.openDrill(itemId, answer);
  });

  await CapacitorApp.addListener('backButton', () => {
    if (callbacks.closeOverlay()) return;
    const route = location.hash.slice(1);
    if (route && route !== 'home') {
      callbacks.go('home');
    } else {
      CapacitorApp.exitApp();
    }
  });

  await CapacitorApp.addListener('appUrlOpen', ({ url }) => {
    handleDeepLink(url, callbacks);
  });
  const launch = await CapacitorApp.getLaunchUrl();
  if (launch?.url) handleDeepLink(launch.url, callbacks);

  await CapacitorApp.addListener('appStateChange', async ({ isActive }) => {
    if (!isActive) {
      await Store.flush();
      return;
    }
    const shared = await ingestShares();
    const replies = await ingestReplies(callbacks.openDrill);
    await Promise.allSettled([processOutbox(), rescheduleNotifications()]);
    if (shared && !replies) callbacks.go('home');
  });

  const shared = await ingestShares();
  const replies = await ingestReplies(callbacks.openDrill);
  if (shared && !replies) callbacks.go('home');
  await Promise.allSettled([processOutbox(), rescheduleNotifications()]);
}
