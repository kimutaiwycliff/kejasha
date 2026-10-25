import type { ExportDataset } from '@kejasha/contracts';
import { time } from '@kejasha/core';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { kes, toCsv, type Cell } from '../../lib/csv';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import { createLeasing } from '../leasing';
import { createMaintenanceService } from '../maintenance';
import { createPayments } from '../payments';
import * as shortstay from '../shortstay';
import type { Reporting } from './service';

type Dataset = z.infer<typeof ExportDataset>;
/** Datasets a read-only owner may export (always limited to their landlord). */
export const VIEWER_DATASETS: readonly Dataset[] = ['rent-roll', 'collections', 'unit-expenses'];
const c = (v: number | null | undefined) => (v === null || v === undefined ? '' : kes(BigInt(v)));
const MAX_ROWS = 50_000;

/** Drain a cursor-paginated list (exports only; capped). */
async function drain<T>(
  fetch: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetch(cursor);
    out.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor && out.length < MAX_ROWS);
  return out;
}

/** `GET /v1/exports/{dataset}`: CSV for every main list (formula-safe cells, KES decimals). */
export function createExports(deps: AppDeps, reporting: Reporting) {
  const { db, clock } = deps;
  const leasing = createLeasing(deps);
  const payments = createPayments(deps);
  const ss = shortstay.createShortStay(deps);
  // Listing tickets needs no member lookups.
  const tickets = createMaintenanceService(deps, { memberRoles: async () => new Map() });

  return async function exportCsv(
    ctx: Ctx,
    dataset: Dataset,
    q: {
      from?: string | undefined;
      to?: string | undefined;
      clientLandlordId?: string | undefined;
    },
  ): Promise<{ filename: string; body: string }> {
    if (ctx.role === 'viewer' && !VIEWER_DATASETS.includes(dataset))
      throw new AppError(
        403,
        'viewer_read_only',
        'Forbidden',
        'This export is not available to read-only members.',
      );
    const today = clock.today();
    const from = q.from ?? time.monthStart(time.periodOf(today));
    const to = q.to ?? today;
    if (to < from || time.diffDays(from, to) > 366)
      throw AppError.unprocessable('invalid_range', 'Use a range of up to one year.');
    const file = (name: string, header: string[], rows: Cell[][]) => ({
      filename: `${name}-${from}-${to}.csv`,
      body: toCsv(header, rows),
    });

    switch (dataset) {
      case 'rent-roll': {
        const r = await reporting.rentRoll(ctx, { clientLandlordId: q.clientLandlordId });
        return {
          filename: `rent-roll-${r.asOf}.csv`,
          body: toCsv(
            [
              'Property',
              'Unit',
              'Status',
              'Tenant',
              'Rent (KES)',
              'Lease start',
              'Lease end',
              'Balance (KES)',
            ],
            r.items.map((i) => [
              i.propertyName,
              i.unitCode,
              i.status,
              i.tenantName,
              c(i.rentCents),
              i.leaseStart,
              i.leaseEnd,
              c(i.balanceCents),
            ]),
          ),
        };
      }
      case 'collections': {
        const rows = await inTenant(db, ctx, async (tx) => {
          const scope = await reporting.scopeOf(tx, ctx, q.clientLandlordId);
          const entries = await reporting.entries(
            tx,
            from,
            to,
            scope.landlords.map((l) => l.id),
          );
          const units = await accounts.unitsById(
            tx,
            entries.map((e) => e.unitId),
          );
          return entries
            .sort((a, b) =>
              a.occurredOn < b.occurredOn ? -1 : a.occurredOn > b.occurredOn ? 1 : 0,
            )
            .map((e) => [
              e.occurredOn,
              units.get(e.unitId)?.propertyName,
              units.get(e.unitId)?.code,
              e.leaseId ? 'lease' : 'booking',
              e.source === 'payment' ? 'received' : 'reversed',
              kes(e.amountCents),
            ]);
        });
        return file(
          'collections',
          ['Date', 'Property', 'Unit', 'For', 'Entry', 'Amount (KES)'],
          rows,
        );
      }
      case 'unit-expenses': {
        const rows = await inTenant(db, ctx, async (tx) => {
          const scope = await reporting.scopeOf(tx, ctx, q.clientLandlordId);
          const list = await shortstay.expensesIn(
            tx,
            scope.properties.map((p) => p.id),
            from,
            to,
          );
          const units = await accounts.unitsById(
            tx,
            list.map((e) => e.unitId).filter((x): x is string => Boolean(x)),
          );
          const props = await accounts.propertiesById(
            tx,
            list.map((e) => e.propertyId),
          );
          return list.map((e) => [
            e.incurredOn,
            props.get(e.propertyId)?.name,
            e.unitId ? units.get(e.unitId)?.code : '',
            e.category,
            e.description,
            kes(e.amountCents),
          ]);
        });
        return file(
          'unit-expenses',
          ['Date', 'Property', 'Unit', 'Category', 'Description', 'Amount (KES)'],
          rows,
        );
      }
      case 'payments': {
        const all = await drain((cursor) => payments.payments.list(ctx, { limit: 100, cursor }));
        const rows = all
          .filter((p) => {
            const d = time.nairobiDate(new Date(p.paidAt));
            return d >= from && d <= to;
          })
          .map((p) => [
            time.nairobiDate(new Date(p.paidAt)),
            p.providerRef,
            p.source,
            p.method,
            p.payerName,
            p.msisdn,
            p.accountRef,
            p.matchStatus,
            p.unitCode,
            p.tenantName,
            p.receiptNumber,
            c(p.amountCents),
          ]);
        return file(
          'payments',
          [
            'Date',
            'Reference',
            'Source',
            'Method',
            'Payer',
            'Phone',
            'Account',
            'Status',
            'Unit',
            'Tenant/guest',
            'Receipt',
            'Amount (KES)',
          ],
          rows,
        );
      }
      case 'bookings': {
        const all = await drain((cursor) =>
          ss.service.listBookings(ctx, { limit: 100, cursor, from, to }),
        );
        return file(
          'bookings',
          [
            'Check-in',
            'Check-out',
            'Nights',
            'Unit',
            'Property',
            'Guest',
            'Source',
            'Status',
            'Gross (KES)',
            'Commission (KES)',
            'Net (KES)',
            'Paid (KES)',
            'Balance (KES)',
          ],
          all.map((b) => [
            b.checkIn,
            b.checkOut,
            b.nights,
            b.unitCode,
            b.propertyName,
            b.guestName,
            b.source,
            b.status,
            c(b.grossCents),
            c(b.commissionCents),
            c(b.netCents),
            c(b.paidCents),
            c(b.balanceCents),
          ]),
        );
      }
      case 'tickets': {
        const all = await drain((cursor) => tickets.list(ctx, { limit: 100, cursor }));
        return file(
          'tickets',
          [
            'Number',
            'Opened',
            'Property',
            'Unit',
            'Title',
            'Category',
            'Priority',
            'Status',
            'Cost (KES)',
            'Resolved',
          ],
          all
            .filter((t) => {
              const d = time.nairobiDate(new Date(t.createdAt));
              return d >= from && d <= to;
            })
            .map((t) => [
              t.number,
              time.nairobiDate(new Date(t.createdAt)),
              t.propertyName,
              t.unitCode,
              t.title,
              t.category,
              t.priority,
              t.status,
              c(t.costCents),
              t.resolvedAt ? time.nairobiDate(new Date(t.resolvedAt)) : '',
            ]),
        );
      }
      case 'tenants': {
        const all = await drain((cursor) =>
          leasing.service.listTenants(ctx, { limit: 100, cursor } as Parameters<
            typeof leasing.service.listTenants
          >[1]),
        );
        return {
          filename: `tenants-${today}.csv`,
          body: toCsv(
            ['Name', 'Phone', 'Email', 'National ID', 'KRA PIN', 'Active leases', 'Balance (KES)'],
            all.map((t) => [
              t.fullName,
              t.phone,
              t.email,
              t.nationalId,
              t.kraPin,
              t.activeLeaseCount,
              c(t.balanceCents),
            ]),
          ),
        };
      }
      case 'arrears': {
        const r = await leasing.views.arrears(ctx, {});
        return {
          filename: `arrears-${r.asOf}.csv`,
          body: toCsv(
            [
              'Tenant',
              'Phone',
              'Unit',
              'Property',
              'Oldest due',
              'Current',
              '1–30 days',
              '31–60 days',
              '61–90 days',
              '90+ days',
              'Total (KES)',
            ],
            r.items.map((i) => [
              i.tenantName,
              i.tenantPhone,
              i.unitCode,
              i.propertyName,
              i.oldestDueOn,
              c(i.aging.current),
              c(i.aging.d1_30),
              c(i.aging.d31_60),
              c(i.aging.d61_90),
              c(i.aging.d90_plus),
              c(i.aging.total),
            ]),
          ),
        };
      }
    }
  };
}

export type ExportCsv = ReturnType<typeof createExports>;
