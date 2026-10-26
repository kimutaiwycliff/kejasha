import type {
  CashCollection,
  CashCollectionQuery,
  CreateCashCollectionBody,
} from '@kejasha/contracts';
import { money, time, uuidv7 } from '@kejasha/core';
import { and, desc, eq, schema, sql, type Tx } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import { decodeCursor, page } from '../../lib/pagination';
import { assertUploadKeys, fileLinks } from '../../lib/uploads';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import * as shortstay from '../shortstay';
import { allocate, recordPayment, targetOf, type PaymentRow, type PaymentTarget } from './service';

const { cashCollection: cc } = schema;
type Row = typeof cc.$inferSelect;
const RECEIPT = 'cash_receipt';

/**
 * Cash a caretaker collected (B5). It is only a proposal: nothing reaches the ledger until an
 * owner or manager confirms it, which records a cash payment allocated to the lease or booking
 * through the normal payments path (receipt included). Caretakers see only their own entries.
 */
export function createCashCollections(deps: AppDeps) {
  const { db, clock, storage } = deps;

  async function targetUnit(tx: Tx, row: { leaseId: string | null; bookingId: string | null }) {
    if (row.leaseId) {
      const [l] = await leasing.leasesForMatching(tx, [row.leaseId]);
      return l ? { unitId: l.unitId, name: l.tenantName } : null;
    }
    const [b] = await shortstay.bookingsForPayments(tx, [row.bookingId!]);
    return b ? { unitId: b.unitId, name: b.guestName } : null;
  }

  async function toDtos(tx: Tx, rows: Row[]): Promise<z.infer<typeof CashCollection>[]> {
    const targets = await Promise.all(rows.map((r) => targetUnit(tx, r)));
    const units = await accounts.unitsById(
      tx,
      targets.map((t) => t?.unitId).filter((x): x is string => Boolean(x)),
    );
    return Promise.all(
      rows.map(async (r, i) => {
        const t = targets[i];
        return {
          id: r.id,
          leaseId: r.leaseId,
          bookingId: r.bookingId,
          unitCode: t ? (units.get(t.unitId)?.code ?? null) : null,
          payerName: r.payerName ?? t?.name ?? null,
          amountCents: money.toApiInt(r.amountCents),
          receivedOn: r.receivedOn,
          note: r.note,
          receipt: r.receiptKey ? (await fileLinks(storage, [r.receiptKey]))[0]! : null,
          status: r.status,
          submittedBy: r.submittedBy,
          decidedBy: r.decidedBy,
          decidedAt: r.decidedAt?.toISOString() ?? null,
          rejectReason: r.rejectReason,
          paymentId: r.paymentId,
          createdAt: r.createdAt.toISOString(),
        };
      }),
    );
  }

  /**
   * The lease covering a unit on a date. Caretakers are checked against their properties first,
   * so a 422 never reveals whether a unit elsewhere is let.
   */
  async function leaseOfUnit(
    tx: Tx,
    ctx: Ctx,
    unitId: string,
    date: string,
  ): Promise<PaymentTarget> {
    const unit = (await accounts.unitsById(tx, [unitId])).get(unitId);
    if (
      !unit ||
      (ctx.role === 'caretaker' &&
        !(await accounts.assignedPropertyIds(tx, ctx.userId!)).has(unit.propertyId))
    )
      throw AppError.notFound('Unit');
    const leaseId = await leasing.leaseOnUnitAt(tx, unitId, date);
    if (!leaseId)
      throw AppError.unprocessable(
        'no_lease_on_unit',
        'No lease covers this unit on that date. For a short-stay guest, choose the booking.',
      );
    return { leaseId };
  }

  async function load(tx: Tx, ctx: Ctx, id: string, lock = false) {
    const q = tx.select().from(cc).where(eq(cc.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row || (ctx.role === 'caretaker' && row.submittedBy !== ctx.userId))
      throw AppError.notFound('Cash collection');
    return row;
  }

  return {
    /** `id` lets offline clients (sync push) choose the record id. */
    async submit(ctx: Ctx, body: z.infer<typeof CreateCashCollectionBody>, id?: string) {
      const given = [body.leaseId, body.bookingId, body.unitId].filter(Boolean).length;
      if (given !== 1)
        throw AppError.unprocessable(
          'target_required',
          'Send exactly one of leaseId, bookingId or unitId.',
        );
      if (body.receivedOn > clock.today())
        throw AppError.unprocessable('future_date', 'Cash cannot be received in the future.');
      if (body.receiptKey) assertUploadKeys(ctx, RECEIPT, [body.receiptKey]);
      return inTenant(db, ctx, async (tx) => {
        const target = body.unitId
          ? await leaseOfUnit(tx, ctx, body.unitId, body.receivedOn)
          : targetOf(body)!;
        const t = await targetUnit(tx, {
          leaseId: target.leaseId ?? null,
          bookingId: target.bookingId ?? null,
        });
        if (!t) throw AppError.notFound(target.leaseId ? 'Lease' : 'Booking');
        if (ctx.role === 'caretaker') {
          const unit = (await accounts.unitsById(tx, [t.unitId])).get(t.unitId);
          if (!unit || !(await accounts.assignedPropertyIds(tx, ctx.userId!)).has(unit.propertyId))
            throw AppError.notFound(target.leaseId ? 'Lease' : 'Booking');
        }
        const [row] = await tx
          .insert(cc)
          .values({
            id: id ?? uuidv7(),
            orgId: ctx.orgId,
            leaseId: target.leaseId ?? null,
            bookingId: target.bookingId ?? null,
            amountCents: BigInt(body.amountCents),
            receivedOn: body.receivedOn,
            payerName: body.payerName || null,
            note: body.note || null,
            receiptKey: body.receiptKey ?? null,
            submittedBy: ctx.userId!,
          })
          .returning();
        await record(tx, ctx, {
          action: 'cash.submitted',
          entityType: 'cash_collection',
          entityId: row!.id,
          diff: { ...target, amountCents: body.amountCents },
        });
        return (await toDtos(tx, [row!]))[0]!;
      });
    },

    async list(ctx: Ctx, q: z.infer<typeof CashCollectionQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(cc)
          .where(
            and(
              ctx.role === 'caretaker' ? eq(cc.submittedBy, ctx.userId!) : undefined,
              q.status ? eq(cc.status, q.status) : undefined,
              after
                ? sql`(${cc.createdAt}, ${cc.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(cc.createdAt), desc(cc.id))
          .limit(q.limit + 1);
        return page(await toDtos(tx, rows), q.limit, (r) => [r.createdAt, r.id]);
      });
    },

    async get(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => (await toDtos(tx, [await load(tx, ctx, id)]))[0]!);
    },

    /** Owner/manager accepts the cash: one cash payment, allocated, receipted. */
    async confirm(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, ctx, id, true);
        if (row.status !== 'pending')
          throw AppError.conflict(
            'cash_already_decided',
            `This cash entry is already ${row.status}.`,
          );
        const { payment } = await recordPayment(tx, ctx, {
          source: 'manual',
          method: 'cash',
          providerRef: `CASH-${row.id.replace(/-/g, '').slice(-16).toUpperCase()}`,
          amountCents: row.amountCents,
          paidAt: time.startOfNairobiDay(row.receivedOn),
          payerName: row.payerName,
          notes: row.note ? `Cash (caretaker): ${row.note}`.slice(0, 500) : 'Cash (caretaker)',
        });
        const matched: PaymentRow =
          payment.matchStatus === 'unmatched'
            ? await allocate(
                tx,
                ctx,
                payment,
                row.leaseId ? { leaseId: row.leaseId } : { bookingId: row.bookingId! },
                'manual',
              )
            : payment;
        const [updated] = await tx
          .update(cc)
          .set({
            status: 'confirmed',
            paymentId: matched.id,
            decidedBy: ctx.userId ?? null,
            decidedAt: clock.now(),
          })
          .where(eq(cc.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'cash.confirmed',
          entityType: 'cash_collection',
          entityId: id,
          diff: { paymentId: matched.id },
        });
        return (await toDtos(tx, [updated!]))[0]!;
      });
    },

    async reject(ctx: Ctx, id: string, reason: string) {
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, ctx, id, true);
        if (row.status !== 'pending')
          throw AppError.conflict(
            'cash_already_decided',
            `This cash entry is already ${row.status}.`,
          );
        const [updated] = await tx
          .update(cc)
          .set({
            status: 'rejected',
            rejectReason: reason,
            decidedBy: ctx.userId ?? null,
            decidedAt: clock.now(),
          })
          .where(eq(cc.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'cash.rejected',
          entityType: 'cash_collection',
          entityId: id,
          diff: { reason },
        });
        return (await toDtos(tx, [updated!]))[0]!;
      });
    },
  };
}

export type CashCollections = ReturnType<typeof createCashCollections>;
