import type {
  ManualPaymentBody,
  Payment,
  PaymentQuery,
  PaymentSuggestion,
} from '@kejasha/contracts';
import { money, phone as phoneLib, time, uuidv7 } from '@kejasha/core';
import { and, desc, eq, inArray, schema, sql, type Tx } from '@kejasha/db';
import { enqueueInTx } from '@kejasha/jobs';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import { nextNumber } from '../../lib/numbering';
import { decodeCursor, page } from '../../lib/pagination';
import * as accounts from '../accounts';
import * as leasing from '../leasing';
import * as ledger from '../ledger';
import * as shortstay from '../shortstay';

/**
 * Payments core (ADR-008/009): one row per M-Pesa transaction, auto-matching, allocation to a
 * lease or booking through the ledger (Dr collections / Cr receivable), receipts.
 */
const { payment: pm, paymentChannel: ch } = schema;
export type PaymentRow = typeof pm.$inferSelect;
type PaymentDto = z.infer<typeof Payment>;

export interface PaymentInput {
  channelId?: string | null;
  source: PaymentRow['source'];
  method?: PaymentRow['method'];
  providerRef: string;
  amountCents: bigint;
  paidAt: Date;
  msisdn?: string | null;
  payerName?: string | null;
  accountRef?: string | null;
  raw?: unknown;
  importId?: string | null;
  notes?: string | null;
}

/** Normalise a payer number when it is a real phone (newer Daraja versions may mask/hash it). */
function payerPhone(msisdn: string | null): string | null {
  return msisdn ? phoneLib.normalizeKenyanPhone(msisdn) : null;
}

/** What a payment is applied to: a lease (rent) or a short-stay booking. */
export type PaymentTarget =
  { leaseId: string; bookingId?: undefined } | { bookingId: string; leaseId?: undefined };

async function resolveTarget(tx: Tx, ctx: Ctx, target: PaymentTarget) {
  if (target.leaseId) {
    const leaseId = target.leaseId;
    const [l] = await leasing.leasesForMatching(tx, [leaseId]);
    if (!l) throw AppError.notFound('Lease');
    return {
      leaseId,
      bookingId: null,
      unitId: l.unitId,
      receivable: (await ledger.leaseAccounts(tx, ctx, leaseId)).receivable,
      phone: l.tenantPhone,
      balance: async () => (await ledger.leaseBalances(tx, [leaseId])).get(leaseId)!.receivable,
    };
  }
  const bookingId = target.bookingId!;
  const [b] = await shortstay.bookingsForPayments(tx, [bookingId]);
  if (!b) throw AppError.notFound('Booking');
  if (!(shortstay.COLLECTED_SOURCES as readonly string[]).includes(b.source))
    throw AppError.unprocessable(
      'booking_not_collected',
      'This booking was paid through its channel (Airbnb/Booking.com); there is nothing to collect.',
    );
  return {
    leaseId: null,
    bookingId,
    unitId: b.unitId,
    receivable: await ledger.bookingReceivable(tx, ctx, bookingId),
    phone: b.guestPhone,
    balance: async () => (await ledger.bookingBalances(tx, [bookingId])).get(bookingId)!.balance,
  };
}

