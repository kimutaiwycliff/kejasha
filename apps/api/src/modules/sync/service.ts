import type { SyncPullResponse, SyncPushBody, SyncPushResult } from '@kejasha/contracts';
import { money } from '@kejasha/core';
import { PG, pgError, sql, type Tx } from '@kejasha/db';
import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';
import { createLeasing } from '../leasing';
import { createMaintenanceService, type MaintenanceDeps } from '../maintenance';
import { createPayments } from '../payments';

type Row = Record<string, unknown> & {
  id: string;
  archived: boolean;
  us: string;
  updated_at: unknown;
};

/** Raw rows may carry timestamps as Date or text depending on the driver's type parsers. */
const iso = (v: unknown) => new Date(v as string | Date).toISOString();
/** Dates may arrive as Date (midnight UTC) or 'YYYY-MM-DD'. */
const day = (v: unknown) =>
  v instanceof Date ? v.toISOString().slice(0, 10) : (v as string | null);
type Pull = z.infer<typeof SyncPullResponse>;
type TableKey = keyof Pull['changes'];

/** Rows a device stores, from the sync module's own views (RLS applies: security_invoker). */
const TABLES: {
  key: TableKey;
  view: string;
  staffOnly?: boolean;
  /** How a caretaker is scoped: by property, or to their own records. */
  caretaker: 'property' | 'own';
  map(r: Row): Record<string, unknown>;
}[] = [
  {
    key: 'properties',
    view: 'sync_property',
    caretaker: 'property',
    map: (r) => ({ id: r.id, name: r.name, kind: r.kind, county: r.county, area: r.area }),
  },
  {
    key: 'units',
    view: 'sync_unit',
    caretaker: 'property',
    map: (r) => ({
      id: r.id,
      propertyId: r.property_id,
      code: r.code,
      label: r.label,
      mode: r.mode,
      status: r.status,
      bedrooms: r.bedrooms,
    }),
  },
  {
    key: 'meters',
    view: 'sync_meter',
    caretaker: 'property',
    map: (r) => ({
      id: r.id,
      unitId: r.unit_id,
      kind: r.kind,
      serial: r.serial,
      unitLabel: r.unit_label,
    }),
  },
  {
    key: 'meterReadings',
    view: 'sync_meter_reading',
    caretaker: 'property',
    map: (r) => ({
      id: r.id,
      meterId: r.meter_id,
      readOn: day(r.read_on),
      reading: String(r.reading),
      note: r.note,
      recordedBy: r.recorded_by,
    }),
  },
  {
    key: 'tickets',
    view: 'sync_ticket',
    caretaker: 'property',
    map: (r) => ({
      id: r.id,
      number: r.number,
      propertyId: r.property_id,
      unitId: r.unit_id,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      reporterKind: r.reporter_kind,
      costCents: r.cost_cents === null ? null : money.toApiInt(BigInt(r.cost_cents as string)),
      createdAt: iso(r.created_at),
    }),
  },
  {
    key: 'ticketUpdates',
    view: 'sync_ticket_update',
    caretaker: 'property',
    map: (r) => ({
      id: r.id,
      ticketId: r.ticket_id,
      authorId: r.author_id,
      note: r.note,
      statusFrom: r.status_from,
      statusTo: r.status_to,
      photoKeys: r.photo_keys,
      createdAt: iso(r.created_at),
    }),
  },
  {
    key: 'cashCollections',
    view: 'sync_cash_collection',
    caretaker: 'own',
    map: (r) => ({
      id: r.id,
      leaseId: r.lease_id,
      bookingId: r.booking_id,
      amountCents: money.toApiInt(BigInt(r.amount_cents as string)),
      receivedOn: day(r.received_on),
      payerName: r.payer_name,
      note: r.note,
      status: r.status,
      rejectReason: r.reject_reason,
      createdAt: iso(r.created_at),
    }),
  },
  {
    key: 'tenants',
    view: 'sync_tenant',
    staffOnly: true,
    caretaker: 'property',
    map: (r) => ({ id: r.id, fullName: r.full_name, phone: r.phone }),
  },
  {
    key: 'leases',
    view: 'sync_lease',
    staffOnly: true,
    caretaker: 'property',
    map: (r) => ({
      id: r.id,
      unitId: r.unit_id,
      tenantId: r.tenant_id,
      startDate: day(r.start_date),
      endDate: day(r.end_date),
      status: r.status,
    }),
  },
];

/** Rows per table per pull. */
const PAGE = 500;
const MAX_PUSH = 200;

interface Cursor {
  v: 1;
  /** Scope hash: role + caretaker properties. A change forces a full snapshot. */
  s: string;
  /** Per table keyset watermark: [updated_at in µs since epoch, id]. */
  w: Partial<Record<TableKey, [string, string]>>;
}

function decode(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
    if (c.v === 1 && typeof c.s === 'string' && c.w && typeof c.w === 'object') return c;
  } catch {
    // fall through
  }
  throw AppError.unprocessable('invalid_cursor', 'The sync cursor is malformed; pull without one.');
}
const encode = (c: Cursor) => Buffer.from(JSON.stringify(c)).toString('base64url');

/**
 * Offline sync (ADR-017). Pull: incremental changes per table since the cursor, scoped by RLS
 * and role. Push: device-created records applied once each through the normal services.
 */
