import { describe, expect, it } from 'vitest';
import { outsideQuietHours, reminderAt } from '../src/core/reminder';

describe('reminder scheduling', () => {
  it('moves a reminder in overnight quiet hours to the quiet end', () => {
    expect(outsideQuietHours('01:30', '23:00', '08:00')).toBe('08:00');
    expect(outsideQuietHours('21:30', '23:00', '08:00')).toBe('21:30');
  });

  it('starts tomorrow after todays reminder time has passed', () => {
    const now = new Date('2026-08-31T22:00:00').getTime();
    const first = reminderAt(now, 0, '21:30');
    const second = reminderAt(now, 1, '21:30');
    expect(first.getDate()).toBe(1);
    expect(second.getDate()).toBe(2);
    expect(second.getTime() - first.getTime()).toBe(86_400_000);
  });
});
