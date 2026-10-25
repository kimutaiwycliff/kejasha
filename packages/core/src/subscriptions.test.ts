import { describe, expect, it } from 'vitest';
import { monthlyAmount, periodFrom } from './subscriptions';

// Prices agreed 2026-10-25 (KES, in cents).
const landlord = {
  baseCents: 0n,
  unitPriceCents: 10_000n,
  listingPriceCents: 50_000n,
  minimumCents: 50_000n,
};
const agency = {
  baseCents: 300_000n,
  unitPriceCents: 7_000n,
  listingPriceCents: 50_000n,
  minimumCents: 300_000n,
};

describe('monthlyAmount', () => {
  it('charges per occupied unit with a minimum', () => {
    expect(monthlyAmount(landlord, { units: 3, listings: 0 })).toBe(50_000n); // 300 < 500 minimum
    expect(monthlyAmount(landlord, { units: 12, listings: 0 })).toBe(120_000n); // KES 1,200
    expect(monthlyAmount(landlord, { units: 10, listings: 2 })).toBe(200_000n); // 1,000 + 1,000
  });
  it('agency: base + per unit', () => {
    expect(monthlyAmount(agency, { units: 0, listings: 0 })).toBe(300_000n);
    expect(monthlyAmount(agency, { units: 200, listings: 0 })).toBe(1_700_000n); // 3,000 + 14,000
  });
});

describe('periodFrom', () => {
  it('runs to the day before the same date next month, clamping short months', () => {
    expect(periodFrom('2026-10-25')).toEqual({ start: '2026-10-25', end: '2026-11-24' });
    expect(periodFrom('2026-01-31').end).toBe('2026-02-27');
    expect(periodFrom('2026-12-01').end).toBe('2026-12-31');
  });
});
