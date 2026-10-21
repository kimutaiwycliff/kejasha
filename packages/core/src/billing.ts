/**
 * Pure billing rules (ADR-006). Money is bigint cents; dates are Africa/Nairobi ISO dates;
 * periods are calendar months (YYYY-MM). No I/O — the leasing module and worker call these.
 */
import { applyBps, divRound, type Cents } from './money';
import {
  addDays,
  compareDates,
  daysInMonth,
  diffDays,
  dueDate,
  monthEnd,
  monthStart,
  periodOf,
  addPeriods,
  type IsoDate,
  type Period,
} from './time';

/** Invoices are issued this many days before they fall due. */
export const INVOICE_LEAD_DAYS = 5;

const maxDate = (a: IsoDate, b: IsoDate) => (compareDates(a, b) >= 0 ? a : b);
const minDate = (a: IsoDate, b: IsoDate) => (compareDates(a, b) <= 0 ? a : b);

// ── Periods & proration ─────────────────────────────────────────────────────────────────────

/** Days of the inclusive range [start, end] (end null = open-ended) inside `period`. */
export function occupiedDays(period: Period, start: IsoDate, end: IsoDate | null): number {
  const from = maxDate(monthStart(period), start);
  const to = end ? minDate(monthEnd(period), end) : monthEnd(period);
  return compareDates(from, to) > 0 ? 0 : diffDays(from, to) + 1;
}

/** Full-month amount scaled to occupied days, rounded half away from zero. */
export function prorate(amount: Cents, days: number, period: Period): Cents {
  const total = daysInMonth(period);
  if (days < 0 || days > total) throw new RangeError(`days ${days} out of range for ${period}`);
  return days === total ? amount : divRound(amount * BigInt(days), BigInt(total));
}

/** Whole months from period a to period b (b − a). */
export function monthsBetween(a: Period, b: Period): number {
  const [ya, ma] = a.split('-').map(Number) as [number, number];
  const [yb, mb] = b.split('-').map(Number) as [number, number];
  return (yb - ya) * 12 + (mb - ma);
}

/** Inclusive list of periods from `from` to `to` (empty if to < from). */
export function periodRange(from: Period, to: Period): Period[] {
  const n = monthsBetween(from, to);
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addPeriods(from, i));
}

// ── Rent schedule ──────────────────────────────────────────────────────────────────────────

export interface RentStep {
  effectivePeriod: Period;
  rentCents: Cents;
}

export interface RentSchedule {
  startDate: IsoDate;
  rentCents: Cents;
  /** Compounding increase in basis points (5% = 500), applied every `escalationEveryMonths`. */
  escalationBps: number | null;
  escalationEveryMonths: number | null;
  /** Explicit rent changes (renewal/renegotiation); escalation restarts from the latest step. */
  steps: RentStep[];
}

/** Full-month rent for `period` (before proration). */
export function rentForPeriod(s: RentSchedule, period: Period): Cents {
  const step = [...s.steps]
    .filter((x) => x.effectivePeriod <= period)
    .sort((a, b) => (a.effectivePeriod < b.effectivePeriod ? 1 : -1))[0];
  const basePeriod = step?.effectivePeriod ?? periodOf(s.startDate);
  let rent = step?.rentCents ?? s.rentCents;
  if (s.escalationBps && s.escalationEveryMonths && s.escalationEveryMonths > 0) {
    const steps = Math.floor(monthsBetween(basePeriod, period) / s.escalationEveryMonths);
    for (let i = 0; i < steps; i++) rent += applyBps(rent, s.escalationBps);
  }
  return rent;
}

/**
 * First period after `from` in which escalation raises the rent, or null if none. A rent step
 * landing before that point restarts the cycle, so the escalation moves to step + interval.
 */
export function nextEscalationPeriod(s: RentSchedule, from: Period): Period | null {
  if (!s.escalationBps || !s.escalationEveryMonths) return null;
  const every = s.escalationEveryMonths;
  const steps = [...s.steps].sort((a, b) => (a.effectivePeriod < b.effectivePeriod ? -1 : 1));
  const prior = steps.filter((x) => x.effectivePeriod <= from).at(-1);
  const base = prior?.effectivePeriod ?? periodOf(s.startDate);
  let candidate = addPeriods(
    base,
    (Math.floor(Math.max(0, monthsBetween(base, from)) / every) + 1) * every,
  );
  // Steps (ascending) landing in (from, candidate] restart the cycle at step + interval.
  for (const step of steps) {
    if (step.effectivePeriod <= from) continue;
    if (step.effectivePeriod > candidate) break;
    candidate = addPeriods(step.effectivePeriod, every);
  }
  return candidate;
}

// ── Invoice timing ─────────────────────────────────────────────────────────────────────────

export interface InvoiceDates {
  issueOn: IsoDate;
  dueOn: IsoDate;
}

/**
 * Due on the billing day (clamped to month end) but never before the tenant moves in; issued
 * INVOICE_LEAD_DAYS earlier.
 */
