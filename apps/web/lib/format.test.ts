import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatDate, formatKes, parseKes, todayNairobi } from './format';

describe('money at the UI edge (cents in, shillings shown)', () => {
  it('formats cents as Kenyan shillings', () => {
    // Intl keeps "Ksh" and the amount together with a non-breaking space.
    expect(formatKes(1_850_050)).toBe('Ksh\u00a018,500.50');
    expect(formatKes(0)).toBe('Ksh\u00a00.00');
    expect(formatKes(null)).toBe('—');
  });

  it('parses typed shillings into whole cents without floats', () => {
    expect(parseKes('18,500')).toBe(1_850_000);
    expect(parseKes('18500.5')).toBe(1_850_050);
    expect(parseKes(' KES 1,234.56 ')).toBe(123_456);
    expect(parseKes('0.1')).toBe(10);
    // 0.1 + 0.2-style float drift cannot happen: digits are split, not multiplied.
    expect(parseKes('1234567.89')).toBe(123_456_789);
  });

  it('rejects anything that is not an amount', () => {
    for (const bad of ['', 'abc', '1.234', '-5', '1,2,3.4.5', '12e3'])
      expect(parseKes(bad), bad).toBeNull();
  });
});

describe('business dates in Africa/Nairobi', () => {
  afterEach(() => vi.useRealTimers());

  it('rolls over at Nairobi midnight, not UTC midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-26T21:30:00Z')); // 00:30 on the 27th in Nairobi (UTC+3)
    expect(todayNairobi()).toBe('2026-10-27');
  });

  it('shows a business date as that calendar day', () => {
    expect(formatDate('2026-10-01')).toBe('1 Oct 2026');
    expect(formatDate(null)).toBe('—');
  });
});
