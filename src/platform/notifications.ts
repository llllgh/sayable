import { Capacitor, registerPlugin } from '@capacitor/core';
import {
  LocalNotifications,
  type ActionPerformed,
  type LocalNotificationSchema,
} from '@capacitor/local-notifications';
import { reminderAt } from '../core/reminder';

const CHANNEL_ID = 'sayable-recall';
const ACTION_TYPE = 'SAYABLE_RECALL';
const FIRST_NOTIFICATION_ID = 4100;
const DAYS_TO_SCHEDULE = 7;

interface NativeRecallNotificationsPlugin {
  schedule(options: {
    notifications: Array<{
      id: number;
      itemId: string;
      title: string;
      body: string;
      at: number;
    }>;
  }): Promise<{ count: number }>;
  cancelAll(): Promise<void>;
  showTest(options: { itemId: string; body: string }): Promise<void>;
  consumeReplies(): Promise<{
    items: Array<{ itemId: string; answer: string; receivedAt: number }>;
  }>;
  isIgnoringBatteryOptimizations(): Promise<{ value: boolean }>;
  requestIgnoreBatteryOptimizations(): Promise<void>;
}

const RecallNotifications = registerPlugin<NativeRecallNotificationsPlugin>(
  'RecallNotifications',
);

export interface RecallItem {
  id: string;
  zh: string;
  dueAt: number;
  status: string;
}

export interface NotificationSettings {
  notificationsEnabled: boolean;
  remindAt: string;
  quietStart?: string;
  quietEnd?: string;
}

function notificationIds(): number[] {
  return Array.from({ length: DAYS_TO_SCHEDULE }, (_, index) => FIRST_NOTIFICATION_ID + index);
}

export async function initializeNotifications(
  onOpen: (itemId: string, answer?: string) => void,
): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await LocalNotifications.createChannel({
    id: CHANNEL_ID,
    name: '到期召回',
    description: '只在有到期表达时提醒',
    importance: 4,
    visibility: 1,
  });
  await LocalNotifications.registerActionTypes({
    types: [{
      id: ACTION_TYPE,
      actions: [{
        id: 'answer',
        title: '作答',
        foreground: true,
        input: true,
        inputButtonTitle: '提交',
        inputPlaceholder: '说出或写出答案',
      }],
    }],
  });
  await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (action: ActionPerformed) => {
      const itemId = String(action.notification.extra?.itemId || '');
      if (itemId) onOpen(itemId, action.inputValue);
    },
  );
}

export async function consumeRecallReplies(): Promise<Array<{
  itemId: string;
  answer: string;
  receivedAt: number;
}>> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return [];
  try {
    const result = await RecallNotifications.consumeReplies();
    return Array.isArray(result.items) ? result.items : [];
  } catch {
    return [];
  }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!Capacitor.isNativePlatform()) {
    if (!('Notification' in window)) return false;
    return (await Notification.requestPermission()) === 'granted';
  }
  const result = await LocalNotifications.requestPermissions();
  return result.display === 'granted';
}

export async function exactAlarmPermission(): Promise<string> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return 'granted';
  }
  const result = await LocalNotifications.checkExactNotificationSetting();
  return result.exact_alarm;
}

export async function openExactAlarmSettings(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await LocalNotifications.changeExactNotificationSetting();
}

export async function batteryOptimizationIgnored(): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') {
    return true;
  }
  const result = await RecallNotifications.isIgnoringBatteryOptimizations();
  return result.value;
}

export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await RecallNotifications.requestIgnoreBatteryOptimizations();
}

export async function showTestRecall(item: RecallItem): Promise<boolean> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return false;
  if (!(await requestNotificationPermission())) return false;
  await RecallNotifications.showTest({
    itemId: item.id,
    body: `「${item.zh}」怎么说？`,
  });
  return true;
}

export async function rescheduleRecallNotifications(
  items: RecallItem[],
  settings: NotificationSettings,
  dayStride = 1,
): Promise<number> {
  if (!Capacitor.isNativePlatform()) return 0;

  const ids = notificationIds();
  await LocalNotifications.cancel({
    notifications: ids.map((id) => ({ id })),
  }).catch(() => undefined);
  if (Capacitor.getPlatform() === 'android') {
    await RecallNotifications.cancelAll().catch(() => undefined);
  }
  if (!settings.notificationsEnabled) return 0;

  const permission = await LocalNotifications.checkPermissions();
  if (permission.display !== 'granted') return 0;

  const active = items
    .filter((item) => item.status !== 'retired')
    .sort((left, right) => left.dueAt - right.dueAt);
  const notifications: LocalNotificationSchema[] = [];

  for (let day = 0, slot = 0; day < DAYS_TO_SCHEDULE; day += dayStride, slot += 1) {
    const scheduleAt = reminderAt(
      Date.now(),
      day,
      settings.remindAt || '21:30',
      settings.quietStart,
      settings.quietEnd,
    );
    const due = active.filter((item) => item.dueAt <= scheduleAt.getTime());
    if (!due.length) continue;
    const item = due[slot % due.length];
    notifications.push({
      id: FIRST_NOTIFICATION_ID + day,
      title: '说得出',
      body: `「${item.zh}」怎么说？`,
      schedule: {
        at: scheduleAt,
        allowWhileIdle: true,
      },
      channelId: CHANNEL_ID,
      actionTypeId: ACTION_TYPE,
      autoCancel: true,
      extra: { itemId: item.id },
    });
  }

  if (notifications.length) {
    if (Capacitor.getPlatform() === 'android') {
      await RecallNotifications.schedule({
        notifications: notifications.map((notification) => ({
          id: notification.id,
          itemId: String(notification.extra?.itemId || ''),
          title: notification.title,
          body: notification.body,
          at: notification.schedule?.at?.getTime() || Date.now(),
        })),
      });
    } else {
      await LocalNotifications.schedule({ notifications });
    }
  }
  return notifications.length;
}
