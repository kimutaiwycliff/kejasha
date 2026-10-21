import { billing, money, time, uuidv7, type Cents } from '@kejasha/core';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  ne,
  schema,
  sql,
  type LedgerAccountKind,
  type Tx,
} from '@kejasha/db';
import type { Ctx } from '../../lib/ctx';
import { nextNumber } from '../../lib/numbering';
import * as ledger from '../ledger';

/**
 * The billing engine: periodic invoices (prorated rent + flat + metered charges), deposits, late
 * fees, voids and credit notes. Every invoice is one balanced ledger entry:
 *   Dr lease_receivable (total)  /  Cr income_<kind> per line (deposit lines → lease_deposit).
 */
const {
  lease: ls,
  invoice: inv,
  invoiceLine: line,
  chargeRule: cr,
  leaseRentStep: step,
  meterReading: mr,
  creditNote: cn,
} = schema;

export type LeaseRow = typeof ls.$inferSelect;
export type InvoiceRow = typeof inv.$inferSelect;
export type LineKind = (typeof line.$inferInsert)['kind'];

const LINE_ACCOUNT: Record<LineKind, LedgerAccountKind> = {
  rent: 'income_rent',
  deposit: 'lease_deposit',
  service_charge: 'income_service_charge',
  garbage: 'income_garbage',
  water: 'income_water',
  electricity: 'income_electricity',
  security: 'income_security',
  late_fee: 'income_late_fee',
  other: 'income_other',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (period: string) =>
  `${MONTHS[Number(period.slice(5, 7)) - 1]} ${period.slice(0, 4)}`;
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;
export const periodToDate = (period: string) => `${period}-01`;
export const dateToPeriod = (d: string | null) => (d ? d.slice(0, 7) : null);
const maxDate = (a: string, b: string) => (a > b ? a : b);
const minDate = (a: string, b: string | null) => (b && b < a ? b : a);

export interface DraftLine {
  kind: LineKind;
  description: string;
  quantity?: string;
  unitPriceCents?: Cents | null;
  amountCents: Cents;
  chargeRuleId?: string | null;
  meterId?: string | null;
  readingFromId?: string | null;
  readingToId?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
}

/** Create an invoice + lines + its ledger entry. Returns null when nothing is billable. */
export async function issueInvoice(
  tx: Tx,
  ctx: Ctx,
  lease: LeaseRow,
  draft: {
    kind: InvoiceRow['kind'];
    period?: string;
    sourceInvoiceId?: string;
    issuedOn: string;
    dueOn: string;
    lines: DraftLine[];
  },
): Promise<InvoiceRow | null> {
  const lines = draft.lines.filter((l) => l.amountCents > 0n);
  if (!lines.length) return null;
  const total = money.sum(lines.map((l) => l.amountCents));
  const id = uuidv7();
  const number = await nextNumber(tx, ctx, 'invoice', 'INV');
  const accounts = await ledger.leaseAccounts(tx, ctx, lease.id);
  const credits = await Promise.all(
    lines.map(async (l) => ({
      accountId:
        l.kind === 'deposit'
          ? accounts.deposit
          : await ledger.accountFor(tx, ctx, LINE_ACCOUNT[l.kind]),
      amountCents: -l.amountCents,
    })),
  );
  const summary =
    draft.kind === 'periodic' && draft.period
      ? `${monthLabel(draft.period)}`
      : lines.map((l) => l.description).join(', ');
  const { entryId } = await ledger.post(tx, ctx, {
    occurredOn: draft.issuedOn,
    source: 'invoice',
    sourceId: id,
    leaseId: lease.id,
    unitId: lease.unitId,
    memo: `${number} · ${summary}`.slice(0, 300),
    idempotencyKey: `invoice:${id}`,
    lines: [{ accountId: accounts.receivable, amountCents: total }, ...credits],
  });
  const [row] = await tx
    .insert(inv)
    .values({
      id,
      orgId: ctx.orgId,
      leaseId: lease.id,
      number,
      kind: draft.kind,
      period: draft.period ? periodToDate(draft.period) : null,
      sourceInvoiceId: draft.sourceInvoiceId ?? null,
      issuedOn: draft.issuedOn,
      dueOn: draft.dueOn,
      totalCents: total,
      ledgerEntryId: entryId,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  await tx.insert(line).values(
    lines.map((l) => ({
      id: uuidv7(),
      orgId: ctx.orgId,
      invoiceId: id,
      kind: l.kind,
      description: l.description,
      quantity: l.quantity ?? '1',
      unitPriceCents: l.unitPriceCents ?? null,
      amountCents: l.amountCents,
      chargeRuleId: l.chargeRuleId ?? null,
      meterId: l.meterId ?? null,
      readingFromId: l.readingFromId ?? null,
      readingToId: l.readingToId ?? null,
      periodStart: l.periodStart ?? null,
      periodEnd: l.periodEnd ?? null,
    })),
  );
  return row!;
}

export async function rentSchedule(tx: Tx, lease: LeaseRow): Promise<billing.RentSchedule> {
  const steps = await tx.select().from(step).where(eq(step.leaseId, lease.id));
  return {
    startDate: lease.startDate,
    rentCents: lease.rentCents,
    escalationBps: lease.escalationBps,
    escalationEveryMonths: lease.escalationEveryMonths,
    steps: steps.map((s) => ({
      effectivePeriod: s.effectivePeriod.slice(0, 7),
      rentCents: s.rentCents,
    })),
  };
}

/** Lines for one billing period of a lease. */
export async function buildPeriodicLines(
  tx: Tx,
  lease: LeaseRow,
  period: string,
): Promise<DraftLine[]> {
  const total = time.daysInMonth(period);
  const pStart = time.monthStart(period);
  const pEnd = time.monthEnd(period);
  const lines: DraftLine[] = [];

  const days = billing.occupiedDays(period, lease.startDate, lease.endDate);
  if (days === 0) return lines;
  const occStart = maxDate(pStart, lease.startDate);
  const occEnd = minDate(pEnd, lease.endDate);
  const partial = days < total ? ` (${days} of ${total} days)` : '';

  const rent = billing.prorate(
    billing.rentForPeriod(await rentSchedule(tx, lease), period),
    days,
    period,
  );
  lines.push({
    kind: 'rent',
    description: `Rent ${monthLabel(period)}${partial}`,
    amountCents: rent,
    periodStart: occStart,
    periodEnd: occEnd,
  });

  const rules = await tx
    .select()
    .from(cr)
    .where(eq(cr.leaseId, lease.id))
    .orderBy(asc(cr.createdAt));
  for (const rule of rules) {
    if (rule.method === 'flat') {
      const from = maxDate(lease.startDate, rule.startsOn);
      const to =
        rule.endsOn && (!lease.endDate || rule.endsOn < lease.endDate)
          ? rule.endsOn
          : lease.endDate;
      const ruleDays = billing.occupiedDays(period, from, to);
      if (ruleDays === 0) continue;
      lines.push({
        kind: rule.kind,
        description: `${rule.label} ${monthLabel(period)}${ruleDays < total ? ` (${ruleDays} of ${total} days)` : ''}`,
        amountCents: billing.prorate(rule.amountCents!, ruleDays, period),
        chargeRuleId: rule.id,
        periodStart: maxDate(pStart, from),
        periodEnd: minDate(pEnd, to),
      });
    } else {
      const metered = await meteredLine(tx, lease, rule, period);
      if (metered) lines.push(metered);
    }
  }
  return lines;
}

/**
 * Metered charges are billed in arrears: consumption from the last billed reading (or the first
 * reading at/after move-in) up to the latest reading on or before the previous month's end — or the
 * lease end when the lease ends this month.
 */
async function meteredLine(
  tx: Tx,
  lease: LeaseRow,
  rule: typeof cr.$inferSelect,
  period: string,
): Promise<DraftLine | null> {
  const meterId = rule.meterId!;
  const endsThisPeriod = lease.endDate !== null && lease.endDate.slice(0, 7) === period;
  const cutoff = endsThisPeriod ? lease.endDate! : time.monthEnd(time.addPeriods(period, -1));

  const [lastBilled] = await tx
    .select({ id: mr.id, readOn: mr.readOn, reading: mr.reading })
    .from(line)
    .innerJoin(inv, eq(inv.id, line.invoiceId))
    .innerJoin(mr, eq(mr.id, line.readingToId))
    .where(
      and(
        eq(inv.leaseId, lease.id),
        eq(inv.status, 'issued'),
        eq(line.meterId, meterId),
        isNotNull(line.readingToId),
      ),
    )
    .orderBy(desc(mr.readOn))
    .limit(1);

  let from = lastBilled;
  if (!from) {
    const baselineFloor = maxDate(lease.startDate, rule.startsOn);
    // Latest reading on/before move-in, else the first one after it.
    [from] = await tx
      .select({ id: mr.id, readOn: mr.readOn, reading: mr.reading })
      .from(mr)
      .where(and(eq(mr.meterId, meterId), sql`${mr.readOn} <= ${baselineFloor}`))
      .orderBy(desc(mr.readOn))
      .limit(1);
    if (!from) {
      [from] = await tx
        .select({ id: mr.id, readOn: mr.readOn, reading: mr.reading })
        .from(mr)
        .where(and(eq(mr.meterId, meterId), sql`${mr.readOn} > ${baselineFloor}`))
        .orderBy(asc(mr.readOn))
        .limit(1);
    }
  }
  if (!from) return null;

  const [to] = await tx
    .select({ id: mr.id, readOn: mr.readOn, reading: mr.reading })
    .from(mr)
    .where(
      and(
        eq(mr.meterId, meterId),
        sql`${mr.readOn} <= ${cutoff}`,
        sql`${mr.readOn} > ${from.readOn}`,
      ),
    )
    .orderBy(desc(mr.readOn))
    .limit(1);
  if (!to) return null;

  const { consumptionMilli, amountCents } = billing.meteredAmount(
    billing.toMilli(from.reading),
    billing.toMilli(to.reading),
    rule.unitPriceCents!,
  );
  if (amountCents === 0n) return null;
  return {
    kind: rule.kind,
    description: `${rule.label} ${billing.fromMilli(consumptionMilli)} units (${shortDate(from.readOn)}–${shortDate(to.readOn)})`,
    quantity: billing.fromMilli(consumptionMilli),
    unitPriceCents: rule.unitPriceCents,
    amountCents,
    chargeRuleId: rule.id,
    meterId,
    readingFromId: from.id,
    readingToId: to.id,
    periodStart: from.readOn,
    periodEnd: to.readOn,
  };
}

/** Issue every periodic invoice due by `asOf` for one lease. Idempotent (row lock + unique index). */
export async function billLease(
  tx: Tx,
  ctx: Ctx,
  leaseId: string,
  asOf: string,
): Promise<InvoiceRow[]> {
  const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId)).for('update');
  if (!lease || lease.status === 'cancelled') return [];
  const due = billing.billablePeriods(
    { startDate: lease.startDate, endDate: lease.endDate, billingDay: lease.billingDay },
    asOf,
  );
  if (!due.length) return [];
  const existing = await tx
    .select({ period: inv.period })
    .from(inv)
    .where(and(eq(inv.leaseId, lease.id), eq(inv.kind, 'periodic'), eq(inv.status, 'issued')));
  const billed = new Set(existing.map((e) => e.period!.slice(0, 7)));
  const created: InvoiceRow[] = [];
  for (const period of due) {
    if (billed.has(period)) continue;
    const lines = await buildPeriodicLines(tx, lease, period);
    // Issued on the day it is actually produced; only the due date is derived from the terms.
    const { dueOn } = billing.invoiceDates(period, lease.billingDay, lease.startDate);
    const row = await issueInvoice(tx, ctx, lease, {
      kind: 'periodic',
      period,
      issuedOn: asOf,
      dueOn,
      lines,
    });
    if (row) created.push(row);
  }
  return created;
}

export interface OutstandingInvoice {
  invoice: InvoiceRow;
  outstandingCents: Cents;
}

/**
 * Derived outstanding per invoice (ADR-006): credits = Σ live invoices − receivable balance,
 * applied oldest-due-first. Returns per lease the invoices and any unapplied tenant credit.
 */
export async function outstandingByLease(tx: Tx, leaseIds: string[]) {
  const result = new Map<string, { items: OutstandingInvoice[]; credit: Cents; balance: Cents }>();
  if (!leaseIds.length) return result;
  const invoices = await tx
    .select()
    .from(inv)
    .where(and(inArray(inv.leaseId, leaseIds), eq(inv.status, 'issued')));
  const balances = await ledger.leaseBalances(tx, leaseIds);
  for (const leaseId of leaseIds) {
    const mine = invoices.filter((i) => i.leaseId === leaseId);
    const balance = balances.get(leaseId)?.receivable ?? 0n;
    const credits = money.sum(mine.map((i) => i.totalCents)) - balance;
    const { items, unappliedCredit } = billing.allocateCredits(
      mine.map((i) => ({ id: i.id, dueOn: i.dueOn, amountCents: i.totalCents, seq: i.number })),
      credits,
    );
    const byId = new Map(mine.map((i) => [i.id, i]));
    result.set(leaseId, {
      items: items.map((x) => ({ invoice: byId.get(x.id)!, outstandingCents: x.outstandingCents })),
      credit: unappliedCredit,
      balance,
    });
  }
  return result;
}

export function lateFeeRule(lease: LeaseRow): billing.LateFeeRule {
  return {
    kind: lease.lateFeeKind,
    flatCents: lease.lateFeeFlatCents,
    bps: lease.lateFeeBps,
    graceDays: lease.lateFeeGraceDays,
  };
}

/** One late fee per overdue periodic/manual invoice past grace. Idempotent per source invoice. */
export async function applyLateFees(
  tx: Tx,
  ctx: Ctx,
  lease: LeaseRow,
  asOf: string,
): Promise<number> {
  if (lease.lateFeeKind === 'none' || lease.status === 'cancelled') return 0;
  const outstanding = (await outstandingByLease(tx, [lease.id])).get(lease.id)!;
  const alreadyCharged = new Set(
    (
      await tx
        .select({ src: inv.sourceInvoiceId })
        .from(inv)
        .where(and(eq(inv.leaseId, lease.id), eq(inv.kind, 'late_fee'), eq(inv.status, 'issued')))
    ).map((r) => r.src),
  );
  let created = 0;
  for (const { invoice, outstandingCents } of outstanding.items) {
    if (invoice.kind !== 'periodic' && invoice.kind !== 'manual') continue;
    if (alreadyCharged.has(invoice.id)) continue;
    const fee = billing.lateFeeAmount(lateFeeRule(lease), invoice.dueOn, asOf, outstandingCents);
    if (fee <= 0n) continue;
    const row = await issueInvoice(tx, ctx, lease, {
      kind: 'late_fee',
      sourceInvoiceId: invoice.id,
      issuedOn: asOf,
      dueOn: asOf,
      lines: [{ kind: 'late_fee', description: `Late fee on ${invoice.number}`, amountCents: fee }],
    });
    if (row) created++;
  }
  return created;
}

/** Void an invoice with a reversing ledger entry. */
export async function voidInvoice(
  tx: Tx,
  ctx: Ctx,
  invoiceId: string,
  reason: string,
  asOf: string,
) {
  const [row] = await tx.select().from(inv).where(eq(inv.id, invoiceId)).for('update');
  if (!row) return { status: 'not_found' as const };
  if (row.status === 'void') return { status: 'already_void' as const, invoice: row };
  const { entryId } = await ledger.reverse(tx, ctx, row.ledgerEntryId, {
    occurredOn: asOf,
    source: 'invoice_void',
    memo: `Void ${row.number}: ${reason}`.slice(0, 300),
    idempotencyKey: `invoice_void:${row.id}`,
  });
  const [updated] = await tx
    .update(inv)
    .set({ status: 'void', voidEntryId: entryId, voidedAt: sql`now()`, voidReason: reason })
    .where(eq(inv.id, row.id))
    .returning();
  return { status: 'voided' as const, invoice: updated! };
}

/**
 * Credit the tenant. With an invoice, the credit reverses that invoice's income proportionally;
 * otherwise it reduces rent income.
 */
export async function issueCreditNote(
  tx: Tx,
  ctx: Ctx,
  lease: LeaseRow,
  input: { amountCents: Cents; reason: string; invoiceId?: string | undefined; issuedOn: string },
) {
  const id = uuidv7();
  const number = await nextNumber(tx, ctx, 'credit_note', 'CN');
  const accounts = await ledger.leaseAccounts(tx, ctx, lease.id);
  let debits: ledger.PostingLine[];
  if (input.invoiceId) {
    const lines = await tx.select().from(line).where(eq(line.invoiceId, input.invoiceId));
    const parts = money.allocate(
      input.amountCents,
      lines.map((l) => l.amountCents),
    );
    debits = await Promise.all(
      lines.map(async (l, i) => ({
        accountId:
          l.kind === 'deposit'
            ? accounts.deposit
            : await ledger.accountFor(tx, ctx, LINE_ACCOUNT[l.kind]),
        amountCents: parts[i]!,
      })),
    );
  } else {
    debits = [
      {
        accountId: await ledger.accountFor(tx, ctx, 'income_rent'),
        amountCents: input.amountCents,
      },
    ];
  }
  const { entryId } = await ledger.post(tx, ctx, {
    occurredOn: input.issuedOn,
    source: 'credit_note',
    sourceId: id,
    leaseId: lease.id,
    unitId: lease.unitId,
    memo: `${number} · ${input.reason}`.slice(0, 300),
    idempotencyKey: `credit_note:${id}`,
    lines: [...debits, { accountId: accounts.receivable, amountCents: -input.amountCents }],
  });
  const [row] = await tx
    .insert(cn)
    .values({
      id,
      orgId: ctx.orgId,
      leaseId: lease.id,
      invoiceId: input.invoiceId ?? null,
      number,
      amountCents: input.amountCents,
      reason: input.reason,
      issuedOn: input.issuedOn,
      ledgerEntryId: entryId,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  return row!;
}

/** Leases the daily run should look at (everything not cancelled). */
export async function billableLeaseIds(tx: Tx): Promise<string[]> {
  const rows = await tx.select({ id: ls.id }).from(ls).where(ne(ls.status, 'cancelled'));
  return rows.map((r) => r.id);
}
