import { describe, expect, it } from 'vitest';
import {
  bookingShare,
  channelComparison,
  commissionCents,
  monthlyProfit,
  nightsInPeriod,
  quote,
  weekday,
} from './shortstay';

const plan = {
  baseNightlyCents: 500_000n,
  weekendNightlyCents: 650_000n,
  minStayNights: 2,
  cleaningFeeCents: 150_000n,
};

describe('quote', () => {
  it('prices base, weekend and season nights and adds cleaning once', () => {
    expect(weekday('2026-10-23')).toBe(5); // Friday
    const q = quote(plan, [], '2026-10-22', '2026-10-25'); // Thu, Fri, Sat nights
    expect(q.nights.map((n) => [n.date, n.rate, n.nightlyCents])).toEqual([
      ['2026-10-22', 'base', 500_000n],
      ['2026-10-23', 'weekend', 650_000n],
      ['2026-10-24', 'weekend', 650_000n],
    ]);
    expect(q).toMatchObject({
      nightCount: 3,
      nightsTotalCents: 1_800_000n,
      totalCents: 1_950_000n,
      meetsMinStay: true,
    });
  });

  it('lets a season win over weekend pricing and raise the minimum stay', () => {
    const season = {
      from: '2026-12-20',
      to: '2027-01-03',
      nightlyCents: 900_000n,
      minStayNights: 5,
    };
    const q = quote(plan, [season], '2026-12-19', '2026-12-22');
    expect(q.nights.map((n) => n.rate)).toEqual(['weekend', 'season', 'season']);
    expect(q).toMatchObject({ minStayNights: 5, meetsMinStay: false });
    expect(() => quote(plan, [], '2026-10-22', '2026-10-22')).toThrow();
  });

  it('rounds commission in basis points', () => {
    expect(commissionCents(1_950_000n, 1500)).toBe(292_500n);
    expect(commissionCents(333n, 1550)).toBe(52n);
  });
});

describe('profit', () => {
  const bookings = [
    {
      checkIn: '2026-10-29',
      checkOut: '2026-11-02',
      grossCents: 2_000_000n,
      commissionCents: 300_000n,
      source: 'airbnb',
    }, // 3 nights Oct, 1 Nov
    {
      checkIn: '2026-10-10',
      checkOut: '2026-10-12',
      grossCents: 1_000_000n,
      commissionCents: 0n,
      source: 'direct',
    },
  ];

  it('splits a stay across months by nights without losing a cent', () => {
    expect(nightsInPeriod('2026-10', '2026-10-29', '2026-11-02')).toBe(3);
    expect(nightsInPeriod('2026-11', '2026-10-29', '2026-11-02')).toBe(1);
    const oct = bookingShare(bookings[0]!, '2026-10');
    const nov = bookingShare(bookings[0]!, '2026-11');
    expect(oct.grossCents + nov.grossCents).toBe(2_000_000n);
    expect(oct).toEqual({ nights: 3, grossCents: 1_500_000n, commissionCents: 225_000n });
  });

  it('computes occupancy, ADR, RevPAR and net for a month', () => {
    const p = monthlyProfit('2026-10', bookings, 400_000n, 1);
    expect(p).toEqual({
      period: '2026-10',
      nightsSold: 5,
      availableNights: 30,
      occupancyBps: 1667,
      grossCents: 2_500_000n,
      commissionCents: 225_000n,
      expensesCents: 400_000n,
      netCents: 1_875_000n,
      adrCents: 500_000n,
      revparCents: 83_333n,
    });
    expect(monthlyProfit('2026-09', bookings, 0n)).toMatchObject({
      nightsSold: 0,
      adrCents: 0n,
      netCents: 0n,
    });
  });

  it('compares channels by what they really earn', () => {
    expect(channelComparison(bookings)).toEqual([
      {
        source: 'airbnb',
        bookings: 1,
        nights: 4,
        grossCents: 2_000_000n,
        commissionCents: 300_000n,
        netCents: 1_700_000n,
        effectiveCommissionBps: 1500,
      },
      {
        source: 'direct',
        bookings: 1,
        nights: 2,
        grossCents: 1_000_000n,
        commissionCents: 0n,
        netCents: 1_000_000n,
        effectiveCommissionBps: 0,
      },
    ]);
  });
});
