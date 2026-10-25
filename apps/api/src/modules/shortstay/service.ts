import type {
  Booking,
  BookingQuery,
  Calendar,
  CreateBlockBody,
  CreateBookingBody,
  CreateExpenseBody,
  CreateGuestBody,
  CreateSeasonBody,
  Guest,
  GuestQuery,
  Quote,
  RatePlan,
  ShortStayReport,
  UpdateBookingBody,
  UpdateGuestBody,
  UpsertRatePlanBody,
} from '@kejasha/contracts';
import { money, shortstay, time, uuidv7 } from '@kejasha/core';
import { and, asc, desc, eq, inArray, PG, pgError, schema, sql, type Tx } from '@kejasha/db';
import { enqueueInTx } from '@kejasha/jobs';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import { decodeCursor, page } from '../../lib/pagination';
import * as accounts from '../accounts';
import * as ledger from '../ledger';
import { COLLECTED_SOURCES } from './lookups';

const {
  ratePlan: rp,
  rateOverride: ro,
  guest: gs,
  booking: bk,
  calendarBlock: cb,
  unitExpense: ex,
} = schema;
type BookingRow = typeof bk.$inferSelect;
type GuestRow = typeof gs.$inferSelect;
const api = (v: bigint) => money.toApiInt(v);
const collected = (source: string) => (COLLECTED_SOURCES as readonly string[]).includes(source);
const MAX_CALENDAR_DAYS = 92;

type ExpenseRow = typeof ex.$inferSelect;

function toExpense(r: ExpenseRow) {
  return {
    id: r.id,
    propertyId: r.propertyId,
    unitId: r.unitId,
    bookingId: r.bookingId,
    maintenanceTicketId: r.maintenanceTicketId,
    incurredOn: r.incurredOn,
    category: r.category,
    amountCents: api(r.amountCents),
    description: r.description,
    createdAt: r.createdAt.toISOString(),
  };
}

export interface UnitExpenseInput {
  unitId: string | null;
  propertyId: string | null;
  bookingId?: string | null;
  maintenanceTicketId?: string | null;
  incurredOn: string;
  category: ExpenseRow['category'];
  amountCents: bigint;
  description?: string | null;
}

/**
 * The org's expense register (every unit, or a whole property). Other modules record costs here
 * through the module's index (maintenance repairs). Runs in the caller's tenant transaction.
 */
export async function recordUnitExpense(
  tx: Tx,
  ctx: Ctx,
  e: UnitExpenseInput,
): Promise<ExpenseRow> {
  let propertyId = e.propertyId;
  if (e.unitId) {
    const unit = (await accounts.unitsById(tx, [e.unitId])).get(e.unitId);
    if (!unit) throw AppError.notFound('Unit');
    if (propertyId && propertyId !== unit.propertyId)
      throw AppError.unprocessable('unit_property_mismatch', 'The unit is in another property.');
    propertyId = unit.propertyId;
  } else if (propertyId) {
    if (!(await accounts.propertiesById(tx, [propertyId])).has(propertyId))
      throw AppError.notFound('Property');
  } else {
    throw AppError.unprocessable('target_required', 'Send a unitId or a propertyId.');
  }
  const [row] = await tx
    .insert(ex)
    .values({
      id: uuidv7(),
      orgId: ctx.orgId,
      propertyId: propertyId!,
      unitId: e.unitId,
      bookingId: e.bookingId ?? null,
      maintenanceTicketId: e.maintenanceTicketId ?? null,
      incurredOn: e.incurredOn,
      category: e.category,
      amountCents: e.amountCents,
      description: e.description ?? null,
      createdBy: ctx.userId ?? null,
    })
    .returning();
  return row!;
}

/**
 * Keep a maintenance ticket's cost in the register: replaces the ticket's expense with `e`, or
 * removes it when `e` is null (cost cleared, ticket reopened or cancelled).
 */
export async function setTicketExpense(
  tx: Tx,
  ctx: Ctx,
  ticketId: string,
  e: Omit<UnitExpenseInput, 'maintenanceTicketId'> | null,
): Promise<ExpenseRow | null> {
  await tx.delete(ex).where(eq(ex.maintenanceTicketId, ticketId));
  return e ? recordUnitExpense(tx, ctx, { ...e, maintenanceTicketId: ticketId }) : null;
}

/** Expenses on the given properties between two dates (inclusive), for statements and reports. */
export async function expensesIn(tx: Tx, propertyIds: string[], from: string, to: string) {
  if (!propertyIds.length) return [];
  return tx
    .select()
    .from(ex)
    .where(
      and(
        inArray(ex.propertyId, propertyIds),
        sql`${ex.incurredOn} BETWEEN ${from}::date AND ${to}::date`,
      ),
    )
    .orderBy(asc(ex.incurredOn), asc(ex.id));
}

