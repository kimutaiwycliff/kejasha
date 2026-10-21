import type { CreateIcalFeedBody, IcalFeed, IcalSyncResult } from '@kejasha/contracts';
import { time, uuidv7 } from '@kejasha/core';
import { and, eq, inArray, PG, pgError, schema, sql, type Tx } from '@kejasha/db';
import {
  assertPublicUrl,
  fetchFeed,
  IcalError,
  parseIcal,
  type IcalEvent,
} from '@kejasha/integrations-ical';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import type { ShortStayService } from './service';

const { icalFeed: feed, booking: bk, calendarBlock: cb } = schema;
type FeedRow = typeof feed.$inferSelect;
type Conflict = FeedRow['conflicts'][number];

/** Feed URLs carry a secret token: only ever show the host and the last few characters. */
function urlHint(url: string) {
  try {
    const u = new URL(url);
    return `${u.host}/…${url.slice(-4)}`;
  } catch {
    return '…';
  }
}

function toDto(r: FeedRow): z.infer<typeof IcalFeed> {
  return {
    id: r.id,
    unitId: r.unitId,
    source: r.source,
    urlHint: urlHint(r.url),
    enabled: r.enabled,
    lastSyncedAt: r.lastSyncedAt?.toISOString() ?? null,
    lastStatus: r.lastStatus,
    lastError: r.lastError,
    conflicts: r.conflicts,
  };
}

/** Events further out than this are ignored (feeds often publish a year or more of blocks). */
const HORIZON_DAYS = 730;

/**
 * Read-only iCal import (ADR-010). Each event becomes a booking (reservations) or a calendar
 * block (owner/"not available"), keyed by feed + UID. Every write runs in its own savepoint so an
 * event that collides with a booking we already have is recorded as a conflict instead of failing
 * the sync — the database exclusion stays the only judge of overlaps (ADR-007).
 */
