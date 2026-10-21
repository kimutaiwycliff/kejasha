import type {
  BulkReadingsBody,
  CreateMeterBody,
  CreateReadingBody,
  MeterReading,
} from '@kejasha/contracts';
import { billing, uuidv7 } from '@kejasha/core';
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNull,
  PG,
  pgError,
  schema,
  sql,
  type Tx,
} from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import * as accounts from '../accounts';

const { meter: mt, meterReading: mr } = schema;
type ReadingDto = z.infer<typeof MeterReading>;

/** Meters and readings. Caretakers may read and record only for properties assigned to them. */
export function createMeterService(deps: AppDeps) {
  const { db } = deps;

  async function assertUnitAccess(tx: Tx, ctx: Ctx, unitId: string) {
    const unit = (await accounts.unitsById(tx, [unitId])).get(unitId);
    if (!unit) throw AppError.notFound('Unit');
    if (
      ctx.role === 'caretaker' &&
      !(await accounts.assignedPropertyIds(tx, ctx.userId!)).has(unit.propertyId)
    ) {
      throw AppError.notFound('Unit');
    }
    return unit;
  }

  async function loadMeter(tx: Tx, ctx: Ctx, meterId: string) {
    const [m] = await tx.select().from(mt).where(eq(mt.id, meterId));
    if (!m) throw AppError.notFound('Meter');
    const unit = await assertUnitAccess(tx, ctx, m.unitId).catch(() => {
      throw AppError.notFound('Meter');
    });
    return { meter: m, unit };
  }

  function toReading(r: typeof mr.$inferSelect, previous: string | null): ReadingDto {
    return {
      id: r.id,
      meterId: r.meterId,
      readOn: r.readOn,
      reading: billing.fromMilli(billing.toMilli(r.reading)),
      consumptionSincePrevious:
        previous === null
          ? null
          : billing.fromMilli(billing.toMilli(r.reading) - billing.toMilli(previous)),
      note: r.note,
      createdAt: r.createdAt.toISOString(),
    };
  }

  async function lastReadings(tx: Tx, meterIds: string[]) {
    if (!meterIds.length) return new Map<string, ReadingDto>();
    const rows = await tx
      .selectDistinctOn([mr.meterId])
      .from(mr)
      .where(inArray(mr.meterId, meterIds))
      .orderBy(mr.meterId, desc(mr.readOn));
    return new Map(rows.map((r) => [r.meterId, toReading(r, null)]));
  }

  async function insertReading(
    tx: Tx,
    ctx: Ctx,
    meterId: string,
    body: { readOn: string; reading: string; note?: string | undefined },
  ) {
    const value = billing.toMilli(body.reading);
    const [prev] = await tx
      .select()
      .from(mr)
      .where(and(eq(mr.meterId, meterId), sql`${mr.readOn} < ${body.readOn}`))
      .orderBy(desc(mr.readOn))
      .limit(1);
    const [next] = await tx
      .select()
      .from(mr)
      .where(and(eq(mr.meterId, meterId), sql`${mr.readOn} > ${body.readOn}`))
      .orderBy(asc(mr.readOn))
      .limit(1);
    if (prev && billing.toMilli(prev.reading) > value) {
      throw AppError.unprocessable(
        'reading_decreased',
        `The reading is lower than ${prev.reading} recorded on ${prev.readOn}.`,
      );
    }
    if (next && billing.toMilli(next.reading) < value) {
      throw AppError.unprocessable(
        'reading_decreased',
        `The reading is higher than ${next.reading} recorded later on ${next.readOn}.`,
      );
    }
    const [row] = await tx
      .insert(mr)
      .values({
        id: uuidv7(),
        orgId: ctx.orgId,
        meterId,
        readOn: body.readOn,
        reading: body.reading,
        note: body.note || null,
        recordedBy: ctx.userId ?? null,
      })
      .returning()
      .catch((err: unknown) => {
        if (pgError(err)?.code === PG.uniqueViolation)
          throw AppError.conflict('reading_exists', `A reading for ${body.readOn} already exists.`);
        throw err;
      });
    return toReading(row!, prev?.reading ?? null);
  }

  return {
    async listUnitMeters(ctx: Ctx, unitId: string) {
      return inTenant(db, ctx, async (tx) => {
        const unit = await assertUnitAccess(tx, ctx, unitId);
        const rows = await tx
          .select()
          .from(mt)
          .where(and(eq(mt.unitId, unitId), isNull(mt.archivedAt)))
          .orderBy(asc(mt.kind));
        const last = await lastReadings(
          tx,
          rows.map((r) => r.id),
        );
        return rows.map((m) => ({
          id: m.id,
          unitId: m.unitId,
          unitCode: unit.code,
          kind: m.kind,
          serial: m.serial,
          unitLabel: m.unitLabel,
          lastReading: last.get(m.id) ?? null,
          archivedAt: m.archivedAt?.toISOString() ?? null,
        }));
      });
    },

    async createMeter(ctx: Ctx, unitId: string, body: z.infer<typeof CreateMeterBody>) {
      await inTenant(db, ctx, async (tx) => {
        const unit = await assertUnitAccess(tx, ctx, unitId);
        if (unit.archived)
          throw AppError.unprocessable('unit_unavailable', 'The unit is archived.');
        const id = uuidv7();
        await tx
          .insert(mt)
          .values({
            id,
            orgId: ctx.orgId,
            unitId,
            kind: body.kind,
            serial: body.serial || null,
            unitLabel: body.unitLabel || (body.kind === 'water' ? 'm³' : 'kWh'),
          })
          .catch((err: unknown) => {
            if (pgError(err)?.code === PG.uniqueViolation)
              throw AppError.conflict(
                'meter_exists',
                `The unit already has an active ${body.kind} meter.`,
              );
            throw err;
          });
        if (body.initialReading) await insertReading(tx, ctx, id, body.initialReading);
        await record(tx, ctx, {
          action: 'meter.created',
          entityType: 'meter',
          entityId: id,
          diff: body,
        });
      });
      return this.listUnitMeters(ctx, unitId);
    },

    async listReadings(ctx: Ctx, meterId: string) {
      return inTenant(db, ctx, async (tx) => {
        await loadMeter(tx, ctx, meterId);
        const rows = await tx
          .select()
          .from(mr)
          .where(eq(mr.meterId, meterId))
          .orderBy(desc(mr.readOn))
          .limit(120);
        return rows.map((r, i) => toReading(r, rows[i + 1]?.reading ?? null));
      });
    },

    async addReading(ctx: Ctx, meterId: string, body: z.infer<typeof CreateReadingBody>) {
      return inTenant(db, ctx, async (tx) => {
        const { meter } = await loadMeter(tx, ctx, meterId);
        if (meter.archivedAt)
          throw AppError.unprocessable('meter_archived', 'The meter is archived.');
        const reading = await insertReading(tx, ctx, meterId, body);
        await record(tx, ctx, {
          action: 'meter.reading_added',
          entityType: 'meter',
          entityId: meterId,
          diff: body,
        });
        return reading;
      });
    },

    /** Each item in its own transaction so one bad reading never blocks a caretaker's batch. */
    async addReadingsBulk(ctx: Ctx, body: z.infer<typeof BulkReadingsBody>) {
      const items = [];
      for (const item of body.items) {
        try {
          const reading = await this.addReading(ctx, item.meterId, item);
          items.push({
            meterId: item.meterId,
            readOn: item.readOn,
            status: 'applied' as const,
            reading,
            errorCode: null,
          });
        } catch (err) {
          if (!(err instanceof AppError)) throw err;
          items.push({
            meterId: item.meterId,
            readOn: item.readOn,
            status: 'rejected' as const,
            reading: null,
            errorCode: err.code,
          });
        }
      }
      return { items };
    },
  };
}

export type MeterService = ReturnType<typeof createMeterService>;
