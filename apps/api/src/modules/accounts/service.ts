import type { Role } from '@kejasha/auth';
import type {
  BulkCreateUnitsBody,
  ClientLandlord,
  ClientLandlordQuery,
  CreateClientLandlordBody,
  CreatePropertyBody,
  CreateUnitBody,
  Property,
  PropertyDetail,
  PropertyQuery,
  StaffAssignment,
  Unit,
  UnitQuery,
  UpdateClientLandlordBody,
  UpdatePropertyBody,
  UpdateUnitBody,
} from '@kejasha/contracts';
import { FEE_RULE, feeConsistent, PRICE_RULE, priceForMode } from '@kejasha/contracts';
import { money, uuidv7 } from '@kejasha/core';
import {
  and,
  asc,
  eq,
  inArray,
  isNull,
  PG,
  pgError,
  schema,
  sql,
  type SQL,
  type Tx,
} from '@kejasha/db';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { audit } from '../../lib/audit';
import type { OrgCreatedHook } from '../../lib/org-hooks';
import { decodeCursor, page } from '../../lib/pagination';

const { clientLandlord: cl, property: pr, unit: un, propertyStaff: ps } = schema;

type ClientLandlordDto = z.infer<typeof ClientLandlord>;
type PropertyDto = z.infer<typeof Property>;
type UnitDto = z.infer<typeof Unit>;

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const cents = (v: bigint | null) => (v === null ? null : money.toApiInt(v));
const toCents = (v: number | null | undefined) =>
  v === undefined ? undefined : v === null ? null : BigInt(v);
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export interface StaffDirectory {
  /** user id → role in the org (only members are returned). */
  memberRoles(orgId: string, userIds: string[]): Promise<Map<string, Role>>;
  /** user id → display name / phone. */
  users(userIds: string[]): Promise<Map<string, { name: string; phone: string | null }>>;
}