export function createIcalSync(deps: AppDeps, service: ShortStayService) {
  const { db, config, clock } = deps;
  const fetchOpts = { allowPrivate: config.ical.allowPrivateHosts };

  async function apply(tx: Tx, ctx: Ctx, f: FeedRow, events: IcalEvent[]) {
    const today = clock.today();
    const horizon = time.addDays(today, HORIZON_DAYS);
    const live = events.filter(
      (e) => !e.cancelled && e.end > today && e.start < horizon && e.end > e.start,
    );
    const seen = new Set(live.map((e) => e.uid));
    const conflicts: Conflict[] = [];
    let added = 0;
    let updated = 0;
    let removed = 0;

    const existingBookings = await tx.select().from(bk).where(eq(bk.icalFeedId, f.id));
    const existingBlocks = await tx.select().from(cb).where(eq(cb.icalFeedId, f.id));
    const bookingByUid = new Map(existingBookings.map((b) => [b.externalUid!, b]));
    const blockByUid = new Map(existingBlocks.map((b) => [b.externalUid!, b]));

    for (const e of live) {
      try {
        await tx.transaction(async (sp) => {
          const b = bookingByUid.get(e.uid);
          const k = blockByUid.get(e.uid);
          if (b) {
            if (b.status === 'cancelled' || b.status === 'no_show') {
              const [row] = await sp
                .update(bk)
                .set({
                  status: 'confirmed',
                  cancelledAt: null,
                  cancelReason: null,
                  checkIn: e.start,
                  checkOut: e.end,
                })
                .where(eq(bk.id, b.id))
                .returning();
              await service.syncBookingLedger(sp, ctx, row!);
              updated++;
            } else if (b.checkIn !== e.start || b.checkOut !== e.end) {
              await sp.update(bk).set({ checkIn: e.start, checkOut: e.end }).where(eq(bk.id, b.id));
              updated++;
            }
          } else if (k) {
            if (k.startsOn !== e.start || k.endsOn !== e.end) {
              await sp.update(cb).set({ startsOn: e.start, endsOn: e.end }).where(eq(cb.id, k.id));
              updated++;
            }
          } else if (e.kind === 'booking') {
            await sp.insert(bk).values({
              id: uuidv7(),
              orgId: ctx.orgId,
              unitId: f.unitId,
              checkIn: e.start,
              checkOut: e.end,
              bufferDays: 0, // the channel applies its own preparation time
              source: f.source,
              grossCents: 0n, // payout amounts are not in the feed; the host can fill them in
              cleaningFeeCents: 0n,
              commissionCents: 0n,
              notes: e.summary.slice(0, 500) || null,
              icalFeedId: f.id,
              externalUid: e.uid,
            });
            added++;
          } else {
            await sp.insert(cb).values({
              id: uuidv7(),
              orgId: ctx.orgId,
              unitId: f.unitId,
              startsOn: e.start,
              endsOn: e.end,
              reason: 'ical',
              note: e.summary.slice(0, 200) || null,
              icalFeedId: f.id,
              externalUid: e.uid,
            });
            added++;
          }
        });
      } catch (err) {
        if (pgError(err)?.code !== PG.exclusionViolation) throw err;
        conflicts.push({
          uid: e.uid.slice(0, 200),
          start: e.start,
          end: e.end,
          summary: e.summary.slice(0, 200),
        });
      }
    }

    // Gone from the feed: future imported bookings are cancelled (kept for history), blocks deleted.
    const goneBookings = existingBookings.filter(
      (b) => !seen.has(b.externalUid!) && b.status === 'confirmed' && b.checkOut > today,
    );
    if (goneBookings.length) {
      const rows = await tx
        .update(bk)
        .set({
          status: 'cancelled',
          cancelledAt: clock.now(),
          cancelReason: 'Removed from the iCal feed',
        })
        .where(
          inArray(
            bk.id,
            goneBookings.map((b) => b.id),
          ),
        )
        .returning();
      // Anything billed for these stays is reversed, exactly as a manual cancel would.
      for (const row of rows) await service.syncBookingLedger(tx, ctx, row);
      removed += goneBookings.length;
    }
    const goneBlocks = existingBlocks.filter((b) => !seen.has(b.externalUid!) && b.endsOn > today);
    if (goneBlocks.length) {
      await tx.delete(cb).where(
        inArray(
          cb.id,
          goneBlocks.map((b) => b.id),
        ),
      );
      removed += goneBlocks.length;
    }
    return { added, updated, removed, conflicts };
  }

  async function loadFeed(tx: Tx, id: string) {
    const [row] = await tx.select().from(feed).where(eq(feed.id, id));
    if (!row) throw AppError.notFound('iCal feed');
    return row;
  }

  async function sync(ctx: Ctx, feedId: string): Promise<z.infer<typeof IcalSyncResult>> {
    const f = await inTenant(db, ctx, (tx) => loadFeed(tx, feedId));
    let fetched;
    try {
      fetched = await fetchFeed(f.url, { etag: f.etag, lastModified: f.lastModified }, fetchOpts);
    } catch (err) {
      const message =
        err instanceof IcalError
          ? err.message
          : `The feed could not be fetched (${(err as Error).name}).`;
      await inTenant(db, ctx, (tx) =>
        tx
          .update(feed)
          .set({ lastStatus: 'error', lastError: message.slice(0, 300), lastSyncedAt: sql`now()` })
          .where(eq(feed.id, f.id)),
      );
      return {
        feedId,
        status: 'error',
        added: 0,
        updated: 0,
        removed: 0,
        conflicts: f.conflicts.length,
        error: message,
      };
    }
    if (fetched.notModified) {
      await inTenant(db, ctx, (tx) =>
        tx
          .update(feed)
          .set({ lastStatus: 'not_modified', lastError: null, lastSyncedAt: sql`now()` })
          .where(eq(feed.id, f.id)),
      );
      return {
        feedId,
        status: 'not_modified',
        added: 0,
        updated: 0,
        removed: 0,
        conflicts: f.conflicts.length,
        error: null,
      };
    }
    let events: IcalEvent[];
    try {
      events = parseIcal(fetched.body ?? '');
    } catch (err) {
      const message = err instanceof IcalError ? err.message : 'The feed is not a valid calendar.';
      await inTenant(db, ctx, (tx) =>
        tx
          .update(feed)
          .set({ lastStatus: 'error', lastError: message.slice(0, 300), lastSyncedAt: sql`now()` })
          .where(eq(feed.id, f.id)),
      );
      return {
        feedId,
        status: 'error',
        added: 0,
        updated: 0,
        removed: 0,
        conflicts: f.conflicts.length,
        error: message,
      };
    }
    return inTenant(db, ctx, async (tx) => {
      // Serialise syncs of the same feed (the cron and a manual "sync now" may race).
      const [locked] = await tx.select().from(feed).where(eq(feed.id, f.id)).for('update');
      if (!locked) throw AppError.notFound('iCal feed');
      const r = await apply(tx, ctx, locked, events);
      await tx
        .update(feed)
        .set({
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          lastStatus: 'ok',
          lastError: null,
          lastSyncedAt: sql`now()`,
          conflicts: r.conflicts,
        })
        .where(eq(feed.id, f.id));
      if (r.added || r.updated || r.removed || r.conflicts.length) {
        await record(tx, ctx, {
          action: 'ical.synced',
          entityType: 'ical_feed',
          entityId: f.id,
          diff: {
            added: r.added,
            updated: r.updated,
            removed: r.removed,
            conflicts: r.conflicts.length,
          },
        });
      }
      return {
        feedId,
        status: 'ok' as const,
        added: r.added,
        updated: r.updated,
        removed: r.removed,
        conflicts: r.conflicts.length,
        error: null,
      };
    });
  }

  return {
    async create(ctx: Ctx, body: z.infer<typeof CreateIcalFeedBody>) {
      try {
        await assertPublicUrl(body.url, fetchOpts);
      } catch (err) {
        if (err instanceof IcalError) throw AppError.unprocessable('invalid_feed_url', err.message);
        throw err;
      }
      return inTenant(db, ctx, async (tx) => {
        await service.shortStayUnit(tx, body.unitId);
        const [dup] = await tx
          .select({ id: feed.id })
          .from(feed)
          .where(and(eq(feed.unitId, body.unitId), eq(feed.url, body.url)));
        if (dup)
          throw AppError.conflict('feed_exists', 'This feed is already connected to the unit.');
        const [row] = await tx
          .insert(feed)
          .values({
            id: uuidv7(),
            orgId: ctx.orgId,
            unitId: body.unitId,
            source: body.source,
            url: body.url,
            conflicts: [],
          })
          .returning();
        await record(tx, ctx, {
          action: 'ical.created',
          entityType: 'ical_feed',
          entityId: row!.id,
          diff: { unitId: body.unitId, source: body.source },
        });
        return toDto(row!);
      });
    },

    async list(ctx: Ctx, unitId?: string) {
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(feed)
          .where(unitId ? eq(feed.unitId, unitId) : undefined)
          .orderBy(feed.createdAt);
        return rows.map(toDto);
      });
    },

    async setEnabled(ctx: Ctx, id: string, enabled: boolean) {
      return inTenant(db, ctx, async (tx) => {
        await loadFeed(tx, id);
        const [row] = await tx.update(feed).set({ enabled }).where(eq(feed.id, id)).returning();
        await record(tx, ctx, {
          action: enabled ? 'ical.enabled' : 'ical.disabled',
          entityType: 'ical_feed',
          entityId: id,
        });
        return toDto(row!);
      });
    },

    /** Disconnecting deletes the feed's blocks; imported bookings stay (they are real stays). */
    async remove(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        await loadFeed(tx, id);
        await tx.delete(feed).where(eq(feed.id, id));
        await record(tx, ctx, { action: 'ical.removed', entityType: 'ical_feed', entityId: id });
      });
    },

    sync,

    /** Worker job: every enabled feed of the org; one feed failing never stops the rest. */
    async syncAll(ctx: Ctx) {
      const feeds = await inTenant(db, ctx, (tx) =>
        tx.select({ id: feed.id }).from(feed).where(eq(feed.enabled, true)),
      );
      const results: z.infer<typeof IcalSyncResult>[] = [];
      for (const { id } of feeds) results.push(await sync(ctx, id));
      return results;
    },
  };
}

export type IcalSync = ReturnType<typeof createIcalSync>;
