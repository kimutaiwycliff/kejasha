import { describe, expect, it } from 'vitest';
import {
  aging,
  agingBucket,
  allocateCredits,
  billablePeriods,
  fromMilli,
  invoiceDates,
  lateFeeAmount,
  meteredAmount,
  monthsBetween,
  nextEscalationPeriod,
  occupiedDays,
  periodRange,
  prorate,
  rentForPeriod,
  toMilli,
  type RentSchedule,
} from './billing';

describe('occupancy and proration', () => {
  it('counts occupied days inside a period', () => {
    expect(occupiedDays('2026-10', '2026-10-21', null)).toBe(11);
    expect(occupiedDays('2026-10', '2026-09-01', null)).toBe(31);
    expect(occupiedDays('2026-10', '2026-09-01', '2026-10-10')).toBe(10);
    expect(occupiedDays('2026-10', '2026-11-01', null)).toBe(0);
    expect(occupiedDays('2026-10', '2026-08-01', '2026-09-30')).toBe(0);
    expect(occupiedDays('2028-02', '2028-02-15', '2028-02-15')).toBe(1);
  });

  it('prorates by calendar days with half-up rounding', () => {
    expect(prorate(3_000_000n, 11, '2026-10')).toBe(1_064_516n); // 30,000 × 11/31 = 10,645.16
    expect(prorate(3_000_000n, 31, '2026-10')).toBe(3_000_000n);
    expect(prorate(1_000n, 14, '2026-02')).toBe(500n);
    expect(() => prorate(1n, 32, '2026-10')).toThrow();
  });

  it('iterates periods', () => {
    expect(monthsBetween('2026-11', '2027-02')).toBe(3);
    expect(periodRange('2026-11', '2027-01')).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(periodRange('2027-01', '2026-12')).toEqual([]);
  });
});

describe('rent schedule', () => {
  const base: RentSchedule = {
    startDate: '2026-01-15',
    rentCents: 2_000_000n,
    escalationBps: 500,
    escalationEveryMonths: 12,
    steps: [],
  };

  it('compounds escalation every N months from the start period', () => {
    expect(rentForPeriod(base, '2026-01')).toBe(2_000_000n);
    expect(rentForPeriod(base, '2026-12')).toBe(2_000_000n);
    expect(rentForPeriod(base, '2027-01')).toBe(2_100_000n);
    expect(rentForPeriod(base, '2028-01')).toBe(2_205_000n);
    expect(nextEscalationPeriod(base, '2026-06')).toBe('2027-01');
    expect(nextEscalationPeriod(base, '2027-01')).toBe('2028-01');
  });

  it('restarts escalation from the latest explicit rent step', () => {
    const s = { ...base, steps: [{ effectivePeriod: '2026-07', rentCents: 2_500_000n }] };
    expect(rentForPeriod(s, '2026-06')).toBe(2_000_000n);
    expect(rentForPeriod(s, '2027-06')).toBe(2_500_000n);
    expect(rentForPeriod(s, '2027-07')).toBe(2_625_000n);
    // A step after `from` restarts the cycle: no escalation in 2027-01, next is 2027-07.
    expect(nextEscalationPeriod(s, '2026-03')).toBe('2027-07');
    expect(nextEscalationPeriod(s, '2026-07')).toBe('2027-07');
    const two = {
      ...base,
      steps: [
        { effectivePeriod: '2026-07', rentCents: 1n },
        { effectivePeriod: '2027-03', rentCents: 2n },
      ],
    };
    expect(nextEscalationPeriod(two, '2026-03')).toBe('2028-03');
  });

  it('is flat without an escalation rule', () => {
    const flat = { ...base, escalationBps: null, escalationEveryMonths: null };
    expect(rentForPeriod(flat, '2030-01')).toBe(2_000_000n);
    expect(nextEscalationPeriod(flat, '2026-01')).toBeNull();
  });
});

describe('invoice timing', () => {
  it('is due on the billing day but never before move-in, issued 5 days earlier', () => {
    expect(invoiceDates('2026-11', 5, '2026-01-01')).toEqual({
      dueOn: '2026-11-05',
      issueOn: '2026-10-31',
    });
    expect(invoiceDates('2026-10', 1, '2026-10-21')).toEqual({
      dueOn: '2026-10-21',
      issueOn: '2026-10-16',
    });
    expect(invoiceDates('2026-02', 31, '2025-01-01').dueOn).toBe('2026-02-28');
  });

  it('lists the periods due for invoicing by a date', () => {
    const lease = { startDate: '2026-10-21', endDate: null, billingDay: 1 };
    expect(billablePeriods(lease, '2026-10-21')).toEqual(['2026-10']);
    expect(billablePeriods(lease, '2026-10-26')).toEqual(['2026-10']);
    expect(billablePeriods(lease, '2026-10-27')).toEqual(['2026-10', '2026-11']); // Nov 1 − 5 days
    expect(billablePeriods(lease, '2027-01-15')).toEqual([
      '2026-10',
      '2026-11',
      '2026-12',
      '2027-01',
    ]);
    expect(billablePeriods({ ...lease, endDate: '2026-11-30' }, '2027-06-01')).toEqual([
      '2026-10',
      '2026-11',
    ]);
    expect(billablePeriods({ ...lease, startDate: '2026-12-01' }, '2026-10-21')).toEqual([]);
  });
});

