import type {
  CreateLicenceBody,
  Licence,
  LicenceQuery,
  UpdateLicenceBody,
} from '@kejasha/contracts';
import { money, time, uuidv7 } from '@kejasha/core';
import { and, asc, eq, isNull, schema, type Tx } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { inTenant, type Ctx } from '../../lib/ctx';
import { assertUploadKeys, fileLinks } from '../../lib/uploads';
import * as accounts from '../accounts';

const { licence: lc } = schema;
type Row = typeof lc.$inferSelect;
const DOC = 'licence_document';
/** Licences within this many days of expiry are `expiring`. */
export const EXPIRING_DAYS = 30;

/** TRA short-stay licences, county permits and the like, with expiry tracking. */
export function createLicences(deps: AppDeps) {
  const { db, clock, storage } = deps;

  async function toDtos(tx: Tx, rows: Row[]): Promise<z.infer<typeof Licence>[]> {
    const props = await accounts.propertiesById(
      tx,
      rows.map((r) => r.propertyId),
    );
    const units = await accounts.unitsById(
      tx,
      rows.map((r) => r.unitId).filter((x): x is string => Boolean(x)),
    );
    const today = clock.today();
    return Promise.all(
      rows.map(async (r) => {
        const days = time.diffDays(today, r.expiresOn);
        return {
          id: r.id,
          propertyId: r.propertyId,
          propertyName: props.get(r.propertyId)?.name ?? '',
          unitId: r.unitId,
          unitCode: r.unitId ? (units.get(r.unitId)?.code ?? null) : null,
          kind: r.kind,
          number: r.number,
          issuer: r.issuer,
          issuedOn: r.issuedOn,
          expiresOn: r.expiresOn,
          daysToExpiry: days,
          status: days < 0 ? 'expired' : days <= EXPIRING_DAYS ? 'expiring' : 'valid',
          feeCents: r.feeCents === null ? null : money.toApiInt(r.feeCents),
          document: r.documentKey ? (await fileLinks(storage, [r.documentKey]))[0]! : null,
          notes: r.notes,
          archived: r.archivedAt !== null,
          createdAt: r.createdAt.toISOString(),
        } as const;
      }),
    );
  }

  async function load(tx: Tx, id: string) {
    const [row] = await tx.select().from(lc).where(eq(lc.id, id));
    if (!row) throw AppError.notFound('Licence');
    return row;
  }

  return {
    async list(ctx: Ctx, q: z.infer<typeof LicenceQuery>) {
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(lc)
          .where(
            and(
              q.includeArchived === 'true' ? undefined : isNull(lc.archivedAt),
              q.propertyId ? eq(lc.propertyId, q.propertyId) : undefined,
            ),
          )
          .orderBy(asc(lc.expiresOn), asc(lc.id));
        const items = await toDtos(tx, rows);
        return { items: q.status ? items.filter((i) => i.status === q.status) : items };
      });
    },

    async create(ctx: Ctx, body: z.infer<typeof CreateLicenceBody>) {
      if (!body.unitId && !body.propertyId)
        throw AppError.unprocessable('target_required', 'Send a unitId or a propertyId.');
      if (body.issuedOn && body.issuedOn > body.expiresOn)
        throw AppError.unprocessable('invalid_dates', 'issuedOn is after expiresOn.');
      if (body.documentKey) assertUploadKeys(ctx, DOC, [body.documentKey]);
      return inTenant(db, ctx, async (tx) => {
        let propertyId = body.propertyId;
        if (body.unitId) {
          const unit = (await accounts.unitsById(tx, [body.unitId])).get(body.unitId);
          if (!unit) throw AppError.notFound('Unit');
          if (propertyId && propertyId !== unit.propertyId)
            throw AppError.unprocessable(
              'unit_property_mismatch',
              'The unit is in another property.',
            );
          propertyId = unit.propertyId;
        } else if (!(await accounts.propertiesById(tx, [propertyId!])).has(propertyId!)) {
          throw AppError.notFound('Property');
        }
        const [row] = await tx
          .insert(lc)
          .values({
            id: uuidv7(),
            orgId: ctx.orgId,
            propertyId: propertyId!,
            unitId: body.unitId ?? null,
            kind: body.kind,
            number: body.number || null,
            issuer: body.issuer || null,
            issuedOn: body.issuedOn ?? null,
            expiresOn: body.expiresOn,
            feeCents: body.feeCents === undefined ? null : BigInt(body.feeCents),
            documentKey: body.documentKey ?? null,
            notes: body.notes || null,
          })
          .returning();
        await record(tx, ctx, {
          action: 'licence.created',
          entityType: 'licence',
          entityId: row!.id,
          diff: body,
        });
        return (await toDtos(tx, [row!]))[0]!;
      });
    },

    async update(ctx: Ctx, id: string, body: z.infer<typeof UpdateLicenceBody>) {
      if (body.documentKey) assertUploadKeys(ctx, DOC, [body.documentKey]);
      return inTenant(db, ctx, async (tx) => {
        const row = await load(tx, id);
        const set: Partial<typeof lc.$inferInsert> = {};
        if (body.number !== undefined) set.number = body.number || null;
        if (body.issuer !== undefined) set.issuer = body.issuer || null;
        if (body.issuedOn !== undefined) set.issuedOn = body.issuedOn;
        if (body.expiresOn !== undefined) set.expiresOn = body.expiresOn;
        if (body.feeCents !== undefined)
          set.feeCents = body.feeCents === null ? null : BigInt(body.feeCents);
        if (body.documentKey !== undefined) set.documentKey = body.documentKey;
        if (body.notes !== undefined) set.notes = body.notes || null;
        const issued = set.issuedOn !== undefined ? set.issuedOn : row.issuedOn;
        const expires = set.expiresOn ?? row.expiresOn;
        if (issued && issued > expires)
          throw AppError.unprocessable('invalid_dates', 'issuedOn is after expiresOn.');
        const [updated] = Object.keys(set).length
          ? await tx.update(lc).set(set).where(eq(lc.id, id)).returning()
          : [row];
        await record(tx, ctx, {
          action: 'licence.updated',
          entityType: 'licence',
          entityId: id,
          diff: body,
        });
        return (await toDtos(tx, [updated!]))[0]!;
      });
    },

    async archive(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        await load(tx, id);
        await tx.update(lc).set({ archivedAt: clock.now() }).where(eq(lc.id, id));
        await record(tx, ctx, { action: 'licence.archived', entityType: 'licence', entityId: id });
      });
    },

    /** Live licences expiring exactly `days` from `today` (reminder stages). */
    async expiringOn(ctx: Ctx, today: string, days: number) {
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(lc)
          .where(and(isNull(lc.archivedAt), eq(lc.expiresOn, time.addDays(today, days))));
        return toDtos(tx, rows);
      });
    },
  };
}

export type Licences = ReturnType<typeof createLicences>;
