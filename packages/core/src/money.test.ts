import { describe, expect, it } from 'vitest';
import {
  abs,
  allocate,
  applyBps,
  cents,
  divRound,
  formatKes,
  fromApiInt,
  parseKes,
  splitEvenly,
  sum,
  toApiInt,
} from './money';

describe('cents', () => {
  it('accepts integers, bigints and integer strings', () => {
    expect(cents(150000)).toBe(150000n);
    expect(cents(-5n)).toBe(-5n);
    expect(cents(' 42 ')).toBe(42n);
  });
  it('rejects fractions and unsafe numbers', () => {
    expect(() => cents(1.5)).toThrow(RangeError);
    expect(() => cents(2 ** 60)).toThrow(RangeError);
    expect(() => cents('12.00')).toThrow(RangeError);
  });
});

describe('parseKes', () => {
  it.each([
    ['1,234.50', 123450n],
    ['KES 1,234.5', 123450n],
    ['Ksh. 15,000', 1500000n],
    ['-300', -30000n],
    ['0.05', 5n],
    ['25000.00', 2500000n],
  ])('%s → %s', (input, expected) => expect(parseKes(input)).toBe(expected));

  it('rejects ambiguous or over-precise amounts', () => {
    expect(() => parseKes('12.345')).toThrow();
    expect(() => parseKes('abc')).toThrow();
    expect(() => parseKes('')).toThrow();
  });
});

describe('arithmetic', () => {
  it('sums and abs', () => {
    expect(sum([100n, -30n, 5n])).toBe(75n);
    expect(sum([])).toBe(0n);
    expect(abs(-7n)).toBe(7n);
  });
  it('divRound rounds half away from zero', () => {
    expect(divRound(5n, 2n)).toBe(3n);
    expect(divRound(-5n, 2n)).toBe(-3n);
    expect(divRound(4n, 3n)).toBe(1n);
    expect(divRound(5n, -3n)).toBe(-2n);
    expect(() => divRound(1n, 0n)).toThrow();
  });
  it('applyBps computes MRI 7.5% exactly', () => {
    expect(applyBps(3_000_000n, 750)).toBe(225_000n); // KES 30,000 → KES 2,250
    expect(applyBps(333n, 750)).toBe(25n); // 24.975 → 25
    expect(applyBps(-333n, 750)).toBe(-25n);
  });
});

describe('allocate', () => {
  it('never loses or creates a cent', () => {
    for (const total of [0n, 1n, 99n, 100n, 1_000_001n, -1_000_001n]) {
      for (const weights of [[1, 1, 1], [3, 7], [1], [0, 1, 0], [5, 5, 5, 5, 5, 5, 5]]) {
        expect(sum(allocate(total, weights))).toBe(total);
      }
    }
  });
  it('is proportional and deterministic on ties', () => {
    expect(allocate(100n, [1, 1, 1])).toEqual([34n, 33n, 33n]);
    expect(allocate(1000n, [70, 30])).toEqual([700n, 300n]);
    expect(splitEvenly(10n, 3)).toEqual([4n, 3n, 3n]);
  });
  it('rejects bad weights', () => {
    expect(() => allocate(1n, [])).toThrow();
    expect(() => allocate(1n, [0, 0])).toThrow();
    expect(() => allocate(1n, [-1, 2])).toThrow();
  });
});

describe('formatting and wire', () => {
  it('formats KES', () => {
    expect(formatKes(123456789n)).toBe('KES 1,234,567.89');
    expect(formatKes(5n)).toBe('KES 0.05');
    expect(formatKes(-150000n)).toBe('-KES 1,500.00');
    expect(formatKes(100n, { currency: false })).toBe('1.00');
  });
  it('round-trips JSON integers and guards precision', () => {
    expect(toApiInt(123n)).toBe(123);
    expect(fromApiInt(123)).toBe(123n);
    expect(() => toApiInt(2n ** 60n)).toThrow(RangeError);
  });
});