/** Expense ids recorded for maintenance tickets. */
export async function expenseIdsByTicket(
  tx: Tx,
  ticketIds: string[],
): Promise<Map<string, string>> {
  if (!ticketIds.length) return new Map();
  const rows = await tx
    .select({ id: ex.id, ticketId: ex.maintenanceTicketId })
    .from(ex)
    .where(inArray(ex.maintenanceTicketId, ticketIds));
  return new Map(rows.map((r) => [r.ticketId!, r.id]));
}

export function createShortStayService(deps: AppDeps) {
  const { db, clock } = deps;

  async function shortStayUnit(tx: Tx, unitId: string) {
    const unit = (await accounts.unitsById(tx, [unitId])).get(unitId);
    if (!unit) throw AppError.notFound('Unit');
    if (unit.mode !== 'short_stay')
      throw AppError.unprocessable(
        'unit_not_short_stay',
        'Bookings and rates are for short-stay units.',
      );
    if (unit.archived || unit.status !== 'active')
      throw AppError.unprocessable('unit_unavailable', 'The unit is archived or inactive.');
    return unit;
  }

  async function plan(tx: Tx, unitId: string) {
    const [row] = await tx.select().from(rp).where(eq(rp.unitId, unitId));
    const unit = (await accounts.unitsById(tx, [unitId])).get(unitId)!;
    const seasons = await tx
      .select()
      .from(ro)
      .where(eq(ro.unitId, unitId))
      .orderBy(asc(ro.startsOn));
    return {
      rules: {
        baseNightlyCents: row?.baseNightlyCents ?? unit.baseNightlyCents ?? 0n,
        weekendNightlyCents: row?.weekendNightlyCents ?? null,
        minStayNights: row?.minStayNights ?? 1,
        cleaningFeeCents: row?.cleaningFeeCents ?? 0n,
      },
      bufferDays: row?.bufferDays ?? 0,
      checkinInstructions: row?.checkinInstructions ?? null,
      seasons,
      unit,
    };
  }

  async function available(
    tx: Tx,
    unitId: string,
    from: string,
    toExclusive: string,
    exceptBookingId?: string,
  ) {
    const { rows } = await tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM unit_occupancy
       WHERE unit_id = ${unitId} AND during && daterange(${from}::date, ${toExclusive}::date, '[)')
         ${exceptBookingId ? sql`AND booking_id IS DISTINCT FROM ${exceptBookingId}` : sql``}`);
    return rows[0]!.n === 0;
  }

  function overlap(err: unknown): never {
    const pg = pgError(err);
    if (pg?.code === PG.exclusionViolation) {
      throw AppError.conflict(
        pg.constraint === 'rate_override_no_overlap' ? 'season_overlap' : 'dates_unavailable',
        pg.constraint === 'rate_override_no_overlap'
          ? 'Another season already covers some of these dates.'
          : 'The unit is booked or blocked for some of these dates.',
      );
    }
    throw err;
  }

  async function toBookings(tx: Tx, rows: BookingRow[]): Promise<z.infer<typeof Booking>[]> {
    if (!rows.length) return [];
    const units = await accounts.unitsById(
      tx,
      rows.map((r) => r.unitId),
    );
    const guestIds = [
      ...new Set(rows.map((r) => r.guestId).filter((x): x is string => Boolean(x))),
    ];
    const guests = guestIds.length
      ? await tx.select().from(gs).where(inArray(gs.id, guestIds))
      : [];
    const stays = guestIds.length
      ? await tx
          .select({ guestId: bk.guestId, n: sql<number>`count(*)::int` })
          .from(bk)
          .where(
            and(inArray(bk.guestId, guestIds), sql`${bk.status} NOT IN ('cancelled', 'no_show')`),
          )
          .groupBy(bk.guestId)
      : [];
    const balances = await ledger.bookingBalances(
      tx,
      rows.map((r) => r.id),
    );
    const guestById = new Map(guests.map((g) => [g.id, g]));
    const staysBy = new Map(stays.map((s) => [s.guestId, s.n]));
    return rows.map((r) => {
      const u = units.get(r.unitId);
      const b = balances.get(r.id)!;
      return {
        id: r.id,
        unitId: r.unitId,
        unitCode: u?.code ?? '',
        propertyName: u?.propertyName ?? '',
        guestId: r.guestId,
        guestName: r.guestId ? (guestById.get(r.guestId)?.fullName ?? null) : null,
        isRepeatGuest: r.guestId ? (staysBy.get(r.guestId) ?? 0) > 1 : false,
        checkIn: r.checkIn,
        checkOut: r.checkOut,
        nights: shortstay.nights(r.checkIn, r.checkOut),
        source: r.source,
        status: r.status,
        guestsCount: r.guestsCount,
        grossCents: api(r.grossCents),
        cleaningFeeCents: api(r.cleaningFeeCents),
        commissionBps: r.commissionBps,
        commissionCents: api(r.commissionCents),
        netCents: api(r.grossCents - r.commissionCents),
        paidCents: api(b.billed - b.balance),
        balanceCents: api(b.balance),
        notes: r.notes,
        fromIcal: r.icalFeedId !== null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  /** Keep the receivable in line with the booking's gross (direct-collection bookings only). */
  async function syncBookingLedger(tx: Tx, ctx: Ctx, row: BookingRow) {
    if (!collected(row.source)) return;
    const target = row.status === 'cancelled' || row.status === 'no_show' ? 0n : row.grossCents;
    const billed = (await ledger.bookingBalances(tx, [row.id])).get(row.id)!.billed;
    const delta = target - billed;
    if (delta === 0n) return;
    const [{ n }] = (
      await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM ledger_entry WHERE booking_id = ${row.id} AND source IN ('booking', 'booking_cancellation')`,
      )
    ).rows as [{ n: number }];
    const receivable = await ledger.bookingReceivable(tx, ctx, row.id);
    const income = await ledger.accountFor(tx, ctx, 'income_short_stay');
    const unit = (await accounts.unitsById(tx, [row.unitId])).get(row.unitId);
    const { entryId } = await ledger.post(tx, ctx, {
      occurredOn: clock.today(),
      source: target === 0n ? 'booking_cancellation' : 'booking',
      sourceId: row.id,
      unitId: row.unitId,
      bookingId: row.id,
      memo: `${target === 0n ? 'Cancelled' : 'Booking'} ${unit?.code ?? ''} ${row.checkIn}→${row.checkOut}`,
      idempotencyKey: `booking:${row.id}:${n}`,
      lines: [
        { accountId: receivable, amountCents: delta },
        { accountId: income, amountCents: -delta },
      ],
    });
    if (!row.ledgerEntryId)
      await tx.update(bk).set({ ledgerEntryId: entryId }).where(eq(bk.id, row.id));
  }

  async function findOrCreateGuest(
    tx: Tx,
    ctx: Ctx,
    g: z.infer<typeof CreateGuestBody>,
  ): Promise<GuestRow> {
    if (g.phone) {
      const [existing] = await tx.select().from(gs).where(eq(gs.phone, g.phone));
      if (existing) return existing;
    }
    const [row] = await tx
      .insert(gs)
      .values({
        id: uuidv7(),
        orgId: ctx.orgId,
        fullName: g.fullName,
        phone: g.phone ?? null,
        email: g.email ?? null,
        idNumber: g.idNumber || null,
        nationality: g.nationality || null,
        notes: g.notes || null,
      })
      .returning();
    return row!;
  }

  async function loadBooking(tx: Tx, id: string, lock = false) {
    const q = tx.select().from(bk).where(eq(bk.id, id));
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw AppError.notFound('Booking');
    return row;
  }

  async function transition(
    ctx: Ctx,
    id: string,
    from: BookingRow['status'][],
    to: BookingRow['status'],
    extra: Partial<typeof bk.$inferInsert> = {},
  ) {
    return inTenant(db, ctx, async (tx) => {
      const row = await loadBooking(tx, id, true);
      if (!from.includes(row.status))
        throw AppError.conflict(
          'invalid_booking_status',
          `A ${row.status} booking cannot become ${to}.`,
        );
      const [updated] = await tx
        .update(bk)
        .set({ status: to, ...extra })
        .where(eq(bk.id, id))
        .returning();
      await syncBookingLedger(tx, ctx, updated!);
      await record(tx, ctx, { action: `booking.${to}`, entityType: 'booking', entityId: id });
      return (await toBookings(tx, [updated!]))[0]!;
    });
  }

  return {
    // ── Rates ─────────────────────────────────────────────────────────────────────────────
    async getRatePlan(ctx: Ctx, unitId: string): Promise<z.infer<typeof RatePlan>> {
      return inTenant(db, ctx, async (tx) => {
        await shortStayUnit(tx, unitId);
        const p = await plan(tx, unitId);
        return {
          unitId,
          unitCode: p.unit.code,
          baseNightlyCents: api(p.rules.baseNightlyCents),
          weekendNightlyCents:
            p.rules.weekendNightlyCents === null ? null : api(p.rules.weekendNightlyCents),
          minStayNights: p.rules.minStayNights,
          bufferDays: p.bufferDays,
          cleaningFeeCents: api(p.rules.cleaningFeeCents),
          checkinInstructions: p.checkinInstructions,
          seasons: p.seasons.map((s) => ({
            id: s.id,
            label: s.label,
            startsOn: s.startsOn,
            endsOn: s.endsOn,
            nightlyCents: api(s.nightlyCents),
            minStayNights: s.minStayNights,
          })),
        };
      });
    },

    async upsertRatePlan(ctx: Ctx, unitId: string, body: z.infer<typeof UpsertRatePlanBody>) {
      await inTenant(db, ctx, async (tx) => {
        await shortStayUnit(tx, unitId);
        const values = {
          baseNightlyCents: BigInt(body.baseNightlyCents),
          weekendNightlyCents:
            body.weekendNightlyCents === undefined || body.weekendNightlyCents === null
              ? null
              : BigInt(body.weekendNightlyCents),
          minStayNights: body.minStayNights ?? 1,
          bufferDays: body.bufferDays ?? 0,
          cleaningFeeCents: BigInt(body.cleaningFeeCents ?? 0),
          checkinInstructions: body.checkinInstructions || null,
        };
        await tx
          .insert(rp)
          .values({ orgId: ctx.orgId, unitId, ...values })
          .onConflictDoUpdate({ target: rp.unitId, set: values });
        await record(tx, ctx, {
          action: 'rate_plan.saved',
          entityType: 'unit',
          entityId: unitId,
          diff: body,
        });
      });
      return this.getRatePlan(ctx, unitId);
    },

    async addSeason(ctx: Ctx, unitId: string, body: z.infer<typeof CreateSeasonBody>) {
      if (body.endsOn <= body.startsOn)
        throw AppError.unprocessable('invalid_dates', 'endsOn must be after startsOn.');
      await inTenant(db, ctx, async (tx) => {
        await shortStayUnit(tx, unitId);
        const id = uuidv7();
        await tx
          .insert(ro)
          .values({
            id,
            orgId: ctx.orgId,
            unitId,
            label: body.label,
            startsOn: body.startsOn,
            endsOn: body.endsOn,
            nightlyCents: BigInt(body.nightlyCents),
            minStayNights: body.minStayNights ?? null,
          })
          .catch(overlap);
        await record(tx, ctx, {
          action: 'season.created',
          entityType: 'unit',
          entityId: unitId,
          diff: body,
        });
      });
      return this.getRatePlan(ctx, unitId);
    },

    async removeSeason(ctx: Ctx, seasonId: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.delete(ro).where(eq(ro.id, seasonId)).returning();
        if (!row) throw AppError.notFound('Season');
        await record(tx, ctx, {
          action: 'season.removed',
          entityType: 'unit',
          entityId: row.unitId,
        });
      });
    },

    async quote(
      ctx: Ctx,
      unitId: string,
      checkIn: string,
      checkOut: string,
    ): Promise<z.infer<typeof Quote>> {
      if (checkOut <= checkIn)
        throw AppError.unprocessable('invalid_dates', 'checkOut must be after checkIn.');
      if (shortstay.nights(checkIn, checkOut) > 365)
        throw AppError.unprocessable('stay_too_long', 'Stays are limited to 365 nights.');
      return inTenant(db, ctx, async (tx) => {
        await shortStayUnit(tx, unitId);
        const p = await plan(tx, unitId);
        const q = shortstay.quote(
          p.rules,
          p.seasons.map((s) => ({
            from: s.startsOn,
            to: s.endsOn,
            nightlyCents: s.nightlyCents,
            minStayNights: s.minStayNights,
          })),
          checkIn,
          checkOut,
        );
        return {
          unitId,
          checkIn,
          checkOut,
          nights: q.nights.map((n) => ({
            date: n.date,
            nightlyCents: api(n.nightlyCents),
            rate: n.rate,
          })),
          nightCount: q.nightCount,
          nightsTotalCents: api(q.nightsTotalCents),
          cleaningFeeCents: api(q.cleaningFeeCents),
          totalCents: api(q.totalCents),
          minStayNights: q.minStayNights,
          meetsMinStay: q.meetsMinStay,
          available: await available(tx, unitId, checkIn, time.addDays(checkOut, p.bufferDays)),
        };
      });
    },

    // ── Guests ────────────────────────────────────────────────────────────────────────────
    async listGuests(ctx: Ctx, q: z.infer<typeof GuestQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(gs)
          .where(
            and(
              q.q
                ? sql`(${gs.fullName} ILIKE ${`%${q.q}%`} OR ${gs.phone} ILIKE ${`%${q.q}%`})`
                : undefined,
              after
                ? sql`(lower(${gs.fullName}), ${gs.id}) > (${after[0]}, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(sql`lower(${gs.fullName})`, asc(gs.id))
          .limit(q.limit + 1);
        return page(await this.toGuests(tx, rows), q.limit, (g) => [
          g.fullName.toLowerCase(),
          g.id,
        ]);
      });
    },

    async toGuests(tx: Tx, rows: GuestRow[]): Promise<z.infer<typeof Guest>[]> {
      if (!rows.length) return [];
      const stats = await tx
        .select({
          guestId: bk.guestId,
          n: sql<number>`count(*)::int`,
          last: sql<string | null>`max(${bk.checkIn})::text`,
        })
        .from(bk)
        .where(
          and(
            inArray(
              bk.guestId,
              rows.map((r) => r.id),
            ),
            sql`${bk.status} NOT IN ('cancelled', 'no_show')`,
          ),
        )
        .groupBy(bk.guestId);
      const by = new Map(stats.map((s) => [s.guestId, s]));
      return rows.map((g) => ({
        id: g.id,
        fullName: g.fullName,
        phone: g.phone,
        email: g.email,
        idNumber: g.idNumber,
        nationality: g.nationality,
        notes: g.notes,
        stays: by.get(g.id)?.n ?? 0,
        lastStayOn: by.get(g.id)?.last ?? null,
        createdAt: g.createdAt.toISOString(),
      }));
    },

    async createGuest(ctx: Ctx, body: z.infer<typeof CreateGuestBody>) {
      return inTenant(db, ctx, async (tx) => {
        if (body.phone) {
          const [dup] = await tx.select({ id: gs.id }).from(gs).where(eq(gs.phone, body.phone));
          if (dup)
            throw AppError.conflict('guest_exists', 'A guest with this phone already exists.');
        }
        const row = await findOrCreateGuest(tx, ctx, body);
        await record(tx, ctx, { action: 'guest.created', entityType: 'guest', entityId: row.id });
        return (await this.toGuests(tx, [row]))[0]!;
      });
    },

    async updateGuest(ctx: Ctx, id: string, body: z.infer<typeof UpdateGuestBody>) {
      return inTenant(db, ctx, async (tx) => {
        const set = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
        const [row] = Object.keys(set).length
          ? await tx
              .update(gs)
              .set(set)
              .where(eq(gs.id, id))
              .returning()
              .catch((err: unknown) => {
                if (pgError(err)?.code === PG.uniqueViolation)
                  throw AppError.conflict('guest_exists', 'Another guest has this phone.');
                throw err;
              })
          : await tx.select().from(gs).where(eq(gs.id, id));
        if (!row) throw AppError.notFound('Guest');
        return (await this.toGuests(tx, [row]))[0]!;
      });
    },

    async getGuest(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(gs).where(eq(gs.id, id));
        if (!row) throw AppError.notFound('Guest');
        return (await this.toGuests(tx, [row]))[0]!;
      });
    },

    // ── Bookings ──────────────────────────────────────────────────────────────────────────
    async listBookings(ctx: Ctx, q: z.infer<typeof BookingQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(bk)
          .where(
            and(
              q.unitId ? eq(bk.unitId, q.unitId) : undefined,
              q.status ? eq(bk.status, q.status) : undefined,
              q.source ? eq(bk.source, q.source) : undefined,
              q.from ? sql`${bk.checkOut} > ${q.from}::date` : undefined,
              q.to ? sql`${bk.checkIn} < ${q.to}::date` : undefined,
              after
                ? sql`(${bk.checkIn}, ${bk.id}) > (${after[0]}::date, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(asc(bk.checkIn), asc(bk.id))
          .limit(q.limit + 1);
        return page(await toBookings(tx, rows), q.limit, (b) => [b.checkIn, b.id]);
      });
    },

    async getBooking(ctx: Ctx, id: string) {
      return inTenant(
        db,
        ctx,
        async (tx) => (await toBookings(tx, [await loadBooking(tx, id)]))[0]!,
      );
    },

    async createBooking(ctx: Ctx, body: z.infer<typeof CreateBookingBody>) {
      if (body.checkOut <= body.checkIn)
        throw AppError.unprocessable('invalid_dates', 'checkOut must be after checkIn.');
      if (shortstay.nights(body.checkIn, body.checkOut) > 365)
        throw AppError.unprocessable('stay_too_long', 'Stays are limited to 365 nights.');
      if (body.guestId && body.guest)
        throw AppError.unprocessable('guest_ambiguous', 'Send guestId or guest, not both.');
      return inTenant(db, ctx, async (tx) => {
        await shortStayUnit(tx, body.unitId);
        const p = await plan(tx, body.unitId);
        const q = shortstay.quote(
          p.rules,
          p.seasons.map((s) => ({
            from: s.startsOn,
            to: s.endsOn,
            nightlyCents: s.nightlyCents,
            minStayNights: s.minStayNights,
          })),
          body.checkIn,
          body.checkOut,
        );
        if (!q.meetsMinStay && !body.allowShortStay) {
          throw AppError.unprocessable(
            'min_stay',
            `This unit needs at least ${q.minStayNights} nights for these dates.`,
          );
        }
        let guest: GuestRow | undefined;
        if (body.guestId) {
          [guest] = await tx.select().from(gs).where(eq(gs.id, body.guestId));
          if (!guest) throw AppError.notFound('Guest');
        } else if (body.guest) guest = await findOrCreateGuest(tx, ctx, body.guest);

        const ota = !collected(body.source);
        const cleaning =
          body.cleaningFeeCents !== undefined
            ? BigInt(body.cleaningFeeCents)
            : ota
              ? 0n
              : q.cleaningFeeCents;
        const gross =
          body.grossCents !== undefined
            ? BigInt(body.grossCents)
            : ota
              ? 0n
              : q.nightsTotalCents + cleaning;
        const bps = body.commissionBps ?? 0;
        const id = uuidv7();
        const [row] = await tx
          .insert(bk)
          .values({
            id,
            orgId: ctx.orgId,
            unitId: body.unitId,
            guestId: guest?.id ?? null,
            checkIn: body.checkIn,
            checkOut: body.checkOut,
            bufferDays: p.bufferDays,
            source: body.source,
            guestsCount: body.guestsCount ?? 1,
            grossCents: gross,
            cleaningFeeCents: cleaning,
            commissionBps: bps,
            commissionCents: shortstay.commissionCents(gross, bps),
            notes: body.notes || null,
            createdBy: ctx.userId ?? null,
          })
          .returning()
          .catch(overlap);
        await syncBookingLedger(tx, ctx, row!);
        if (guest?.phone) {
          const instructions = p.checkinInstructions ? ` ${p.checkinInstructions}` : '';
          await enqueueInTx(tx, {
            orgId: ctx.orgId,
            topic: 'notifications.sms',
            payload: {
              to: guest.phone,
              message:
                `Booking confirmed: ${p.unit.code}, ${body.checkIn} to ${body.checkOut} (${q.nightCount} night${q.nightCount === 1 ? '' : 's'}).${collected(body.source) && gross > 0n ? ` Total ${money.formatKes(gross)}; pay to account ${p.unit.code}.` : ''}${instructions}`.slice(
                  0,
                  900,
                ),
            },
            dedupeKey: `booking_confirmation:${id}`,
          });
        }
        await record(tx, ctx, {
          action: 'booking.created',
          entityType: 'booking',
          entityId: id,
          diff: { ...body, guest: undefined },
        });
        return (await toBookings(tx, [row!]))[0]!;
      });
    },

    async updateBooking(ctx: Ctx, id: string, body: z.infer<typeof UpdateBookingBody>) {
      return inTenant(db, ctx, async (tx) => {
        const row = await loadBooking(tx, id, true);
        if (row.status === 'cancelled' || row.status === 'no_show')
          throw AppError.conflict(
            'invalid_booking_status',
            `A ${row.status} booking cannot be changed.`,
          );
        const checkIn = body.checkIn ?? row.checkIn;
        const checkOut = body.checkOut ?? row.checkOut;
        if (checkOut <= checkIn)
          throw AppError.unprocessable('invalid_dates', 'checkOut must be after checkIn.');
        const gross = body.grossCents !== undefined ? BigInt(body.grossCents) : row.grossCents;
        const bps = body.commissionBps ?? row.commissionBps;
        const [updated] = await tx
          .update(bk)
          .set({
            checkIn,
            checkOut,
            guestsCount: body.guestsCount ?? row.guestsCount,
            grossCents: gross,
            cleaningFeeCents:
              body.cleaningFeeCents !== undefined
                ? BigInt(body.cleaningFeeCents)
                : row.cleaningFeeCents,
            commissionBps: bps,
            commissionCents: shortstay.commissionCents(gross, bps),
            guestId: body.guestId === undefined ? row.guestId : body.guestId,
            notes: body.notes === undefined ? row.notes : body.notes || null,
          })
          .where(eq(bk.id, id))
          .returning()
          .catch(overlap);
        await syncBookingLedger(tx, ctx, updated!);
        await record(tx, ctx, {
          action: 'booking.updated',
          entityType: 'booking',
          entityId: id,
          diff: body,
        });
        return (await toBookings(tx, [updated!]))[0]!;
      });
    },

    checkIn: (ctx: Ctx, id: string) =>
      transition(ctx, id, ['confirmed'], 'checked_in', { checkedInAt: clock.now() }),
    checkOut: (ctx: Ctx, id: string) =>
      transition(ctx, id, ['checked_in'], 'checked_out', { checkedOutAt: clock.now() }),
    cancel: (ctx: Ctx, id: string, reason: string) =>
      transition(ctx, id, ['confirmed'], 'cancelled', {
        cancelledAt: clock.now(),
        cancelReason: reason,
      }),
    noShow: (ctx: Ctx, id: string) => transition(ctx, id, ['confirmed'], 'no_show'),

    // ── Blocks & calendar ─────────────────────────────────────────────────────────────────
    async createBlock(ctx: Ctx, body: z.infer<typeof CreateBlockBody>) {
      if (body.endsOn <= body.startsOn)
        throw AppError.unprocessable('invalid_dates', 'endsOn must be after startsOn.');
      return inTenant(db, ctx, async (tx) => {
        await shortStayUnit(tx, body.unitId);
        const [row] = await tx
          .insert(cb)
          .values({
            id: uuidv7(),
            orgId: ctx.orgId,
            unitId: body.unitId,
            startsOn: body.startsOn,
            endsOn: body.endsOn,
            reason: body.reason,
            note: body.note || null,
            createdBy: ctx.userId ?? null,
          })
          .returning()
          .catch(overlap);
        await record(tx, ctx, {
          action: 'block.created',
          entityType: 'unit',
          entityId: body.unitId,
          diff: body,
        });
        return {
          id: row!.id,
          unitId: row!.unitId,
          startsOn: row!.startsOn,
          endsOn: row!.endsOn,
          reason: row!.reason,
          note: row!.note,
          fromIcal: false,
        };
      });
    },

    async removeBlock(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(cb).where(eq(cb.id, id));
        if (!row) throw AppError.notFound('Block');
        if (row.icalFeedId)
          throw AppError.conflict(
            'managed_by_ical',
            'This block comes from an iCal feed; change it on the source calendar.',
          );
        await tx.delete(cb).where(eq(cb.id, id));
        await record(tx, ctx, {
          action: 'block.removed',
          entityType: 'unit',
          entityId: row.unitId,
        });
      });
    },

    async calendar(
      ctx: Ctx,
      from: string,
      to: string,
      propertyId?: string,
    ): Promise<z.infer<typeof Calendar>> {
      if (to <= from || time.diffDays(from, to) > MAX_CALENDAR_DAYS) {
        throw AppError.unprocessable(
          'invalid_range',
          `Use a range of 1–${MAX_CALENDAR_DAYS} days.`,
        );
      }
      return inTenant(db, ctx, async (tx) => {
        const unitIds = await accounts.shortStayUnitIds(tx, propertyId);
        if (!unitIds.length) return { from, to, units: [] };
        const units = await accounts.unitsById(tx, unitIds);
        const bookings = await tx
          .select({ b: bk, guestName: gs.fullName })
          .from(bk)
          .leftJoin(gs, eq(gs.id, bk.guestId))
          .where(
            and(
              inArray(bk.unitId, unitIds),
              sql`${bk.status} NOT IN ('cancelled', 'no_show')`,
              sql`${bk.checkIn} < ${to}::date AND ${bk.checkOut} > ${from}::date`,
            ),
          );
        const blocks = await tx
          .select()
          .from(cb)
          .where(
            and(
              inArray(cb.unitId, unitIds),
              sql`${cb.startsOn} < ${to}::date AND ${cb.endsOn} > ${from}::date`,
            ),
          );
        return {
          from,
          to,
          units: unitIds.map((unitId) => ({
            unitId,
            unitCode: units.get(unitId)!.code,
            propertyName: units.get(unitId)!.propertyName,
            entries: [
              ...bookings
                .filter((r) => r.b.unitId === unitId)
                .map((r) => ({
                  kind: 'booking' as const,
                  id: r.b.id,
                  start: r.b.checkIn,
                  end: r.b.checkOut,
                  label:
                    r.guestName ??
                    (r.b.source === 'airbnb'
                      ? 'Airbnb guest'
                      : r.b.source === 'booking'
                        ? 'Booking.com guest'
                        : 'Booking'),
                  status: r.b.status,
                  source: r.b.source,
                })),
              ...blocks
                .filter((b) => b.unitId === unitId)
                .map((b) => ({
                  kind: 'block' as const,
                  id: b.id,
                  start: b.startsOn,
                  end: b.endsOn,
                  label: b.note ?? b.reason.replace('_', ' '),
                  status: null,
                  source: null,
                })),
            ].sort((a, b) => (a.start < b.start ? -1 : 1)),
          })),
        };
      });
    },

    // ── Expenses & profit ─────────────────────────────────────────────────────────────────
    async addExpense(ctx: Ctx, body: z.infer<typeof CreateExpenseBody>) {
      if (!body.unitId && !body.propertyId)
        throw AppError.unprocessable('target_required', 'Send a unitId or a propertyId.');
      return inTenant(db, ctx, async (tx) => {
        if (body.bookingId) {
          const b = await loadBooking(tx, body.bookingId);
          if (b.unitId !== body.unitId)
            throw AppError.unprocessable(
              'booking_unit_mismatch',
              'The booking is on another unit.',
            );
        }
        const row = await recordUnitExpense(tx, ctx, {
          unitId: body.unitId ?? null,
          propertyId: body.propertyId ?? null,
          bookingId: body.bookingId ?? null,
          incurredOn: body.incurredOn,
          category: body.category,
          amountCents: BigInt(body.amountCents),
          description: body.description || null,
        });
        await record(tx, ctx, {
          action: 'expense.created',
          entityType: 'property',
          entityId: row.propertyId,
          diff: body,
        });
        return toExpense(row);
      });
    },

    toExpense,

    async listExpenses(
      ctx: Ctx,
      q: { unitId?: string | undefined; propertyId?: string | undefined; from: string; to: string },
    ) {
      if (q.to < q.from) throw AppError.unprocessable('invalid_range', '`to` is before `from`.');
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(ex)
          .where(
            and(
              q.unitId ? eq(ex.unitId, q.unitId) : undefined,
              q.propertyId ? eq(ex.propertyId, q.propertyId) : undefined,
              sql`${ex.incurredOn} BETWEEN ${q.from}::date AND ${q.to}::date`,
            ),
          )
          .orderBy(desc(ex.incurredOn));
        return rows.map(toExpense);
      });
    },

    async removeExpense(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [found] = await tx.select().from(ex).where(eq(ex.id, id));
        if (!found) throw AppError.notFound('Expense');
        if (found.maintenanceTicketId)
          throw AppError.conflict(
            'managed_by_ticket',
            'This cost comes from a maintenance ticket; change it on the ticket.',
          );
        await tx.delete(ex).where(eq(ex.id, id));
        await record(tx, ctx, {
          action: 'expense.removed',
          entityType: 'property',
          entityId: found.propertyId,
          diff: { amountCents: found.amountCents.toString() },
        });
      });
    },

    /** Per-unit P&L for a month (gross − commission − expenses) and the channel comparison. */
    async report(
      ctx: Ctx,
      period: string,
      propertyId?: string,
    ): Promise<z.infer<typeof ShortStayReport>> {
      const start = time.monthStart(period);
      const endExcl = time.addDays(time.monthEnd(period), 1);
      return inTenant(db, ctx, async (tx) => {
        const unitIds = await accounts.shortStayUnitIds(tx, propertyId);
        const units = await accounts.unitsById(tx, unitIds);
        const bookings = unitIds.length
          ? await tx
              .select()
              .from(bk)
              .where(
                and(
                  inArray(bk.unitId, unitIds),
                  sql`${bk.status} NOT IN ('cancelled', 'no_show')`,
                  sql`${bk.checkIn} < ${endExcl}::date AND ${bk.checkOut} > ${start}::date`,
                ),
              )
          : [];
        const expenses = unitIds.length
          ? await tx
              .select({ unitId: ex.unitId, total: sql<string>`sum(${ex.amountCents})` })
              .from(ex)
              .where(
                and(
                  inArray(ex.unitId, unitIds),
                  sql`${ex.incurredOn} >= ${start}::date AND ${ex.incurredOn} < ${endExcl}::date`,
                ),
              )
              .groupBy(ex.unitId)
          : [];
        const blocks = unitIds.length
          ? await tx
              .select()
              .from(cb)
              .where(
                and(
                  inArray(cb.unitId, unitIds),
                  sql`${cb.startsOn} < ${endExcl}::date AND ${cb.endsOn} > ${start}::date`,
                ),
              )
          : [];
        const expenseBy = new Map(expenses.map((e) => [e.unitId, BigInt(e.total)]));
        const toProfit = (b: BookingRow): shortstay.ProfitBooking => ({
          checkIn: b.checkIn,
          checkOut: b.checkOut,
          grossCents: b.grossCents,
          commissionCents: b.commissionCents,
          source: b.source,
        });
        const rows = unitIds.map((unitId) => {
          const blocked = blocks
            .filter((b) => b.unitId === unitId)
            .reduce((n, b) => n + shortstay.nightsInPeriod(period, b.startsOn, b.endsOn), 0);
          const p = shortstay.monthlyProfit(
            period,
            bookings.filter((b) => b.unitId === unitId).map(toProfit),
            expenseBy.get(unitId) ?? 0n,
            blocked,
          );
          return {
            unitId,
            unitCode: units.get(unitId)!.code,
            propertyName: units.get(unitId)!.propertyName,
            ...p,
          };
        });
        const sumOf = (k: 'grossCents' | 'commissionCents' | 'expensesCents' | 'netCents') =>
          rows.reduce((s, r) => s + r[k], 0n);
        const nightsSold = rows.reduce((s, r) => s + r.nightsSold, 0);
        const availableNights = rows.reduce((s, r) => s + r.availableNights, 0);
        const gross = sumOf('grossCents');
        const toApiProfit = (p: Omit<shortstay.MonthlyProfit, 'period'>) => ({
          nightsSold: p.nightsSold,
          availableNights: p.availableNights,
          occupancyBps: p.occupancyBps,
          grossCents: api(p.grossCents),
          commissionCents: api(p.commissionCents),
          expensesCents: api(p.expensesCents),
          netCents: api(p.netCents),
          adrCents: api(p.adrCents),
          revparCents: api(p.revparCents),
        });
        // Channel comparison uses each booking's share of the month.
        const shares = bookings.map((b) => {
          const s = shortstay.bookingShare(toProfit(b), period);
          return {
            ...toProfit(b),
            grossCents: s.grossCents,
            commissionCents: s.commissionCents,
            checkIn: b.checkIn < start ? start : b.checkIn,
            checkOut: b.checkOut > endExcl ? endExcl : b.checkOut,
          };
        });
        return {
          period,
          units: rows.map(({ unitId, unitCode, propertyName, ...p }) => ({
            unitId,
            unitCode,
            propertyName,
            ...toApiProfit(p),
          })),
          totals: toApiProfit({
            nightsSold,
            availableNights,
            occupancyBps: availableNights ? Math.round((nightsSold * 10_000) / availableNights) : 0,
            grossCents: gross,
            commissionCents: sumOf('commissionCents'),
            expensesCents: sumOf('expensesCents'),
            netCents: sumOf('netCents'),
            adrCents: nightsSold ? money.divRound(gross, BigInt(nightsSold)) : 0n,
            revparCents: availableNights ? money.divRound(gross, BigInt(availableNights)) : 0n,
          }),
          channels: shortstay.channelComparison(shares).map((c) => ({
            ...c,
            source: c.source as BookingRow['source'],
            grossCents: api(c.grossCents),
            commissionCents: api(c.commissionCents),
            netCents: api(c.netCents),
          })),
        };
      });
    },

    shortStayUnit,
    syncBookingLedger,
    toBookings,
    overlap,
  };
}

export type ShortStayService = ReturnType<typeof createShortStayService>;
