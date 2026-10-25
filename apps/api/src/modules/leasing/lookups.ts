import { billing, money, type tax } from '@kejasha/core';
import { and, eq, inArray, ne, schema, sql, type Tx } from '@kejasha/db';
import * as ledger from '../ledger';
import { outstandingByLease } from './invoicing';

/** Read helpers the payments module uses for matching (ADR-001: no direct table access). */
const {
  lease: ls,
  tenant: tn,
  invoice: inv,
  creditNote: cn,
  depositSettlement: ds,
  leaseRentStep: rs,
} = schema;

export interface LeaseForMatching {
  leaseId: string;
  unitId: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string | null;
  balanceCents: bigint;
  /** Outstanding amounts of open invoices (for "amount equals an invoice" suggestions). */
  openAmounts: bigint[];
}

/** The lease occupying a unit on a date (non-cancelled), if any. */
export async function leaseOnUnitAt(tx: Tx, unitId: string, date: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: ls.id })
    .from(ls)
    .where(
      and(
        eq(ls.unitId, unitId),
        ne(ls.status, 'cancelled'),
        sql`${ls.startDate} <= ${date}::date AND (${ls.endDate} IS NULL OR ${ls.endDate} >= ${date}::date)`,
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Non-cancelled leases whose tenant has this phone (E.164). */
export async function leaseIdsByTenantPhone(tx: Tx, phone: string): Promise<string[]> {
  const rows = await tx
    .select({ id: ls.id })
    .from(ls)
    .innerJoin(tn, eq(tn.id, ls.tenantId))
    .where(and(eq(tn.phone, phone), eq(ls.status, 'active')));
  return rows.map((r) => r.id);
}

/** Candidate leases for suggestions: all active leases (small orgs) — enriched for ranking. */
export async function leasesForMatching(tx: Tx, leaseIds?: string[]): Promise<LeaseForMatching[]> {
  const rows = await tx
    .select({
      leaseId: ls.id,
      unitId: ls.unitId,
      status: ls.status,
      tenantId: tn.id,
      tenantName: tn.fullName,
      tenantPhone: tn.phone,
    })
    .from(ls)
    .innerJoin(tn, eq(tn.id, ls.tenantId))
    .where(
      leaseIds
        ? inArray(ls.id, leaseIds.length ? leaseIds : ['00000000-0000-0000-0000-000000000000'])
        : eq(ls.status, 'active'),
    );
  const ids = rows.map((r) => r.leaseId);
  const [outstanding, balances] = await Promise.all([
    outstandingByLease(tx, ids),
    ledger.leaseBalances(tx, ids),
  ]);
  return rows.map((r) => ({
    ...r,
    balanceCents: balances.get(r.leaseId)?.receivable ?? 0n,
    openAmounts: (outstanding.get(r.leaseId)?.items ?? [])
      .map((i) => i.outstandingCents)
      .filter((v) => v > 0n),
  }));
}

export function sumOpen(l: LeaseForMatching): bigint {
  return money.sum(l.openAmounts);
}

/** Tenant names (and phones) by id, for other modules' displays and validation. */
export async function tenantsById(
  tx: Tx,
  ids: string[],
): Promise<Map<string, { id: string; fullName: string; phone: string | null }>> {
  if (!ids.length) return new Map();
  const rows = await tx
    .select({ id: tn.id, fullName: tn.fullName, phone: tn.phone })
    .from(tn)
    .where(inArray(tn.id, [...new Set(ids)]));
  return new Map(rows.map((r) => [r.id, r]));
}

export interface LeaseTaxInputs {
  leaseId: string;
  unitId: string;
  status: 'active' | 'terminated' | 'cancelled';
  tenantId: string;
  tenantName: string;
  tenantKraPin: string | null;
  /** Live invoices with their rent lines and credit notes against them. */
  invoices: tax.TaxInvoice[];
  /** Book credits (lease-level credit notes) and deposit applied to arrears (money received). */
  credits: tax.TaxCredit[];
}

/**
 * Everything MRI needs from leasing for the org's non-cancelled leases (payments come from the
 * payments module). Read-only, inside the caller's tenant transaction.
 */
export async function leaseTaxInputs(tx: Tx): Promise<LeaseTaxInputs[]> {
  const leases = await tx
    .select({
      leaseId: ls.id,
      unitId: ls.unitId,
      status: ls.status,
      tenantId: tn.id,
      tenantName: tn.fullName,
      tenantKraPin: tn.kraPin,
    })
    .from(ls)
    .innerJoin(tn, eq(tn.id, ls.tenantId))
    .where(ne(ls.status, 'cancelled'));
  if (!leases.length) return [];
  const ids = leases.map((l) => l.leaseId);
  const invoices = await tx
    .select({
      id: inv.id,
      leaseId: inv.leaseId,
      dueOn: inv.dueOn,
      number: inv.number,
      totalCents: inv.totalCents,
      rentCents: sql<string>`coalesce((SELECT sum(l.amount_cents) FROM invoice_line l WHERE l.invoice_id = invoice.id AND l.kind = 'rent'), 0)`,
      creditedCents: sql<string>`coalesce((SELECT sum(c.amount_cents) FROM credit_note c WHERE c.invoice_id = invoice.id), 0)`,
    })
    .from(inv)
    .where(and(inArray(inv.leaseId, ids), eq(inv.status, 'issued')));
  const notes = await tx
    .select()
    .from(cn)
    .where(and(inArray(cn.leaseId, ids), sql`${cn.invoiceId} IS NULL`));
  const settlements = await tx.select().from(ds).where(inArray(ds.leaseId, ids));
  return leases.map((l) => ({
    ...l,
    invoices: invoices
      .filter((i) => i.leaseId === l.leaseId)
      .map((i) => ({
        id: i.id,
        dueOn: i.dueOn,
        seq: i.number,
        totalCents: i.totalCents,
        rentCents: BigInt(i.rentCents),
        creditedCents: BigInt(i.creditedCents),
      })),
    credits: [
      ...notes
        .filter((n) => n.leaseId === l.leaseId)
        .map((n) => ({
          id: n.id,
          on: n.issuedOn,
          seq: n.number,
          amountCents: n.amountCents,
          received: false,
        })),
      ...settlements
        .filter((d) => d.leaseId === l.leaseId && d.appliedToArrearsCents > 0n)
        .map((d) => ({
          id: d.id,
          on: d.settledOn,
          seq: `DS-${d.id}`,
          amountCents: d.appliedToArrearsCents,
          received: true,
        })),
    ],
  }));
}

export interface RentRollLease {
  leaseId: string;
  unitId: string;
  tenantId: string;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  currentRentCents: bigint;
  balanceCents: bigint;
}

/** The lease occupying each unit on `date` with its current rent and balance (rent roll). */
export async function rentRollLeases(
  tx: Tx,
  unitIds: string[],
  date: string,
): Promise<RentRollLease[]> {
  if (!unitIds.length) return [];
  const rows = await tx
    .select({ l: ls, tenantName: tn.fullName })
    .from(ls)
    .innerJoin(tn, eq(tn.id, ls.tenantId))
    .where(
      and(
        inArray(ls.unitId, unitIds),
        ne(ls.status, 'cancelled'),
        sql`${ls.startDate} <= ${date}::date AND (${ls.endDate} IS NULL OR ${ls.endDate} >= ${date}::date)`,
      ),
    );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.l.id);
  const steps = await tx.select().from(rs).where(inArray(rs.leaseId, ids));
  const balances = await ledger.leaseBalances(tx, ids);
  return rows.map(({ l, tenantName }) => {
    const schedule: billing.RentSchedule = {
      startDate: l.startDate,
      rentCents: l.rentCents,
      escalationBps: l.escalationBps,
      escalationEveryMonths: l.escalationEveryMonths,
      steps: steps
        .filter((x) => x.leaseId === l.id)
        .map((x) => ({ effectivePeriod: x.effectivePeriod.slice(0, 7), rentCents: x.rentCents })),
    };
    return {
      leaseId: l.id,
      unitId: l.unitId,
      tenantId: l.tenantId,
      tenantName,
      startDate: l.startDate,
      endDate: l.endDate,
      currentRentCents: billing.rentForPeriod(schedule, date.slice(0, 7)),
      balanceCents: balances.get(l.id)?.receivable ?? 0n,
    };
  });
}
