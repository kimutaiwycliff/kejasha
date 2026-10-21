/**
 * Short-stay rules (ADR-010): nightly pricing and profit. Stays are half-open [checkIn, checkOut):
 * the check-out day is not a night. Pure — no I/O.
 */
import { allocate, applyBps, divRound, sum, type Cents } from './money';
import {
  addDays,
  daysInMonth,
  diffDays,
  monthEnd,
  monthStart,
  periodOf,
  type IsoDate,
  type Period,
} from './time';

export interface RatePlanRules {
  baseNightlyCents: Cents;
  /** Applies to Friday and Saturday nights. */
  weekendNightlyCents: Cents | null;
  minStayNights: number;
  cleaningFeeCents: Cents;
}

export interface Season {
  /** Inclusive first night. */
  from: IsoDate;
  /** Exclusive end (the first night not in the season). */
  to: IsoDate;
  nightlyCents: Cents;
  minStayNights: number | null;
}

export interface QuotedNight {
  date: IsoDate;
  nightlyCents: Cents;
  rate: 'season' | 'weekend' | 'base';
}

/** 0 = Sunday … 6 = Saturday, for an ISO calendar date. */
export function weekday(date: IsoDate): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function nights(checkIn: IsoDate, checkOut: IsoDate): number {
  return diffDays(checkIn, checkOut);
}

/** Price every night of a stay: season beats weekend beats base. */
export function quote(plan: RatePlanRules, seasons: Season[], checkIn: IsoDate, checkOut: IsoDate) {
  const n = nights(checkIn, checkOut);
  if (n <= 0) throw new RangeError('checkOut must be after checkIn');
  const priced: QuotedNight[] = [];
  let minStay = plan.minStayNights;
  for (let i = 0; i < n; i++) {
    const date = addDays(checkIn, i);
    const season = seasons.find((s) => s.from <= date && date < s.to);
    if (season) {
      priced.push({ date, nightlyCents: season.nightlyCents, rate: 'season' });
      if (season.minStayNights && season.minStayNights > minStay) minStay = season.minStayNights;
    } else if (plan.weekendNightlyCents !== null && (weekday(date) === 5 || weekday(date) === 6)) {
      priced.push({ date, nightlyCents: plan.weekendNightlyCents, rate: 'weekend' });
    } else {
      priced.push({ date, nightlyCents: plan.baseNightlyCents, rate: 'base' });
    }
  }
  const nightsTotal = sum(priced.map((p) => p.nightlyCents));
  return {
    nights: priced,
    nightCount: n,
    nightsTotalCents: nightsTotal,
    cleaningFeeCents: plan.cleaningFeeCents,
    totalCents: nightsTotal + plan.cleaningFeeCents,
    minStayNights: minStay,
    meetsMinStay: n >= minStay,
  };
}

export function commissionCents(grossCents: Cents, commissionBps: number): Cents {
  return applyBps(grossCents, commissionBps);
}

export interface ProfitBooking {
  checkIn: IsoDate;
  checkOut: IsoDate;
  grossCents: Cents;
  commissionCents: Cents;
  source: string;
}

/** Nights of [checkIn, checkOut) that fall inside a month. */
export function nightsInPeriod(period: Period, checkIn: IsoDate, checkOut: IsoDate): number {
  const start = checkIn > monthStart(period) ? checkIn : monthStart(period);
  const endExclusive =
    checkOut < addDays(monthEnd(period), 1) ? checkOut : addDays(monthEnd(period), 1);
  return Math.max(0, diffDays(start, endExclusive));
}

/** The part of a booking's money that belongs to a month, split by nights without losing a cent. */
export function bookingShare(b: ProfitBooking, period: Period) {
  const total = nights(b.checkIn, b.checkOut);
  const inside = nightsInPeriod(period, b.checkIn, b.checkOut);
  if (inside === 0 || total <= 0) return { nights: 0, grossCents: 0n, commissionCents: 0n };
  if (inside === total)
    return { nights: inside, grossCents: b.grossCents, commissionCents: b.commissionCents };
  const split = (amount: Cents) => allocate(amount, [inside, total - inside])[0]!;
  return {
    nights: inside,
    grossCents: split(b.grossCents),
    commissionCents: split(b.commissionCents),
  };
}

export interface MonthlyProfit {
  period: Period;
  nightsSold: number;
  availableNights: number;
  occupancyBps: number;
  grossCents: Cents;
  commissionCents: Cents;
  expensesCents: Cents;
  netCents: Cents;
  /** Average daily rate: gross / nights sold. */
  adrCents: Cents;
  /** Revenue per available night: gross / available nights. */
  revparCents: Cents;
}

/**
 * One unit's month: gross − commission − expenses. Available nights exclude owner/maintenance
 * blocks so occupancy is measured against nights actually for sale.
 */
export function monthlyProfit(
  period: Period,
  bookings: ProfitBooking[],
  expensesCents: Cents,
  blockedNights = 0,
): MonthlyProfit {
  const shares = bookings.map((b) => bookingShare(b, period));
  const nightsSold = shares.reduce((s, x) => s + x.nights, 0);
  const grossCents = sum(shares.map((s) => s.grossCents));
  const commission = sum(shares.map((s) => s.commissionCents));
  const availableNights = Math.max(0, daysInMonth(period) - blockedNights);
  return {
    period,
    nightsSold,
    availableNights,
    occupancyBps: availableNights
      ? Number(divRound(BigInt(nightsSold) * 10_000n, BigInt(availableNights)))
      : 0,
    grossCents,
    commissionCents: commission,
    expensesCents,
    netCents: grossCents - commission - expensesCents,
    adrCents: nightsSold ? divRound(grossCents, BigInt(nightsSold)) : 0n,
    revparCents: availableNights ? divRound(grossCents, BigInt(availableNights)) : 0n,
  };
}

/** What each channel really earns: gross, commission, net and effective commission rate. */
export function channelComparison(bookings: ProfitBooking[]) {
  const by = new Map<
    string,
    { bookings: number; nights: number; grossCents: Cents; commissionCents: Cents }
  >();
  for (const b of bookings) {
    const row = by.get(b.source) ?? { bookings: 0, nights: 0, grossCents: 0n, commissionCents: 0n };
    row.bookings++;
    row.nights += nights(b.checkIn, b.checkOut);
    row.grossCents += b.grossCents;
    row.commissionCents += b.commissionCents;
    by.set(b.source, row);
  }
  return [...by].map(([source, r]) => ({
    source,
    ...r,
    netCents: r.grossCents - r.commissionCents,
    effectiveCommissionBps: r.grossCents
      ? Number(divRound(r.commissionCents * 10_000n, r.grossCents))
      : 0,
  }));
}

export { periodOf };
