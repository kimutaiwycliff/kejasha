/**
 * Kejasha's own SaaS pricing (never rent — ADR-008). Pure: prices come from the `plan` table.
 * Monthly charge = max(minimum, base + occupied units × unit price + listings × listing price).
 */
import type { Cents } from './money';
import { addDays, addMonths, type IsoDate } from './time';

export interface PlanPrices {
  baseCents: Cents;
  unitPriceCents: Cents;
  listingPriceCents: Cents;
  minimumCents: Cents;
}

export interface Usage {
  /** Long-term units with a live lease. */
  units: number;
  /** Active short-stay units. */
  listings: number;
}

export function monthlyAmount(p: PlanPrices, u: Usage): Cents {
  const raw =
    p.baseCents + BigInt(u.units) * p.unitPriceCents + BigInt(u.listings) * p.listingPriceCents;
  return raw > p.minimumCents ? raw : p.minimumCents;
}

/** A monthly period starting on `start`: [start, same day next month − 1]. */
export function periodFrom(start: IsoDate): { start: IsoDate; end: IsoDate } {
  return { start, end: addDays(addMonths(start, 1), -1) };
}

/** Grace before a past-due subscription is suspended, and the reminder days within it. */
export const GRACE_DAYS = 7;
export const RETRY_DAYS = [0, 1, 3, 7] as const;
