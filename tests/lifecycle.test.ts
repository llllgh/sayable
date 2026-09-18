import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  appListeners: new Map<string, (...args: any[]) => any>(),
  keyboardListeners: new Map<string, (...args: any[]) => any>(),
  launchUrl: null as null | { url: string },
  notificationOpen: null as null | ((itemId: string, answer?: string) => void),
  state: {
    items: [] as any[],
    log: [] as any[],
    notificationReplies: [] as any[],
    settings: {
      notificationsEnabledAt: 0,
    },
  },
  addFlash: vi.fn(),
  addNotificationReplies: vi.fn(),
  flush: vi.fn(),
  track: vi.fn(),
  processOutbox: vi.fn(),
  rescheduleRecallNotifications: vi.fn(),
  consumeSharedText: vi.fn(),
  consumeRecallReplies: vi.fn(),
  keyboardHide: vi.fn(),
  exitApp: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => 'android',
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: vi.fn(async (
      eventName: string,
      listener: (...args: any[]) => any,
    ) => {
      harness.appListeners.set(eventName, listener);
      return { remove: vi.fn() };
    }),
    getLaunchUrl: vi.fn(async () => harness.launchUrl),
    exitApp: harness.exitApp,
  },
}));

vi.mock('@capacitor/keyboard', () => ({
  KeyboardResize: { Body: 'body' },
  Keyboard: {
    setResizeMode: vi.fn().mockResolvedValue(undefined),
    addListener: vi.fn(async (
      eventName: string,
      listener: (...args: any[]) => any,
    ) => {
      harness.keyboardListeners.set(eventName, listener);
      return { remove: vi.fn() };
    }),
    hide: harness.keyboardHide,
  },
}));

vi.mock('../js/store.js', () => ({
  state: harness.state,
  addFlash: harness.addFlash,
  addNotificationReplies: harness.addNotificationReplies,
  flush: harness.flush,
  track: harness.track,
}));

vi.mock('../src/outbox', () => ({
  processOutbox: harness.processOutbox,
}));

vi.mock('../src/platform/notifications', () => ({
  initializeNotifications: vi.fn(async (
    callback: (itemId: string, answer?: string) => void,
  ) => {
    harness.notificationOpen = callback;
  }),
  consumeRecallReplies: harness.consumeRecallReplies,
  rescheduleRecallNotifications: harness.rescheduleRecallNotifications,
}));

vi.mock('../src/platform/share-inbox', () => ({
  consumeSharedText: harness.consumeSharedText,
}));

import { initializePlatform } from '../src/platform/lifecycle';

function callbacks() {
  return {
    go: vi.fn(),
    openCapture: vi.fn(),
    openDrill: vi.fn(),
    closeOverlay: vi.fn(() => false),
  };
}

describe('native lifecycle routing and recovery', () => {
  const classes = new Set<string>();

  beforeEach(() => {
    vi.clearAllMocks();
    harness.appListeners.clear();
    harness.keyboardListeners.clear();
    harness.launchUrl = null;
    harness.notificationOpen = null;
    harness.state.items = [];
    harness.state.log = [];
    harness.state.notificationReplies = [];
    harness.state.settings.notificationsEnabledAt = 0;
    harness.addNotificationReplies.mockImplementation((items: any[]) => {
      harness.state.notificationReplies.push(...items);
    });
    harness.flush.mockResolvedValue(undefined);
    harness.processOutbox.mockResolvedValue(0);
    harness.rescheduleRecallNotifications.mockResolvedValue(0);
    harness.consumeSharedText.mockResolvedValue([]);
    harness.consumeRecallReplies.mockResolvedValue([]);
    harness.keyboardHide.mockResolvedValue(undefined);
    classes.clear();
    vi.stubGlobal('document', {
      body: {
        classList: {
          add: (value: string) => classes.add(value),
          remove: (value: string) => classes.delete(value),
          contains: (value: string) => classes.has(value),
        },
      },
    });
    vi.stubGlobal('location', { hash: '#recommend' });
  });

  it('opens the global quick capture for launch and runtime shortcuts', async () => {
    harness.launchUrl = { url: 'sayable://capture' };
    const actions = callbacks();
    await initializePlatform(actions);

    expect(actions.openCapture).toHaveBeenCalledOnce();
    expect(actions.go).not.toHaveBeenCalledWith('capture');

    await harness.appListeners.get('appUrlOpen')?.({
      url: 'sayable://capture',
    });
    expect(actions.openCapture).toHaveBeenCalledTimes(2);
  });

  it('queues incoming shares without replacing the active route', async () => {
    const actions = callbacks();
    await initializePlatform(actions);
    harness.consumeSharedText.mockResolvedValueOnce([{
      text: 'A shared sentence.',
      receivedAt: 100,
    }]);

    await harness.appListeners.get('appStateChange')?.({ isActive: true });

    expect(harness.addFlash).toHaveBeenCalledWith(
      'A shared sentence.',
      null,
      'share',
    );
    expect(actions.go).not.toHaveBeenCalled();
    expect(actions.openDrill).not.toHaveBeenCalled();
  });

  it('opens a notification reply ahead of any share navigation', async () => {
    const actions = callbacks();
    await initializePlatform(actions);
    harness.consumeSharedText.mockResolvedValueOnce([{
      text: 'A shared sentence.',
      receivedAt: 100,
    }]);
    harness.consumeRecallReplies.mockResolvedValueOnce([{
      itemId: 'item-1',
      answer: 'My answer',
      receivedAt: 200,
    }]);

    await harness.appListeners.get('appStateChange')?.({ isActive: true });

    expect(actions.openDrill).toHaveBeenCalledWith('item-1', 'My answer');
    expect(actions.go).not.toHaveBeenCalled();
  });

  it('flushes in the background and hides the keyboard before navigating back', async () => {
    const actions = callbacks();
    await initializePlatform(actions);

    await harness.appListeners.get('appStateChange')?.({ isActive: false });
    expect(harness.flush).toHaveBeenCalledOnce();

    harness.keyboardListeners.get('keyboardWillShow')?.();
    await harness.appListeners.get('backButton')?.();
    expect(harness.keyboardHide).toHaveBeenCalledOnce();
    expect(actions.closeOverlay).not.toHaveBeenCalled();
    expect(actions.go).not.toHaveBeenCalled();
    expect(harness.exitApp).not.toHaveBeenCalled();

    harness.keyboardListeners.get('keyboardDidHide')?.();
    await harness.appListeners.get('backButton')?.();
    expect(actions.closeOverlay).toHaveBeenCalledOnce();
    expect(actions.go).toHaveBeenCalledWith('home');
  });
});