describe('metered charges', () => {
  it('converts readings without floats', () => {
    expect(toMilli('123.456')).toBe(123_456n);
    expect(toMilli('7')).toBe(7_000n);
    expect(toMilli('0.5')).toBe(500n);
    expect(fromMilli(123_450n)).toBe('123.45');
    expect(fromMilli(7_000n)).toBe('7');
    expect(() => toMilli('1.2345')).toThrow();
    expect(() => toMilli('-1')).toThrow();
  });

  it('prices consumption and refuses readings that go backwards', () => {
    expect(meteredAmount(toMilli('100'), toMilli('112.5'), 15_000n)).toEqual({
      consumptionMilli: 12_500n,
      amountCents: 187_500n,
    });
    expect(meteredAmount(toMilli('1.001'), toMilli('1.002'), 1n).amountCents).toBe(0n);
    expect(() => meteredAmount(toMilli('5'), toMilli('4'), 1n)).toThrow();
  });
});

describe('allocation, aging and late fees', () => {
  const debits = [
    { id: 'b', dueOn: '2026-11-01', amountCents: 3_000_000n, seq: '2' },
    { id: 'a', dueOn: '2026-10-01', amountCents: 3_000_000n, seq: '1' },
    { id: 'c', dueOn: '2026-12-01', amountCents: 3_000_000n, seq: '3' },
  ];

  it('applies credits oldest-due-first', () => {
    const r = allocateCredits(debits, 4_000_000n);
    expect(r.items.map((i) => [i.id, i.outstandingCents])).toEqual([
      ['a', 0n],
      ['b', 2_000_000n],
      ['c', 3_000_000n],
    ]);
    expect(r.unappliedCredit).toBe(0n);
    expect(allocateCredits(debits, 10_000_000n).unappliedCredit).toBe(1_000_000n);
    expect(
      allocateCredits(debits, -5n).items.every((i) => i.outstandingCents === i.amountCents),
    ).toBe(true);
  });

  it('breaks due-date ties by sequence', () => {
    const tie = [
      { id: 'late', dueOn: '2026-10-01', amountCents: 10n, seq: '9' },
      { id: 'early', dueOn: '2026-10-01', amountCents: 10n, seq: '1' },
    ];
    expect(allocateCredits(tie, 10n).items.find((i) => i.id === 'early')!.outstandingCents).toBe(
      0n,
    );
  });

  it('buckets arrears by days overdue', () => {
    expect(agingBucket('2026-10-01', '2026-10-01')).toBe('current');
    expect(agingBucket('2026-10-01', '2026-10-31')).toBe('d1_30');
    expect(agingBucket('2026-10-01', '2026-10-02')).toBe('d1_30');
    expect(agingBucket('2026-10-01', '2026-11-30')).toBe('d31_60');
    expect(agingBucket('2026-10-01', '2026-12-30')).toBe('d61_90');
    expect(agingBucket('2026-10-01', '2026-12-31')).toBe('d90_plus');
    const a = aging(
      [
        { dueOn: '2026-08-01', outstandingCents: 100n },
        { dueOn: '2026-10-25', outstandingCents: 50n },
        { dueOn: '2026-11-05', outstandingCents: 7n },
        { dueOn: '2026-11-06', outstandingCents: 0n },
      ],
      '2026-11-05',
    );
    expect(a).toEqual({
      current: 7n,
      d1_30: 50n,
      d31_60: 0n,
      d61_90: 0n,
      d90_plus: 100n,
      total: 157n,
    }); // Aug 1 → Nov 5 = 96 days
  });

  it('charges late fees only after the grace period', () => {
    const flat = { kind: 'flat' as const, flatCents: 100_000n, bps: null, graceDays: 3 };
    expect(lateFeeAmount(flat, '2026-11-05', '2026-11-08', 1n)).toBe(0n);
    expect(lateFeeAmount(flat, '2026-11-05', '2026-11-09', 1n)).toBe(100_000n);
    expect(lateFeeAmount(flat, '2026-11-05', '2026-12-01', 0n)).toBe(0n);
    const pct = { kind: 'percent' as const, flatCents: null, bps: 1000, graceDays: 0 };
    expect(lateFeeAmount(pct, '2026-11-05', '2026-11-06', 2_500_000n)).toBe(250_000n);
    expect(
      lateFeeAmount(
        { kind: 'none', flatCents: null, bps: null, graceDays: 0 },
        '2026-01-01',
        '2027-01-01',
        5n,
      ),
    ).toBe(0n);
  });
});
