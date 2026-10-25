/**
 * Kenya Monthly Rental Income tax (MRI): 7.5% of gross residential rent received, filed monthly
 * by the 20th of the following month, for landlords whose annual residential rent is between
 * KES 288,000 and KES 15,000,000. Pure functions; the compliance module feeds them.
 */
import { divRound, type Cents } from './money';
import { addPeriods, compareDates, type IsoDate, type Period } from './time';

export const MRI_RATE_BPS = 750;
/** Annual residential rent band (cents) inside which MRI applies. */
export const MRI_BAND = { minCents: 28_800_000n, maxCents: 1_500_000_000n } as const;
export const MRI_DUE_DAY = 20;

export interface TaxInvoice {
  id: string;
  dueOn: IsoDate;
  /** Tie-breaker for equal due dates. */
  seq: string;
  /** Invoice total as issued. */
  totalCents: Cents;
  /** Sum of its rent lines (≤ total). */
  rentCents: Cents;
  /** Credit notes raised against this invoice (reduce what can be paid on it). */
  creditedCents?: Cents;
}

export interface TaxCredit {
  id: string;
  /** Business date the credit reached the lease. */
  on: IsoDate;
  seq: string;
  amountCents: Cents;
  /**
   * Money received (payments, deposit applied to arrears) counts for MRI; book credits (lease-level
   * credit notes) only reduce what is owed.
   */
  received: boolean;
}

export interface RentAttribution {
  creditId: string;
  on: IsoDate;
  amountCents: Cents;
  /** Rent portion of the credit (applied rent shares + any unapplied advance). */
  rentCents: Cents;
  /** Part of the credit not applied to any invoice yet (treated as advance rent). */
  advanceCents: Cents;
}

/**
 * Apply credits in date order to invoices oldest-due-first and attribute each received credit's
 * rent portion: for each piece applied to an invoice, `piece × rent ÷ total`; anything left over
 * is rent paid in advance. Every received cent is attributed exactly once.
 */
export function attributeRent(invoices: TaxInvoice[], credits: TaxCredit[]): RentAttribution[] {
  const open = [...invoices]
    .sort((a, b) => compareDates(a.dueOn, b.dueOn) || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0))
    .map((i) => {
      const net = i.totalCents - (i.creditedCents ?? 0n);
      return { ...i, remaining: net > 0n ? net : 0n };
    });
  const ordered = [...credits].sort(
    (a, b) => compareDates(a.on, b.on) || (a.seq < b.seq ? -1 : a.seq > b.seq ? 1 : 0),
  );
  const out: RentAttribution[] = [];
  for (const c of ordered) {
    let left = c.amountCents > 0n ? c.amountCents : 0n;
    let rent = 0n;
    for (const inv of open) {
      if (left === 0n) break;
      if (inv.remaining === 0n) continue;
      const piece = left < inv.remaining ? left : inv.remaining;
      inv.remaining -= piece;
      left -= piece;
      if (inv.totalCents > 0n) rent += divRound(piece * inv.rentCents, inv.totalCents);
    }
    if (c.received)
      out.push({
        creditId: c.id,
        on: c.on,
        amountCents: c.amountCents,
        rentCents: rent + left,
        advanceCents: left,
      });
  }
  return out;
}

/** 7.5% of the rent received, rounded half up to the cent. */
export function mriTax(rentCents: Cents): Cents {
  return rentCents > 0n ? divRound(rentCents * BigInt(MRI_RATE_BPS), 10_000n) : 0n;
}

export type MriBand = 'below_threshold' | 'eligible' | 'above_threshold';

/** Where a year's residential rent falls relative to the MRI band. */
export function mriBand(annualRentCents: Cents): MriBand {
  if (annualRentCents < MRI_BAND.minCents) return 'below_threshold';
  if (annualRentCents > MRI_BAND.maxCents) return 'above_threshold';
  return 'eligible';
}

/** MRI for `period` is due on the 20th of the following month. */
export function mriDueDate(period: Period): IsoDate {
  return `${addPeriods(period, 1)}-${String(MRI_DUE_DAY).padStart(2, '0')}`;
}
