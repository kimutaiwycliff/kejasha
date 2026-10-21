import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addPeriods,
  compareDates,
  daysInMonth,
  diffDays,
  dueDate,
  isIsoDate,
  monthEnd,
  monthStart,
  nairobiDate,
  nairobiOffsetMinutes,
  periodOf,
  startOfNairobiDay,
} from './time';

describe('Nairobi business dates', () => {
  it('maps instants near midnight to the Nairobi calendar day', () => {
    expect(nairobiDate(new Date('2026-10-31T20:59:59Z'))).toBe('2026-10-31');
    expect(nairobiDate(new Date('2026-10-31T21:00:00Z'))).toBe('2026-11-01');
  });
  it('derives the +03:00 offset from tzdata', () => {
    expect(nairobiOffsetMinutes(new Date('2026-06-01T00:00:00Z'))).toBe(180);
  });
  it('startOfNairobiDay is 21:00Z the previous day', () => {
    expect(startOfNairobiDay('2026-11-01').toISOString()).toBe('2026-10-31T21:00:00.000Z');
  });
});

describe('date arithmetic', () => {
  it('validates ISO dates', () => {
    expect(isIsoDate('2028-02-29')).toBe(true);
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(() => addDays('2026-02-30', 1)).toThrow();
  });
  it('adds and diffs days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(diffDays('2026-01-01', '2026-12-31')).toBe(364);
    expect(diffDays('2026-03-01', '2026-02-01')).toBe(-28);
  });
  it('handles periods', () => {
    expect(daysInMonth('2028-02')).toBe(29);
    expect(daysInMonth('2026-02')).toBe(28);
    expect(monthStart('2026-04')).toBe('2026-04-01');
    expect(monthEnd('2026-04')).toBe('2026-04-30');
    expect(periodOf('2026-10-21')).toBe('2026-10');
    expect(addPeriods('2026-11', 3)).toBe('2027-02');
    expect(addPeriods('2026-01', -1)).toBe('2025-12');
    expect(() => monthStart('2026-13')).toThrow();
  });
  it('addMonths clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-05-15', 12)).toBe('2027-05-15');
  });
  it('dueDate clamps billing day', () => {
    expect(dueDate('2026-02', 31)).toBe('2026-02-28');
    expect(dueDate('2026-10', 5)).toBe('2026-10-05');
    expect(() => dueDate('2026-10', 0)).toThrow();
    expect(() => dueDate('2026-10', 32)).toThrow();
  });
  it('compares dates', () => {
    expect(compareDates('2026-01-01', '2026-01-02')).toBe(-1);
    expect(compareDates('2026-01-02', '2026-01-02')).toBe(0);
  });
});
