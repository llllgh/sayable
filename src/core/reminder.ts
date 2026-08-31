const DAY_MS = 86_400_000;

function minutes(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return hour * 60 + minute;
}

export function outsideQuietHours(
  remindAt: string,
  quietStart = '23:00',
  quietEnd = '08:00',
): string {
  const remind = minutes(remindAt, 21 * 60 + 30);
  const start = minutes(quietStart, 23 * 60);
  const end = minutes(quietEnd, 8 * 60);
  const inQuiet = start < end
    ? remind >= start && remind < end
    : remind >= start || remind < end;
  if (!inQuiet) return remindAt;
  return `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
}

export function reminderAt(
  now: number,
  dayOffset: number,
  remindAt: string,
  quietStart?: string,
  quietEnd?: string,
): Date {
  const safeTime = outsideQuietHours(remindAt, quietStart, quietEnd);
  const [hour, minute] = safeTime.split(':').map(Number);
  const first = new Date(now);
  first.setHours(hour, minute, 0, 0);
  if (first.getTime() <= now) first.setTime(first.getTime() + DAY_MS);
  first.setDate(first.getDate() + dayOffset);
  return first;
}
