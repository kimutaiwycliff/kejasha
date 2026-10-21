import type {
  ArrearsReport,
  Invoice,
  InvoiceDetail,
  InvoiceQuery,
  LeaseStatement,
} from '@kejasha/contracts';
import { billing, money } from '@kejasha/core';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { inTenant, type Ctx } from '../../lib/ctx';
import { decodeCursor, page } from '../../lib/pagination';
import * as accounts from '../accounts';
import * as ledger from '../ledger';
import { dateToPeriod, outstandingByLease, periodToDate, type InvoiceRow } from './invoicing';

const { lease: ls, tenant: tn, invoice: inv, invoiceLine: line, creditNote: cn } = schema;
type InvoiceDto = z.infer<typeof Invoice>;
const toApi = (v: bigint) => money.toApiInt(v);
const agingDto = (a: ReturnType<typeof billing.aging>) =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, toApi(v)])) as z.infer<
    typeof ArrearsReport
  >['totals'];

/** Read models derived from invoices + ledger (nothing here is stored). */
export function createLeasingViews(deps: AppDeps) {
  const { db, clock } = deps;

  async function toInvoices(tx: Tx, rows: InvoiceRow[]): Promise<InvoiceDto[]> {
    if (!rows.length) return [];
    const leaseIds = [...new Set(rows.map((r) => r.leaseId))];
    const leases = await tx
      .select({ id: ls.id, unitId: ls.unitId, tenantId: ls.tenantId })
      .from(ls)
      .where(inArray(ls.id, leaseIds));
    const [units, tenants, outstanding] = await Promise.all([
      accounts.unitsById(
        tx,
        leases.map((l) => l.unitId),
      ),
      tx
        .select({ id: tn.id, name: tn.fullName })
        .from(tn)
        .where(
          inArray(
            tn.id,
            leases.map((l) => l.tenantId),
          ),
        ),
      outstandingByLease(tx, leaseIds),
    ]);
    const leaseById = new Map(leases.map((l) => [l.id, l]));
    const tenantName = new Map(tenants.map((t) => [t.id, t.name]));
    const owed = new Map(
      [...outstanding.values()].flatMap((o) =>
        o.items.map((i) => [i.invoice.id, i.outstandingCents] as const),
      ),
    );
    return rows.map((r) => {
      const l = leaseById.get(r.leaseId)!;
      const out = r.status === 'void' ? 0n : (owed.get(r.id) ?? 0n);
      const paymentStatus =
        r.status === 'void'
          ? 'void'
          : out === 0n
            ? 'paid'
            : out === r.totalCents
              ? 'unpaid'
              : 'partially_paid';
      return {
        id: r.id,
        number: r.number,
        leaseId: r.leaseId,
        tenantName: tenantName.get(l.tenantId) ?? '',
        unitCode: units.get(l.unitId)?.code ?? '',
        kind: r.kind,
        period: dateToPeriod(r.period),
        issuedOn: r.issuedOn,
        dueOn: r.dueOn,
        totalCents: toApi(r.totalCents),
        outstandingCents: toApi(out),
        paymentStatus,
        voidedAt: r.voidedAt?.toISOString() ?? null,
        voidReason: r.voidReason,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  return {
    toInvoices,

    async listInvoices(ctx: Ctx, q: z.infer<typeof InvoiceQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const tenantLeases = q.tenantId
          ? (await tx.select({ id: ls.id }).from(ls).where(eq(ls.tenantId, q.tenantId))).map(
              (l) => l.id,
            )
          : undefined;
        if (tenantLeases && !tenantLeases.length) return { items: [], nextCursor: null };
        const rows = await tx
          .select()
          .from(inv)
          .where(
            and(
              q.includeVoid ? undefined : eq(inv.status, 'issued'),
              q.leaseId ? eq(inv.leaseId, q.leaseId) : undefined,
              tenantLeases ? inArray(inv.leaseId, tenantLeases) : undefined,
              q.kind ? eq(inv.kind, q.kind) : undefined,
              q.period ? eq(inv.period, periodToDate(q.period)) : undefined,
              after
                ? sql`(${inv.issuedOn}, ${inv.number}) < (${after[0]}::date, ${after[1]})`
                : undefined,
            ),
          )
          .orderBy(desc(inv.issuedOn), desc(inv.number))
          .limit(q.limit + 1);
        return page(await toInvoices(tx, rows), q.limit, (i) => [i.issuedOn, i.number]);
      });
    },

    async getInvoice(ctx: Ctx, id: string): Promise<z.infer<typeof InvoiceDetail>> {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(inv).where(eq(inv.id, id));
        if (!row) throw AppError.notFound('Invoice');
        const [dto] = await toInvoices(tx, [row]);
        const lines = await tx.select().from(line).where(eq(line.invoiceId, id));
        return {
          ...dto!,
          lines: lines.map((l) => ({
            id: l.id,
            kind: l.kind,
            description: l.description,
            quantity: billing.fromMilli(billing.toMilli(l.quantity)),
            unitPriceCents: l.unitPriceCents === null ? null : toApi(l.unitPriceCents),
            amountCents: toApi(l.amountCents),
            periodStart: l.periodStart,
            periodEnd: l.periodEnd,
          })),
        };
      });
    },

    /** Receivable activity with a running balance — what the tenant owes over time. */
    async statement(
      ctx: Ctx,
      leaseId: string,
      range: { from?: string | undefined; to?: string | undefined },
    ): Promise<z.infer<typeof LeaseStatement>> {
      return inTenant(db, ctx, async (tx) => {
        const [lease] = await tx.select().from(ls).where(eq(ls.id, leaseId));
        if (!lease) throw AppError.notFound('Lease');
        const from = range.from ?? lease.startDate;
        const to = range.to ?? clock.today();
        if (to < from) throw AppError.unprocessable('invalid_range', '`to` is before `from`.');
        const accountsOf = await ledger.leaseAccounts(tx, ctx, leaseId);
        const { openingBalance, rows } = await ledger.accountActivity(
          tx,
          accountsOf.receivable,
          from,
          to,
        );
        const sourceIds = rows.map((r) => r.sourceId).filter((x): x is string => Boolean(x));
        const refs = new Map<string, string>();
        if (sourceIds.length) {
          for (const r of await tx
            .select({ id: inv.id, n: inv.number })
            .from(inv)
            .where(inArray(inv.id, sourceIds)))
            refs.set(r.id, r.n);
          for (const r of await tx
            .select({ id: cn.id, n: cn.number })
            .from(cn)
            .where(inArray(cn.id, sourceIds)))
            refs.set(r.id, r.n);
        }
        let running = openingBalance;
        const items = rows.map((r) => {
          running += r.amountCents;
          return {
            date: r.occurredOn,
            source: r.source,
            reference: r.sourceId ? (refs.get(r.sourceId) ?? null) : null,
            description: r.memo ?? r.source,
            debitCents: toApi(r.amountCents > 0n ? r.amountCents : 0n),
            creditCents: toApi(r.amountCents < 0n ? -r.amountCents : 0n),
            balanceCents: toApi(running),
          };
        });
        return {
          leaseId,
          from,
          to,
          openingBalanceCents: toApi(openingBalance),
          closingBalanceCents: toApi(running),
          items,
        };
      });
    },

    async arrears(
      ctx: Ctx,
      opts: { propertyId?: string | undefined },
    ): Promise<z.infer<typeof ArrearsReport>> {
      const asOf = clock.today();
      return inTenant(db, ctx, async (tx) => {
        const unitFilter = opts.propertyId
          ? await accounts.unitIdsInProperty(tx, opts.propertyId)
          : undefined;
        const leases = await tx
          .select()
          .from(ls)
          .where(
            and(
              sql`${ls.status} <> 'cancelled'`,
              unitFilter
                ? inArray(
                    ls.unitId,
                    unitFilter.length ? unitFilter : ['00000000-0000-0000-0000-000000000000'],
                  )
                : undefined,
            ),
          );
        const outstanding = await outstandingByLease(
          tx,
          leases.map((l) => l.id),
        );
        const [units, tenants] = await Promise.all([
          accounts.unitsById(
            tx,
            leases.map((l) => l.unitId),
          ),
          tx
            .select()
            .from(tn)
            .where(
              inArray(
                tn.id,
                leases.length
                  ? leases.map((l) => l.tenantId)
                  : ['00000000-0000-0000-0000-000000000000'],
              ),
            ),
        ]);
        const tenantById = new Map(tenants.map((t) => [t.id, t]));
        const items = [];
        const totals = billing.aging([], asOf);
        for (const l of leases) {
          const o = outstanding.get(l.id)!;
          const open = o.items.filter((i) => i.outstandingCents > 0n);
          if (!open.length) continue;
          const a = billing.aging(
            open.map((i) => ({ dueOn: i.invoice.dueOn, outstandingCents: i.outstandingCents })),
            asOf,
          );
          for (const k of billing.AGING_BUCKETS) totals[k] += a[k];
          totals.total += a.total;
          const t = tenantById.get(l.tenantId)!;
          const u = units.get(l.unitId)!;
          items.push({
            leaseId: l.id,
            tenantId: t.id,
            tenantName: t.fullName,
            tenantPhone: t.phone,
            unitCode: u.code,
            propertyName: u.propertyName,
            oldestDueOn: open.map((i) => i.invoice.dueOn).sort()[0]!,
            aging: agingDto(a),
          });
        }
        items.sort((x, y) => y.aging.total - x.aging.total);
        return { asOf, totals: agingDto(totals), items };
      });
    },
  };
}

export type LeasingViews = ReturnType<typeof createLeasingViews>;
