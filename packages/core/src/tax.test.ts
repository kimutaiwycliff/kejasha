import { describe, expect, it } from 'vitest';
import { attributeRent, mriBand, mriDueDate, mriTax, type TaxCredit, type TaxInvoice } from './tax';

// October invoice: rent 20,000 + service charge 2,000 + water 500 = 22,500.
const oct: TaxInvoice = {
  id: 'oct',
  dueOn: '2026-10-05',
  seq: 'INV-1',
  totalCents: 2_250_000n,
  rentCents: 2_000_000n,
};
const nov: TaxInvoice = {
  id: 'nov',
  dueOn: '2026-11-05',
  seq: 'INV-2',
  totalCents: 2_250_000n,
  rentCents: 2_000_000n,
};
// Deposit invoice: no rent at all.
const dep: TaxInvoice = {
  id: 'dep',
  dueOn: '2026-10-01',
  seq: 'INV-0',
  totalCents: 4_000_000n,
  rentCents: 0n,
};
const pay = (id: string, on: string, kes: number, received = true): TaxCredit => ({
  id,
  on,
  seq: id,
  amountCents: BigInt(kes * 100),
  received,
});

describe('attributeRent (hand-calculated)', () => {
  it('pays the deposit first (oldest due), then splits the rest pro-rata by invoice lines', () => {
    // 40,000 deposit + 22,500 October = 62,500 paid on move-in.
    const [a] = attributeRent([dep, oct], [pay('p1', '2026-10-01', 62_500)]);
    expect(a).toMatchObject({ rentCents: 2_000_000n, advanceCents: 0n });
  });

  it('a part payment carries the invoice rent share; a later payment the rest', () => {
    // 11,250 = half of October → half of 20,000 rent = 10,000.
    const r = attributeRent(
      [oct],
      [pay('p1', '2026-10-06', 11_250), pay('p2', '2026-10-20', 11_250)],
    );
    expect(r.map((x) => x.rentCents)).toEqual([1_000_000n, 1_000_000n]);
  });

  it('overpayment beyond all invoices is advance rent, counted when received', () => {
    const [a] = attributeRent([oct], [pay('p1', '2026-10-05', 30_000)]);
    // 20,000 rent share of the 22,500 + 7,500 advance.
    expect(a).toMatchObject({ rentCents: 2_750_000n, advanceCents: 750_000n });
  });

  it('a later invoice absorbs an earlier advance: rent counted once, in the month received', () => {
    const r = attributeRent(
      [oct, nov],
      [pay('p1', '2026-10-05', 45_000), pay('p2', '2026-11-05', 22_500)],
    );
    expect(r[0]).toMatchObject({ rentCents: 4_000_000n, advanceCents: 0n }); // covers Oct + Nov
    expect(r[1]).toMatchObject({ rentCents: 2_250_000n, advanceCents: 2_250_000n }); // nothing left to pay
  });

  it('credit notes reduce what is owed but are never income', () => {
    const credited = { ...oct, creditedCents: 250_000n }; // 2,500 off → 20,000 owed
    const r = attributeRent(
      [credited],
      [pay('cn', '2026-10-02', 0, false), pay('p1', '2026-10-05', 20_000)],
    );
    expect(r).toHaveLength(1);
    // 20,000 applied × 20,000 / 22,500 = 17,777.78 rent; nothing left as advance.
    expect(r[0]).toMatchObject({ rentCents: 1_777_778n, advanceCents: 0n });
    // A lease-level credit note (no invoice) uses up debt first without counting.
    const r2 = attributeRent(
      [oct],
      [pay('cn', '2026-10-02', 2_500, false), pay('p1', '2026-10-05', 22_500)],
    );
    expect(r2[0]).toMatchObject({ rentCents: 2_027_778n, advanceCents: 250_000n }); // + 2,500 overpaid
  });
});

describe('MRI', () => {
  it('7.5% rounded to the cent; band; due date', () => {
    expect(mriTax(2_000_000n)).toBe(150_000n); // 20,000 → 1,500
    expect(mriTax(1_777_778n)).toBe(133_333n); // 17,777.78 → 1,333.33
    expect(mriTax(0n)).toBe(0n);
    expect(mriBand(28_799_999n)).toBe('below_threshold');
    expect(mriBand(28_800_000n)).toBe('eligible');
    expect(mriBand(1_500_000_000n)).toBe('eligible');
    expect(mriBand(1_500_000_001n)).toBe('above_threshold');
    expect(mriDueDate('2026-10')).toBe('2026-11-20');
    expect(mriDueDate('2026-12')).toBe('2027-01-20');
  });
});