export function createSyncService(deps: AppDeps, members: MaintenanceDeps) {
  const { db } = deps;
  // Rows written by transactions still open when we pull must not be skipped: stay behind now().
  const lag = sql.raw(`interval '${Math.trunc(deps.config.sync.lagSeconds)} seconds'`);
  const meters = createLeasing(deps).meters;
  const tickets = createMaintenanceService(deps, members);
  const cash = createPayments(deps).cash;

  async function scope(tx: Tx, ctx: Ctx) {
    const caretaker = ctx.role === 'caretaker';
    const props = caretaker
      ? [...(await accounts.assignedPropertyIds(tx, ctx.userId!))].sort()
      : [];
    const hash = createHash('sha256')
      .update(`${ctx.role}|${props.join(',')}`)
      .digest('base64url')
      .slice(0, 16);
    return { caretaker, props, hash };
  }

  async function exists(tx: Tx, view: string, id: string) {
    const { rows } = await tx.execute(
      sql`SELECT 1 FROM ${sql.identifier(view)} WHERE id = ${id}::uuid`,
    );
    return rows.length > 0;
  }

  return {
    async pull(ctx: Ctx, rawCursor?: string): Promise<Pull> {
      const prev = decode(rawCursor);
      return inTenant(db, ctx, async (tx) => {
        const sc = await scope(tx, ctx);
        const reset = !prev || prev.s !== sc.hash;
        const next: Cursor = { v: 1, s: sc.hash, w: reset ? {} : { ...prev.w } };
        const changes = {} as Pull['changes'];
        let hasMore = false;
        for (const t of TABLES) {
          const out = { upserted: [] as Record<string, unknown>[], deleted: [] as string[] };
          (changes as Record<string, typeof out>)[t.key] = out;
          if (t.staffOnly && sc.caretaker) continue;
          if (sc.caretaker && t.caretaker === 'property' && !sc.props.length) continue;
          const wm = next.w[t.key];
          const scoped = !sc.caretaker
            ? sql``
            : t.caretaker === 'own'
              ? sql`AND submitted_by = ${ctx.userId!}::uuid`
              : sql`AND property_id IN (${sql.join(
                  sc.props.map((p) => sql`${p}::uuid`),
                  sql`, `,
                )})`;
          const after = wm
            ? sql`AND (updated_at, id) > (timestamptz 'epoch' + ${wm[0]}::bigint * interval '1 microsecond', ${wm[1]}::uuid)`
            : sql``;
          const { rows } = await tx.execute<Row>(sql`
            SELECT *, (extract(epoch FROM updated_at) * 1000000)::bigint::text AS us
              FROM ${sql.identifier(t.view)}
             WHERE updated_at <= now() - ${lag} ${scoped} ${after}
             ORDER BY updated_at, id
             LIMIT ${PAGE + 1}`);
          if (rows.length > PAGE) hasMore = true;
          const page = rows.slice(0, PAGE);
          for (const r of page) {
            if (r.archived) out.deleted.push(r.id);
            else out.upserted.push({ ...t.map(r), updatedAt: iso(r.updated_at) });
          }
          const last = page.at(-1);
          if (last) next.w[t.key] = [last.us, last.id];
        }
        return { cursor: encode(next), reset, hasMore, changes };
      });
    },

    async push(ctx: Ctx, body: z.infer<typeof SyncPushBody>) {
      const total =
        (body.tickets?.length ?? 0) +
        (body.ticketUpdates?.length ?? 0) +
        (body.meterReadings?.length ?? 0) +
        (body.cashCollections?.length ?? 0);
      if (total > MAX_PUSH)
        throw AppError.unprocessable(
          'too_many_records',
          `Push at most ${MAX_PUSH} records at a time.`,
        );
      const results: z.infer<typeof SyncPushResult>[] = [];
      const apply = async (
        type: z.infer<typeof SyncPushResult>['type'],
        view: string,
        id: string,
        run: () => Promise<unknown>,
      ) => {
        if (await inTenant(db, ctx, (tx) => exists(tx, view, id))) {
          results.push({ id, type, status: 'duplicate', code: null, message: null });
          return;
        }
        try {
          await run();
          results.push({ id, type, status: 'applied', code: null, message: null });
        } catch (err) {
          if (
            pgError(err)?.code === PG.uniqueViolation &&
            (await inTenant(db, ctx, (tx) => exists(tx, view, id)))
          ) {
            results.push({ id, type, status: 'duplicate', code: null, message: null });
          } else if (err instanceof AppError) {
            results.push({
              id,
              type,
              status: 'rejected',
              code: err.code,
              message: err.detail ?? err.title,
            });
          } else throw err;
        }
      };
      for (const { id, ...t } of body.tickets ?? [])
        await apply('ticket', 'sync_ticket', id, () => tickets.create(ctx, t, id));
      for (const { id, ticketId, ...u } of body.ticketUpdates ?? [])
        await apply('ticket_update', 'sync_ticket_update', id, () =>
          tickets.addUpdate(ctx, ticketId, u, id),
        );
      for (const { id, meterId, ...r } of body.meterReadings ?? [])
        await apply('meter_reading', 'sync_meter_reading', id, () =>
          meters.addReading(ctx, meterId, r, id),
        );
      for (const { id, ...c } of body.cashCollections ?? [])
        await apply('cash_collection', 'sync_cash_collection', id, () => cash.submit(ctx, c, id));
      return { results };
    },
  };
}

export type SyncService = ReturnType<typeof createSyncService>;