export function invoiceDates(
  period: Period,
  billingDay: number,
  leaseStart: IsoDate,
): InvoiceDates {
  const dueOn = maxDate(dueDate(period, billingDay), leaseStart);
  return { dueOn, issueOn: addDays(dueOn, -INVOICE_LEAD_DAYS) };
}

/** Periods of a lease that should be invoiced by `asOf` (issue date reached, lease occupies it). */
export function billablePeriods(
  lease: { startDate: IsoDate; endDate: IsoDate | null; billingDay: number },
  asOf: IsoDate,
): Period[] {
  const first = periodOf(lease.startDate);
  // The latest period that could be issued by asOf is the one after asOf's period (lead days).
  let last = addPeriods(periodOf(asOf), 1);
  if (lease.endDate && periodOf(lease.endDate) < last) last = periodOf(lease.endDate);
  return periodRange(first, last).filter(
    (p) =>
      occupiedDays(p, lease.startDate, lease.endDate) > 0 &&
      compareDates(invoiceDates(p, lease.billingDay, lease.startDate).issueOn, asOf) <= 0,
  );
}

// ── Metered charges ────────────────────────────────────────────────────────────────────────

/** Meter reading "123.456" → 123456n milli-units. At most 3 decimals; never a float. */
export function toMilli(reading: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(reading.trim());
  if (!m) throw new RangeError(`Invalid meter reading: ${reading}`);
  return BigInt(m[1]!) * 1000n + BigInt((m[2] ?? '').padEnd(3, '0') || '0');
}

export function fromMilli(milli: bigint): string {
  const sign = milli < 0n ? '-' : '';
  const a = milli < 0n ? -milli : milli;
  const frac = (a % 1000n).toString().padStart(3, '0').replace(/0+$/, '');
  return `${sign}${a / 1000n}${frac ? `.${frac}` : ''}`;
}

/** Consumption between two readings × unit price (cents per whole unit), rounded. */
export function meteredAmount(fromMilliUnits: bigint, toMilliUnits: bigint, unitPriceCents: Cents) {
  const consumptionMilli = toMilliUnits - fromMilliUnits;
  if (consumptionMilli < 0n) throw new RangeError('Meter reading went backwards');
  return { consumptionMilli, amountCents: divRound(consumptionMilli * unitPriceCents, 1000n) };
}

// ── Allocation, aging, late fees ───────────────────────────────────────────────────────────

export interface Debit {
  id: string;
  dueOn: IsoDate;
  amountCents: Cents;
  /** Tie-breaker for equal due dates (e.g. invoice number or created order). */
  seq: string;
}

/**
 * Apply `totalCredits` to debits oldest-due-first. Credits beyond all debits are tenant credit
 * (returned as `unappliedCredit`). Negative totals (should not happen) are treated as zero.
 */
export function allocateCredits(debits: Debit[], totalCredits: Cents) {
  let remaining = totalCredits > 0n ? totalCredits : 0n;
  const sorted = [...debits].sort(
    (a, b) => compareDates(a.dueOn, b.dueOn) || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0),
  );
  const items = sorted.map((d) => {
    const applied = remaining >= d.amountCents ? d.amountCents : remaining;
    remaining -= applied;
    return {
      id: d.id,
      dueOn: d.dueOn,
      amountCents: d.amountCents,
      outstandingCents: d.amountCents - applied,
    };
  });
  return { items, unappliedCredit: remaining };
}

export const AGING_BUCKETS = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

export function agingBucket(dueOn: IsoDate, asOf: IsoDate): AgingBucket {
  const overdue = diffDays(dueOn, asOf);
  if (overdue <= 0) return 'current';
  if (overdue <= 30) return 'd1_30';
  if (overdue <= 60) return 'd31_60';
  if (overdue <= 90) return 'd61_90';
  return 'd90_plus';
}

export function aging(items: { dueOn: IsoDate; outstandingCents: Cents }[], asOf: IsoDate) {
  const buckets: Record<AgingBucket, Cents> = {
    current: 0n,
    d1_30: 0n,
    d31_60: 0n,
    d61_90: 0n,
    d90_plus: 0n,
  };
  for (const i of items)
    if (i.outstandingCents > 0n) buckets[agingBucket(i.dueOn, asOf)] += i.outstandingCents;
  const total = AGING_BUCKETS.reduce((s, b) => s + buckets[b], 0n);
  return { ...buckets, total };
}

export interface LateFeeRule {
  kind: 'none' | 'flat' | 'percent';
  flatCents: Cents | null;
  bps: number | null;
  graceDays: number;
}

/** Late fee owed for an invoice, or 0 when none applies yet (on or before due + grace). */
export function lateFeeAmount(
  rule: LateFeeRule,
  dueOn: IsoDate,
  asOf: IsoDate,
  outstanding: Cents,
): Cents {
  if (rule.kind === 'none' || outstanding <= 0n) return 0n;
  if (diffDays(dueOn, asOf) <= rule.graceDays) return 0n;
  if (rule.kind === 'flat') return rule.flatCents ?? 0n;
  return applyBps(outstanding, rule.bps ?? 0);
}