export function createAccountsService(_deps: AppDeps, staff: StaffDirectory) {
  // Correlated subqueries are written with explicit table-qualified SQL: Drizzle renders column
  // references unqualified in single-table selects, which would silently bind to the inner table.

  /** Caretakers only see properties they are assigned to (ADR-005 row filter on top of RLS). */
  function propertyScope(req: FastifyRequest): SQL | undefined {
    if (req.actor?.role !== 'caretaker') return undefined;
    return sql`property.id IN (SELECT s.property_id FROM property_staff s WHERE s.user_id = ${req.actor.userId})`;
  }

  // ── Client landlords ─────────────────────────────────────────────────────────────────────
  const propertyCount = sql<number>`(SELECT count(*)::int FROM property p WHERE p.client_landlord_id = client_landlord.id AND p.archived_at IS NULL)`;

  function toClientLandlord(row: typeof cl.$inferSelect, count: number): ClientLandlordDto {
    return {
      id: row.id,
      name: row.name,
      isSelf: row.isSelf,
      phone: row.phone,
      email: row.email,
      kraPin: row.kraPin,
      mgmtFeeKind: row.mgmtFeeKind,
      mgmtFeeBps: row.mgmtFeeBps,
      mgmtFeeFlatCents: cents(row.mgmtFeeFlatCents),
      notes: row.notes,
      propertyCount: count,
      archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function loadClientLandlord(tx: Tx, id: string): Promise<ClientLandlordDto> {
    const [row] = await tx.select({ row: cl, count: propertyCount }).from(cl).where(eq(cl.id, id));
    if (!row) throw AppError.notFound('Client landlord');
    return toClientLandlord(row.row, row.count);
  }

  async function activeClientLandlord(tx: Tx, id: string | undefined) {
    const [row] = await tx
      .select()
      .from(cl)
      .where(id ? eq(cl.id, id) : eq(cl.isSelf, true));
    if (!row)
      throw id
        ? AppError.notFound('Client landlord')
        : new AppError(500, 'self_landlord_missing', 'Org is missing its own landlord');
    if (row.archivedAt)
      throw AppError.unprocessable('client_landlord_archived', 'That client landlord is archived.');
    return row;
  }

  // ── Properties ───────────────────────────────────────────────────────────────────────────
  const countsSql = sql<{ total: number; longTerm: number; shortStay: number }>`(
    SELECT json_build_object(
      'total', count(*)::int,
      'longTerm', (count(*) FILTER (WHERE u.mode = 'long_term'))::int,
      'shortStay', (count(*) FILTER (WHERE u.mode = 'short_stay'))::int)
    FROM unit u WHERE u.property_id = property.id AND u.archived_at IS NULL)`;

  function toProperty(
    row: typeof pr.$inferSelect,
    landlordName: string,
    counts: PropertyDto['unitCounts'],
  ): PropertyDto {
    return {
      id: row.id,
      clientLandlordId: row.clientLandlordId,
      clientLandlordName: landlordName,
      name: row.name,
      kind: row.kind,
      county: row.county as PropertyDto['county'],
      area: row.area,
      address: row.address,
      latitude: row.latitude,
      longitude: row.longitude,
      notes: row.notes,
      unitCounts: counts,
      archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function loadProperty(req: FastifyRequest, tx: Tx, id: string): Promise<PropertyDto> {
    const [row] = await tx
      .select({ row: pr, landlordName: cl.name, counts: countsSql })
      .from(pr)
      .innerJoin(cl, eq(cl.id, pr.clientLandlordId))
      .where(and(eq(pr.id, id), propertyScope(req)));
    if (!row) throw AppError.notFound('Property');
    return toProperty(row.row, row.landlordName, row.counts);
  }

  async function staffOf(
    req: FastifyRequest,
    tx: Tx,
    propertyId: string,
  ): Promise<z.infer<typeof StaffAssignment>[]> {
    const rows = await tx
      .select({ userId: ps.userId })
      .from(ps)
      .where(eq(ps.propertyId, propertyId));
    const ids = rows.map((r) => r.userId);
    const [roles, users] = await Promise.all([
      staff.memberRoles(req.actor!.orgId!, ids),
      staff.users(ids),
    ]);
    return ids
      .filter((id) => roles.has(id))
      .map((id) => ({
        userId: id,
        name: users.get(id)?.name ?? '',
        phone: users.get(id)?.phone ?? null,
        role: roles.get(id)!,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function activeProperty(req: FastifyRequest, tx: Tx, id: string) {
    const [row] = await tx
      .select()
      .from(pr)
      .where(and(eq(pr.id, id), propertyScope(req)));
    if (!row) throw AppError.notFound('Property');
    if (row.archivedAt)
      throw AppError.unprocessable('property_archived', 'That property is archived.');
    return row;
  }

  // ── Units ────────────────────────────────────────────────────────────────────────────────
  function toUnit(row: typeof un.$inferSelect, propertyName: string): UnitDto {
    return {
      id: row.id,
      propertyId: row.propertyId,
      propertyName,
      code: row.code,
      label: row.label,
      mode: row.mode,
      status: row.status,
      bedrooms: row.bedrooms,
      bathrooms: row.bathrooms,
      floor: row.floor,
      sizeSqm: row.sizeSqm,
      rentCents: cents(row.rentCents),
      depositCents: cents(row.depositCents),
      baseNightlyCents: cents(row.baseNightlyCents),
      maxGuests: row.maxGuests,
      notes: row.notes,
      archivedAt: iso(row.archivedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async function loadUnit(req: FastifyRequest, tx: Tx, id: string): Promise<UnitDto> {
    const [row] = await tx
      .select({ row: un, propertyName: pr.name })
      .from(un)
      .innerJoin(pr, eq(pr.id, un.propertyId))
      .where(and(eq(un.id, id), propertyScope(req)));
    if (!row) throw AppError.notFound('Unit');
    return toUnit(row.row, row.propertyName);
  }

  function unitCodeTaken(err: unknown, code?: string): never {
    const pg = pgError(err);
    if (pg?.code === PG.uniqueViolation && pg.constraint === 'unit_org_id_code_key') {
      throw AppError.conflict(
        'unit_code_taken',
        code
          ? `Unit code ${code} is already used in this organization.`
          : 'A unit code is already used in this organization.',
      );
    }
    throw err;
  }

  function assertFee(body: Parameters<typeof feeConsistent>[0]) {
    if (!feeConsistent(body)) throw AppError.unprocessable('invalid_management_fee', FEE_RULE);
  }
  function assertPrice(body: Parameters<typeof priceForMode>[0]) {
    if (!priceForMode(body)) throw AppError.unprocessable('unit_price_required', PRICE_RULE);
  }

  const unitDetails = (b: Partial<z.infer<typeof CreateUnitBody>>) => ({
    label: b.label,
    bedrooms: b.bedrooms,
    bathrooms: b.bathrooms,
    floor: b.floor,
    sizeSqm: b.sizeSqm,
    rentCents: toCents(b.rentCents),
    depositCents: toCents(b.depositCents),
    baseNightlyCents: toCents(b.baseNightlyCents),
    maxGuests: b.maxGuests,
    notes: b.notes,
  });

  return {
    /** Org bootstrap hook (ADR-005): every org has exactly one `self` client landlord. */
    onOrgCreated: (async (tx, ctx) => {
      await tx.insert(cl).values({ id: uuidv7(), orgId: ctx.orgId, isSelf: true, name: ctx.name });
    }) satisfies OrgCreatedHook,

    /** Drop a removed member's property assignments. */
    async onMemberRemoved(tx: Tx, userId: string) {
      await tx.delete(ps).where(eq(ps.userId, userId));
    },

    // Client landlords
    async listClientLandlords(req: FastifyRequest, q: z.infer<typeof ClientLandlordQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return req.tenant(async (tx) => {
        const rows = await tx
          .select({ row: cl, count: propertyCount })
          .from(cl)
          .where(
            and(
              q.includeArchived ? undefined : isNull(cl.archivedAt),
              q.q ? sql`${cl.name} ILIKE ${like(q.q)}` : undefined,
              after
                ? sql`(lower(${cl.name}), ${cl.id}) > (${after[0]}, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(sql`lower(${cl.name})`, asc(cl.id))
          .limit(q.limit + 1);
        return page(
          rows.map((r) => toClientLandlord(r.row, r.count)),
          q.limit,
          (r) => [r.name.toLowerCase(), r.id],
        );
      });
    },

    getClientLandlord: (req: FastifyRequest, id: string) =>
      req.tenant((tx) => loadClientLandlord(tx, id)),

    async createClientLandlord(
      req: FastifyRequest,
      body: z.infer<typeof CreateClientLandlordBody>,
    ) {
      assertFee(body);
      return req.tenant(async (tx) => {
        const id = uuidv7();
        await tx.insert(cl).values({
          id,
          orgId: req.actor!.orgId!,
          name: body.name,
          phone: body.phone ?? null,
          email: body.email ?? null,
          kraPin: body.kraPin ?? null,
          mgmtFeeKind: body.mgmtFeeKind,
          mgmtFeeBps: body.mgmtFeeBps ?? null,
          mgmtFeeFlatCents: toCents(body.mgmtFeeFlatCents) ?? null,
          notes: body.notes ?? null,
        });
        await audit(tx, req, {
          action: 'client_landlord.created',
          entityType: 'client_landlord',
          entityId: id,
          diff: body,
        });
        return loadClientLandlord(tx, id);
      });
    },

    async updateClientLandlord(
      req: FastifyRequest,
      id: string,
      body: z.infer<typeof UpdateClientLandlordBody>,
    ) {
      assertFee(body);
      return req.tenant(async (tx) => {
        await loadClientLandlord(tx, id);
        const fee =
          body.mgmtFeeKind === undefined
            ? {}
            : {
                mgmtFeeKind: body.mgmtFeeKind,
                mgmtFeeBps: body.mgmtFeeBps ?? null,
                mgmtFeeFlatCents: toCents(body.mgmtFeeFlatCents) ?? null,
              };
        const { mgmtFeeKind: _k, mgmtFeeBps: _b, mgmtFeeFlatCents: _f, ...rest } = body;
        const set = { ...rest, ...fee };
        if (Object.keys(set).length) await tx.update(cl).set(set).where(eq(cl.id, id));
        await audit(tx, req, {
          action: 'client_landlord.updated',
          entityType: 'client_landlord',
          entityId: id,
          diff: body,
        });
        return loadClientLandlord(tx, id);
      });
    },

    async archiveClientLandlord(req: FastifyRequest, id: string) {
      return req.tenant(async (tx) => {
        const current = await loadClientLandlord(tx, id);
        if (current.isSelf)
          throw AppError.conflict(
            'cannot_archive_self',
            "The organization's own landlord cannot be archived.",
          );
        if (current.propertyCount > 0)
          throw AppError.conflict('has_active_properties', 'Archive or move its properties first.');
        if (!current.archivedAt)
          await tx
            .update(cl)
            .set({ archivedAt: sql`now()` })
            .where(eq(cl.id, id));
        await audit(tx, req, {
          action: 'client_landlord.archived',
          entityType: 'client_landlord',
          entityId: id,
        });
        return loadClientLandlord(tx, id);
      });
    },

    // Properties
    async listProperties(req: FastifyRequest, q: z.infer<typeof PropertyQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return req.tenant(async (tx) => {
        const rows = await tx
          .select({ row: pr, landlordName: cl.name, counts: countsSql })
          .from(pr)
          .innerJoin(cl, eq(cl.id, pr.clientLandlordId))
          .where(
            and(
              propertyScope(req),
              q.includeArchived ? undefined : isNull(pr.archivedAt),
              q.clientLandlordId ? eq(pr.clientLandlordId, q.clientLandlordId) : undefined,
              q.q
                ? sql`(${pr.name} ILIKE ${like(q.q)} OR ${pr.area} ILIKE ${like(q.q)})`
                : undefined,
              after
                ? sql`(lower(${pr.name}), ${pr.id}) > (${after[0]}, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(sql`lower(${pr.name})`, asc(pr.id))
          .limit(q.limit + 1);
        return page(
          rows.map((r) => toProperty(r.row, r.landlordName, r.counts)),
          q.limit,
          (r) => [r.name.toLowerCase(), r.id],
        );
      });
    },

    async getProperty(req: FastifyRequest, id: string): Promise<z.infer<typeof PropertyDetail>> {
      return req.tenant(async (tx) => ({
        ...(await loadProperty(req, tx, id)),
        staff: await staffOf(req, tx, id),
      }));
    },

    async createProperty(req: FastifyRequest, body: z.infer<typeof CreatePropertyBody>) {
      return req.tenant(async (tx) => {
        const landlord = await activeClientLandlord(tx, body.clientLandlordId);
        const id = uuidv7();
        await tx.insert(pr).values({
          id,
          orgId: req.actor!.orgId!,
          clientLandlordId: landlord.id,
          name: body.name,
          kind: body.kind,
          county: body.county,
          area: body.area ?? null,
          address: body.address ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          notes: body.notes ?? null,
        });
        await audit(tx, req, {
          action: 'property.created',
          entityType: 'property',
          entityId: id,
          diff: body,
        });
        return loadProperty(req, tx, id);
      });
    },

    async updateProperty(
      req: FastifyRequest,
      id: string,
      body: z.infer<typeof UpdatePropertyBody>,
    ) {
      return req.tenant(async (tx) => {
        await activeProperty(req, tx, id);
        if (body.clientLandlordId) await activeClientLandlord(tx, body.clientLandlordId);
        if (Object.keys(body).length) await tx.update(pr).set(body).where(eq(pr.id, id));
        await audit(tx, req, {
          action: 'property.updated',
          entityType: 'property',
          entityId: id,
          diff: body,
        });
        return loadProperty(req, tx, id);
      });
    },

    async archiveProperty(req: FastifyRequest, id: string) {
      return req.tenant(async (tx) => {
        const current = await loadProperty(req, tx, id);
        if (current.unitCounts.total > 0)
          throw AppError.conflict('has_active_units', 'Archive its units first.');
        if (!current.archivedAt)
          await tx
            .update(pr)
            .set({ archivedAt: sql`now()` })
            .where(eq(pr.id, id));
        await audit(tx, req, { action: 'property.archived', entityType: 'property', entityId: id });
        return loadProperty(req, tx, id);
      });
    },

    async setPropertyStaff(req: FastifyRequest, propertyId: string, userIds: string[]) {
      const unique = [...new Set(userIds)];
      const roles = await staff.memberRoles(req.actor!.orgId!, unique);
      const missing = unique.filter((id) => !roles.has(id));
      if (missing.length) {
        throw AppError.unprocessable(
          'not_a_member',
          `Not members of this organization: ${missing.join(', ')}`,
        );
      }
      return req.tenant(async (tx) => {
        await activeProperty(req, tx, propertyId);
        await tx.delete(ps).where(eq(ps.propertyId, propertyId));
        if (unique.length) {
          await tx
            .insert(ps)
            .values(unique.map((userId) => ({ orgId: req.actor!.orgId!, propertyId, userId })));
        }
        await audit(tx, req, {
          action: 'property.staff_set',
          entityType: 'property',
          entityId: propertyId,
          diff: { userIds: unique },
        });
        return staffOf(req, tx, propertyId);
      });
    },

    getPropertyStaff: (req: FastifyRequest, propertyId: string) =>
      req.tenant(async (tx) => {
        await loadProperty(req, tx, propertyId);
        return staffOf(req, tx, propertyId);
      }),

    // Units
    async listUnits(req: FastifyRequest, q: z.infer<typeof UnitQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return req.tenant(async (tx) => {
        const rows = await tx
          .select({ row: un, propertyName: pr.name })
          .from(un)
          .innerJoin(pr, eq(pr.id, un.propertyId))
          .where(
            and(
              propertyScope(req),
              q.includeArchived ? undefined : isNull(un.archivedAt),
              q.propertyId ? eq(un.propertyId, q.propertyId) : undefined,
              q.mode ? eq(un.mode, q.mode) : undefined,
              q.status ? eq(un.status, q.status) : undefined,
              q.q
                ? sql`(${un.code} ILIKE ${like(q.q)} OR ${un.label} ILIKE ${like(q.q)})`
                : undefined,
              after ? sql`(${un.code}, ${un.id}) > (${after[0]}, ${after[1]}::uuid)` : undefined,
            ),
          )
          .orderBy(asc(un.code), asc(un.id))
          .limit(q.limit + 1);
        return page(
          rows.map((r) => toUnit(r.row, r.propertyName)),
          q.limit,
          (r) => [r.code, r.id],
        );
      });
    },

    getUnit: (req: FastifyRequest, id: string) => req.tenant((tx) => loadUnit(req, tx, id)),

    async createUnit(
      req: FastifyRequest,
      propertyId: string,
      body: z.infer<typeof CreateUnitBody>,
    ) {
      assertPrice(body);
      return req
        .tenant(async (tx) => {
          await activeProperty(req, tx, propertyId);
          const id = uuidv7();
          await tx.insert(un).values({
            id,
            orgId: req.actor!.orgId!,
            propertyId,
            code: body.code,
            mode: body.mode,
            ...unitDetails(body),
          });
          await audit(tx, req, {
            action: 'unit.created',
            entityType: 'unit',
            entityId: id,
            diff: body,
          });
          return loadUnit(req, tx, id);
        })
        .catch((err: unknown) => unitCodeTaken(err, body.code));
    },

    async bulkCreateUnits(
      req: FastifyRequest,
      propertyId: string,
      body: z.infer<typeof BulkCreateUnitsBody>,
    ) {
      assertPrice(body);
      const codes = Array.from(
        { length: body.count },
        (_, i) => `${body.prefix}${String(body.start + i).padStart(body.padding, '0')}`,
      );
      const tooLong = codes.find((c) => !/^[A-Z0-9][A-Z0-9-]{0,11}$/.test(c));
      if (tooLong)
        throw AppError.unprocessable(
          'invalid_unit_code',
          `Generated code ${tooLong} is not a valid unit code (max 12 characters).`,
        );
      return req
        .tenant(async (tx) => {
          await activeProperty(req, tx, propertyId);
          const taken = await tx.select({ code: un.code }).from(un).where(inArray(un.code, codes));
          if (taken.length) {
            throw AppError.conflict(
              'unit_code_taken',
              `Already used: ${taken
                .map((t) => t.code)
                .sort()
                .join(', ')}`,
            );
          }
          const { prefix: _p, start: _s, count: _c, padding: _pad, mode, ...details } = body;
          const ids = codes.map(() => uuidv7());
          await tx.insert(un).values(
            codes.map((code, i) => ({
              id: ids[i]!,
              orgId: req.actor!.orgId!,
              propertyId,
              code,
              mode,
              ...unitDetails(details),
            })),
          );
          await audit(tx, req, {
            action: 'unit.bulk_created',
            entityType: 'property',
            entityId: propertyId,
            diff: { codes },
          });
          const rows = await tx
            .select({ row: un, propertyName: pr.name })
            .from(un)
            .innerJoin(pr, eq(pr.id, un.propertyId))
            .where(inArray(un.id, ids))
            .orderBy(asc(un.code));
          return rows.map((r) => toUnit(r.row, r.propertyName));
        })
        .catch((err: unknown) => unitCodeTaken(err));
    },

    async updateUnit(req: FastifyRequest, id: string, body: z.infer<typeof UpdateUnitBody>) {
      return req
        .tenant(async (tx) => {
          const current = await loadUnit(req, tx, id);
          if (current.archivedAt)
            throw AppError.unprocessable('unit_archived', 'That unit is archived.');
          const set = {
            ...body,
            rentCents: toCents(body.rentCents),
            depositCents: toCents(body.depositCents),
            baseNightlyCents: toCents(body.baseNightlyCents),
          };
          const defined = Object.fromEntries(
            Object.entries(set).filter(([, v]) => v !== undefined),
          );
          if (Object.keys(defined).length) {
            await tx
              .update(un)
              .set(defined)
              .where(eq(un.id, id))
              .catch((err: unknown) => {
                if (pgError(err)?.code === PG.checkViolation) {
                  throw AppError.unprocessable(
                    'unit_price_required',
                    'long_term units need rentCents; short_stay units need baseNightlyCents.',
                  );
                }
                throw err;
              });
          }
          await audit(tx, req, {
            action: 'unit.updated',
            entityType: 'unit',
            entityId: id,
            diff: body,
          });
          return loadUnit(req, tx, id);
        })
        .catch((err: unknown) => unitCodeTaken(err, body.code));
    },

    async archiveUnit(req: FastifyRequest, id: string) {
      return req.tenant(async (tx) => {
        const current = await loadUnit(req, tx, id);
        if (!current.archivedAt)
          await tx
            .update(un)
            .set({ archivedAt: sql`now()`, status: 'inactive' })
            .where(eq(un.id, id));
        await audit(tx, req, { action: 'unit.archived', entityType: 'unit', entityId: id });
        return loadUnit(req, tx, id);
      });
    },

    async codeAvailability(req: FastifyRequest, raw: string) {
      const code = raw.trim().toUpperCase();
      const valid = /^[A-Z0-9][A-Z0-9-]{0,11}$/.test(code);
      if (!valid) return { code, valid, available: false };
      const [hit] = await req.tenant((tx) =>
        tx.select({ id: un.id }).from(un).where(eq(un.code, code)).limit(1),
      );
      return { code, valid, available: !hit };
    },
  };
}

export type AccountsService = ReturnType<typeof createAccountsService>;
