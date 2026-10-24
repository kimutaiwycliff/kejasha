import { money } from '@kejasha/core';
import { and, eq, inArray, ne, schema, sql, type Tx } from '@kejasha/db';
import * as ledger from '../ledger';
import { outstandingByLease } from './invoicing';

/** Read helpers the payments module uses for matching (ADR-001: no direct table access). */
const { lease: ls, tenant: tn } = schema;

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