/** Post the payment to a lease or booking and issue its receipt. The payment row must be locked. */
export async function allocate(
  tx: Tx,
  ctx: Ctx,
  p: PaymentRow,
  target: PaymentTarget,
  method: NonNullable<PaymentRow['matchMethod']>,
) {
  if (p.matchStatus !== 'unmatched')
    throw AppError.conflict('payment_not_unmatched', `The payment is already ${p.matchStatus}.`);
  const t = await resolveTarget(tx, ctx, target);
  const collections = await ledger.accountFor(tx, ctx, 'collections');
  const counted = await tx.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ledger_entry WHERE source = 'payment' AND source_id = ${p.id}`,
  );
  const n = counted.rows[0]!.n;
  const unit = (await accounts.unitsById(tx, [t.unitId])).get(t.unitId);
  const { entryId } = await ledger.post(tx, ctx, {
    occurredOn: time.nairobiDate(p.paidAt),
    source: 'payment',
    sourceId: p.id,
    leaseId: t.leaseId ?? undefined,
    bookingId: t.bookingId ?? undefined,
    unitId: t.unitId,
    memo: `Payment ${p.providerRef} · ${unit?.code ?? ''}`.slice(0, 300),
    idempotencyKey: `payment:${p.id}:${n}`,
    lines: [
      { accountId: collections, amountCents: p.amountCents },
      { accountId: t.receivable, amountCents: -p.amountCents },
    ],
  });
  const receiptNumber = p.receiptNumber ?? (await nextNumber(tx, ctx, 'receipt', 'RCT'));
  const [updated] = await tx
    .update(pm)
    .set({
      matchStatus: 'matched',
      matchMethod: method,
      leaseId: t.leaseId,
      bookingId: t.bookingId,
      matchedBy: ctx.userId ?? null,
      matchedAt: sql`now()`,
      ledgerEntryId: entryId,
      receiptNumber,
    })
    .where(eq(pm.id, p.id))
    .returning();

  // Receipt by SMS (via the outbox, deduped per allocation).
  const to = t.phone ?? payerPhone(p.msisdn);
  if (to) {
    const balance = await t.balance();
    const balanceText =
      balance > 0n
        ? `Balance due ${money.formatKes(balance)}`
        : balance < 0n
          ? `Credit ${money.formatKes(-balance)}`
          : 'Fully paid';
    await enqueueInTx(tx, {
      orgId: ctx.orgId,
      topic: 'notifications.sms',
      payload: {
        to,
        message: `Received ${money.formatKes(p.amountCents)} for ${unit?.code ?? (t.bookingId ? 'your booking' : 'your unit')} (M-Pesa ${p.providerRef}). Receipt ${receiptNumber}. ${balanceText}. Thank you.`,
      },
      dedupeKey: `receipt:${p.id}:${n}`,
    });
  }
  await record(tx, ctx, {
    action: 'payment.allocated',
    entityType: 'payment',
    entityId: p.id,
    diff: { leaseId: t.leaseId, bookingId: t.bookingId, method },
  });
  return updated!;
}

/**
 * Account reference → unit → the lease (or, for a short-stay unit, the booking with a balance)
 * on the payment date; else a payer phone that identifies exactly one tenant lease or owing
 * booking.
 */
async function autoMatch(tx: Tx, ctx: Ctx, p: PaymentRow): Promise<PaymentRow> {
  const [channel] = p.channelId ? await tx.select().from(ch).where(eq(ch.id, p.channelId)) : [];
  const scopeOk = async (unitId: string) => {
    if (!channel?.clientLandlordId) return true;
    const unit = (await accounts.unitsById(tx, [unitId])).get(unitId);
    return unit?.clientLandlordId === channel.clientLandlordId;
  };
  const paidOn = time.nairobiDate(p.paidAt);
  if (p.accountRef) {
    const unitId = await accounts.unitIdByCode(tx, p.accountRef);
    if (unitId && (await scopeOk(unitId))) {
      const leaseId = await leasing.leaseOnUnitAt(tx, unitId, paidOn);
      if (leaseId) return allocate(tx, ctx, p, { leaseId }, 'auto_account');
      const bookingId = await shortstay.bookingForPayment(tx, unitId, paidOn);
      if (bookingId) return allocate(tx, ctx, p, { bookingId }, 'auto_account');
    }
  }
  const e164 = payerPhone(p.msisdn);
  if (e164) {
    const leaseIds = await leasing.leaseIdsByTenantPhone(tx, e164);
    const bookingIds = await shortstay.owingBookingIdsByGuestPhone(tx, e164, paidOn);
    if (leaseIds.length + bookingIds.length === 1) {
      const [l] = leaseIds.length ? await leasing.leasesForMatching(tx, leaseIds) : [];
      const [b] = bookingIds.length ? await shortstay.bookingsForPayments(tx, bookingIds) : [];
      const unitId = l?.unitId ?? b!.unitId;
      if (await scopeOk(unitId))
        return allocate(
          tx,
          ctx,
          p,
          l ? { leaseId: l.leaseId } : { bookingId: b!.bookingId },
          'auto_phone',
        );
    }
  }
  return p;
}

/**
 * Record a payment exactly once per provider reference (duplicate callbacks, re-imports and
 * re-shared SMS are no-ops) and try to match it.
 */
export async function recordPayment(
  tx: Tx,
  ctx: Ctx,
  input: PaymentInput,
): Promise<{ payment: PaymentRow; created: boolean }> {
  const [inserted] = await tx
    .insert(pm)
    .values({
      id: uuidv7(),
      orgId: ctx.orgId,
      channelId: input.channelId ?? null,
      source: input.source,
      method: input.method ?? 'mpesa',
      providerRef: input.providerRef,
      amountCents: input.amountCents,
      paidAt: input.paidAt,
      msisdn: input.msisdn ?? null,
      payerName: input.payerName ?? null,
      accountRef: input.accountRef ?? null,
      raw: input.raw ?? null,
      importId: input.importId ?? null,
      notes: input.notes ?? null,
      createdBy: ctx.userId ?? null,
    })
    .onConflictDoNothing({ target: [pm.orgId, pm.providerRef] })
    .returning();
  if (!inserted) {
    const [existing] = await tx.select().from(pm).where(eq(pm.providerRef, input.providerRef));
    return { payment: existing!, created: false };
  }
  await record(tx, ctx, {
    action: 'payment.recorded',
    entityType: 'payment',
    entityId: inserted.id,
    diff: { source: input.source, amountCents: input.amountCents.toString() },
  });
  return { payment: await autoMatch(tx, ctx, inserted), created: true };
}

/** Exactly one of leaseId / bookingId, else null. */
export function targetOf(b: {
  leaseId?: string | undefined;
  bookingId?: string | undefined;
}): PaymentTarget | null {
  if (b.leaseId && !b.bookingId) return { leaseId: b.leaseId };
  if (b.bookingId && !b.leaseId) return { bookingId: b.bookingId };
  return null;
}

export function createPaymentsService(deps: AppDeps) {
  const { db, clock } = deps;

  async function locked(tx: Tx, id: string) {
    const [row] = await tx.select().from(pm).where(eq(pm.id, id)).for('update');
    if (!row) throw AppError.notFound('Payment');
    return row;
  }

  async function toDtos(tx: Tx, rows: PaymentRow[]): Promise<PaymentDto[]> {
    const leaseIds = [
      ...new Set(rows.map((r) => r.leaseId).filter((x): x is string => Boolean(x))),
    ];
    const leases = leaseIds.length ? await leasing.leasesForMatching(tx, leaseIds) : [];
    const bookingIds = [
      ...new Set(rows.map((r) => r.bookingId).filter((x): x is string => Boolean(x))),
    ];
    const bookings = await shortstay.bookingsForPayments(tx, bookingIds);
    const units = await accounts.unitsById(tx, [
      ...leases.map((l) => l.unitId),
      ...bookings.map((b) => b.unitId),
    ]);
    const byLease = new Map(leases.map((l) => [l.leaseId, l]));
    const byBooking = new Map(bookings.map((b) => [b.bookingId, b]));
    return rows.map((r) => {
      const l = r.leaseId ? byLease.get(r.leaseId) : undefined;
      const b = r.bookingId ? byBooking.get(r.bookingId) : undefined;
      const unitId = l?.unitId ?? b?.unitId;
      return {
        id: r.id,
        source: r.source,
        method: r.method,
        providerRef: r.providerRef,
        amountCents: money.toApiInt(r.amountCents),
        paidAt: r.paidAt.toISOString(),
        msisdn: r.msisdn,
        payerName: r.payerName,
        accountRef: r.accountRef,
        channelId: r.channelId,
        matchStatus: r.matchStatus,
        matchMethod: r.matchMethod,
        leaseId: r.leaseId,
        bookingId: r.bookingId,
        tenantName: l?.tenantName ?? b?.guestName ?? null,
        unitCode: unitId ? (units.get(unitId)?.code ?? null) : null,
        receiptNumber: r.receiptNumber,
        ignoreReason: r.ignoreReason,
        notes: r.notes,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  return {
    toDtos,

    async list(ctx: Ctx, q: z.infer<typeof PaymentQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(pm)
          .where(
            and(
              q.status ? eq(pm.matchStatus, q.status) : undefined,
              q.source ? eq(pm.source, q.source) : undefined,
              q.leaseId ? eq(pm.leaseId, q.leaseId) : undefined,
              after
                ? sql`(${pm.paidAt}, ${pm.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(pm.paidAt), desc(pm.id))
          .limit(q.limit + 1);
        return page(await toDtos(tx, rows), q.limit, (p) => [p.paidAt, p.id]);
      });
    },

    async get(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(pm).where(eq(pm.id, id));
        if (!row) throw AppError.notFound('Payment');
        return (await toDtos(tx, [row]))[0]!;
      });
    },

    /** Ranked candidate leases for an unmatched payment. */
    async suggestions(ctx: Ctx, id: string): Promise<z.infer<typeof PaymentSuggestion>[]> {
      return inTenant(db, ctx, async (tx) => {
        const [p] = await tx.select().from(pm).where(eq(pm.id, id));
        if (!p) throw AppError.notFound('Payment');
        const candidates = await leasing.leasesForMatching(tx);
        const units = await accounts.unitsById(
          tx,
          candidates.map((c) => c.unitId),
        );
        const e164 = payerPhone(p.msisdn);
        const ref = p.accountRef?.trim().toUpperCase().replace(/[\s#]/g, '');
        const tokens = (p.payerName ?? '')
          .toUpperCase()
          .split(/[^A-Z]+/)
          .filter((t) => t.length > 2);
        const scored = candidates.map((c) => {
          const reasons: z.infer<typeof PaymentSuggestion>['reasons'] = [];
          let score = 0;
          const add = (points: number, reason: (typeof reasons)[number]) => {
            score += points;
            reasons.push(reason);
          };
          if (e164 && c.tenantPhone === e164) add(60, 'phone');
          if (ref && units.get(c.unitId)?.code === ref) add(50, 'account_ref');
          if (c.openAmounts.includes(p.amountCents)) add(30, 'exact_invoice_amount');
          if (c.balanceCents === p.amountCents) add(25, 'exact_balance');
          if (tokens.some((t) => c.tenantName.toUpperCase().includes(t))) add(20, 'name');
          return { c, score: Math.min(score, 100), reasons };
        });
        return scored
          .filter((s) => s.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(({ c, score, reasons }) => ({
            leaseId: c.leaseId,
            tenantName: c.tenantName,
            unitCode: units.get(c.unitId)?.code ?? '',
            score,
            reasons,
            outstandingCents: money.toApiInt(leasing.sumOpen(c)),
          }));
      });
    },

    async allocate(
      ctx: Ctx,
      id: string,
      body: { leaseId?: string | undefined; bookingId?: string | undefined },
    ) {
      const target = targetOf(body);
      if (!target)
        throw AppError.unprocessable(
          'target_required',
          'Send exactly one of leaseId or bookingId.',
        );
      return inTenant(db, ctx, async (tx) => {
        const updated = await allocate(tx, ctx, await locked(tx, id), target, 'manual');
        return (await toDtos(tx, [updated]))[0]!;
      });
    },

    /** Undo an allocation with a reversing ledger entry; the payment returns to the queue. */
    async unallocate(ctx: Ctx, id: string, reason: string) {
      return inTenant(db, ctx, async (tx) => {
        const p = await locked(tx, id);
        if (p.matchStatus !== 'matched')
          throw AppError.conflict(
            'payment_not_matched',
            'Only matched payments can be unallocated.',
          );
        await ledger.reverse(tx, ctx, p.ledgerEntryId!, {
          occurredOn: clock.today(),
          source: 'payment_reversal',
          memo: `Unallocated ${p.providerRef}: ${reason}`.slice(0, 300),
          idempotencyKey: `payment_reversal:${p.ledgerEntryId}`,
        });
        const [updated] = await tx
          .update(pm)
          .set({
            matchStatus: 'unmatched',
            matchMethod: null,
            leaseId: null,
            bookingId: null,
            ledgerEntryId: null,
            matchedBy: null,
            matchedAt: null,
          })
          .where(eq(pm.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'payment.unallocated',
          entityType: 'payment',
          entityId: id,
          diff: { reason },
        });
        return (await toDtos(tx, [updated!]))[0]!;
      });
    },

    async ignore(ctx: Ctx, id: string, reason: string) {
      return inTenant(db, ctx, async (tx) => {
        const p = await locked(tx, id);
        if (p.matchStatus !== 'unmatched')
          throw AppError.conflict('payment_not_unmatched', `The payment is ${p.matchStatus}.`);
        const [updated] = await tx
          .update(pm)
          .set({ matchStatus: 'ignored', ignoreReason: reason })
          .where(eq(pm.id, id))
          .returning();
        await record(tx, ctx, {
          action: 'payment.ignored',
          entityType: 'payment',
          entityId: id,
          diff: { reason },
        });
        return (await toDtos(tx, [updated!]))[0]!;
      });
    },

    /** Cash, bank or M-Pesa received outside our channels, entered by a manager. */
    async manual(ctx: Ctx, body: z.infer<typeof ManualPaymentBody>) {
      if (body.leaseId && body.bookingId)
        throw AppError.unprocessable('target_ambiguous', 'Send leaseId or bookingId, not both.');
      const target = targetOf(body);
      return inTenant(db, ctx, async (tx) => {
        const ref =
          body.reference?.trim() || `MAN-${uuidv7().replace(/-/g, '').slice(0, 16).toUpperCase()}`;
        const { payment, created } = await recordPayment(tx, ctx, {
          source: 'manual',
          method: body.method,
          providerRef: ref,
          amountCents: BigInt(body.amountCents),
          paidAt: time.startOfNairobiDay(body.paidOn),
          msisdn: body.phone ?? null,
          payerName: body.payerName || null,
          notes: body.notes || null,
        });
        if (!created)
          throw AppError.conflict(
            'duplicate_reference',
            `A payment with reference ${ref} already exists.`,
          );
        const final =
          target && payment.matchStatus === 'unmatched'
            ? await allocate(tx, ctx, payment, target, 'manual')
            : payment;
        return (await toDtos(tx, [final]))[0]!;
      });
    },

    async paymentsByIds(tx: Tx, ids: string[]) {
      return ids.length ? tx.select().from(pm).where(inArray(pm.id, ids)) : [];
    },
  };
}

export type PaymentsService = ReturnType<typeof createPaymentsService>;
