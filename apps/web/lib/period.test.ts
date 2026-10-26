import { afterEach, describe, expect, it, vi } from 'vitest';
import { lastMonth, periodLabel, thisMonth } from './period';

describe('months', () => {
  afterEach(() => vi.useRealTimers());

  it('last month wraps the year in January', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-01-10T08:00:00Z'));
    expect(thisMonth()).toBe('2027-01');
    expect(lastMonth()).toBe('2026-12');
  });

  it('labels a period by name', () => {
    expect(periodLabel('2026-10')).toBe('October 2026');
  });
});
