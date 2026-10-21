import { time } from '@kejasha/core';
import { and, eq, inArray, schema, sql, type Tx } from '@kejasha/db';
import * as ledger from '../ledger';

/** Read helpers the payments module uses for bookings (ADR-001). */
const { booking: bk, guest: gs } = schema;

/** Sources whose money the host collects directly (and which therefore have a receivable). */
export const COLLECTED_SOURCES = ['direct', 'walk_in', 'whatsapp', 'other'] as const;

export interface BookingForPayment {
  bookingId: string;
  unitId: string;
  guestName: string | null;
  guestPhone: string | null;
  source: string;
  status: string;
  balanceCents: bigint;
}

export async function bookingsForPayments(tx: Tx, ids: string[]): Promise<BookingForPayment[]> {
  if (!ids.length) return [];
  const rows = await tx
    .select({
      bookingId: bk.id,
      unitId: bk.unitId,
      guestName: gs.fullName,
      guestPhone: gs.phone,
      source: bk.source,
      status: bk.status,
    })
    .from(bk)
    .leftJoin(gs, eq(gs.id, bk.guestId))
    .where(inArray(bk.id, ids));
  const balances = await ledger.bookingBalances(tx, ids);
  return rows.map((r) => ({ ...r, balanceCents: balances.get(r.bookingId)?.balance ?? 0n }));
}

const live = sql`${bk.status} IN ('confirmed', 'checked_in') AND ${bk.source} IN ('direct', 'walk_in', 'whatsapp', 'other')`;

/** The one booking on a unit a payment on `paidOn` is for: up to 30 days before arrival until check-out, with a balance. */
export async function bookingForPayment(
  tx: Tx,
  unitId: string,
  paidOn: string,
): Promise<string | null> {
  const rows = await tx
    .select({ id: bk.id })
    .from(bk)
    .where(
      and(
        eq(bk.unitId, unitId),
        live,
        sql`${bk.checkIn} - 30 <= ${paidOn}::date AND ${bk.checkOut} > ${paidOn}::date`,
      ),
    );
  const owing = (
    await bookingsForPayments(
      tx,
      rows.map((r) => r.id),
    )
  ).filter((b) => b.balanceCents > 0n);
  return owing.length === 1 ? owing[0]!.bookingId : null;
}

/** Upcoming or current collectable bookings of a guest phone that still owe money. */
export async function owingBookingIdsByGuestPhone(
  tx: Tx,
  phone: string,
  today = time.nairobiDate(),
): Promise<string[]> {
  const rows = await tx
    .select({ id: bk.id })
    .from(bk)
    .innerJoin(gs, eq(gs.id, bk.guestId))
    .where(and(eq(gs.phone, phone), live, sql`${bk.checkOut} >= ${today}::date`));
  return (
    await bookingsForPayments(
      tx,
      rows.map((r) => r.id),
    )
  )
    .filter((b) => b.balanceCents > 0n)
    .map((b) => b.bookingId);
}
