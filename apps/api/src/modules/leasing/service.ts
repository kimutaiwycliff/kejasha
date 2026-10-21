import type {
  CreateChargeBody,
  CreateLeaseBody,
  CreateTenantBody,
  Lease,
  LeaseCalendar,
  LeaseDetail,
  LeaseQuery,
  TenantQuery,
  UpdateChargeBody,
  UpdateLeaseBody,
  UpdateTenantBody,
} from '@kejasha/contracts';
import { CHARGE_RULE, LEASE_TERMS_RULE } from '@kejasha/contracts';
import { billing, money, time, uuidv7 } from '@kejasha/core';
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
import { decodeCursor, page } from '../../lib/pagination';
import * as accounts from '../accounts';
import * as ledger from '../ledger';
import {
  billLease,
  buildPeriodicLines,
  dateToPeriod,
  issueCreditNote,
  issueInvoice,
  outstandingByLease,
  periodToDate,
  rentSchedule,
  voidInvoice,
  type LeaseRow,
} from './invoicing';

const {
  tenant: tn,
  lease: ls,
  chargeRule: cr,
  leaseRentStep: step,
  meter: mt,
  invoice: inv,
  invoiceLine: line,
} = schema;

type LeaseDto = z.infer<typeof Lease>;
type TenantRow = typeof tn.$inferSelect;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
const cents = (v: bigint | null) => (v === null ? null : money.toApiInt(v));
const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
const big = (v: number | undefined) => (v === undefined ? undefined : BigInt(v));
const defined = <T extends Record<string, unknown>>(o: T) =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const CHARGE_LABEL: Record<string, string> = {
  service_charge: 'Service charge',
  garbage: 'Garbage',
  water: 'Water',
  electricity: 'Electricity',
  security: 'Security',
  other: 'Other charge',
};

/** Time-based lines (rent and flat charges) are what termination prorates; metered lines are not. */
const TIME_BASED = new Set([
  'rent',
  'service_charge',
  'garbage',
  'security',
  'other',
  'water',
  'electricity',
]);

export function createLeasingService(deps: AppDeps) {
  const { db, clock } = deps;

  // ── helpers ────────────────────────────────────────────────────────────────────────────────
  function assertTerms(b: {
    escalationBps?: number | undefined;
    escalationEveryMonths?: number | undefined;
    lateFeeKind?: string | undefined;
    lateFeeFlatCents?: number | undefined;
    lateFeeBps?: number | undefined;
  }) {
    const escalationOk =
      (b.escalationBps === undefined) === (b.escalationEveryMonths === undefined);
    const kind =
      b.lateFeeKind ??
      (b.lateFeeFlatCents !== undefined || b.lateFeeBps !== undefined ? 'missing' : 'none');
    const feeOk =
      (kind === 'none' && b.lateFeeFlatCents === undefined && b.lateFeeBps === undefined) ||
      (kind === 'flat' && b.lateFeeFlatCents !== undefined && b.lateFeeBps === undefined) ||
      (kind === 'percent' && b.lateFeeBps !== undefined && b.lateFeeFlatCents === undefined);
    if (!escalationOk || !feeOk)
      throw AppError.unprocessable('invalid_lease_terms', LEASE_TERMS_RULE);
  }

  function overlapOr(err: unknown): never {
    const pg = pgError(err);
    if (pg?.code === PG.exclusionViolation && pg.constraint === 'lease_no_overlap') {
      throw AppError.conflict(
        'lease_overlap',
        'The unit already has a lease covering some of these dates.',
      );
    }
    throw err;
  }

  async function loadLeaseRow(tx: Tx, id: string): Promise<LeaseRow> {
    const [row] = await tx.select().from(ls).where(eq(ls.id, id));
    if (!row) throw AppError.notFound('Lease');
    return row;
  }

  async function toLeases(tx: Tx, rows: LeaseRow[], today: string): Promise<LeaseDto[]> {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const [units, tenants, balances, steps] = await Promise.all([
      accounts.unitsById(
        tx,
        rows.map((r) => r.unitId),
      ),
      tx
        .select({ id: tn.id, name: tn.fullName })
        .from(tn)
        .where(
          inArray(
            tn.id,
            rows.map((r) => r.tenantId),
          ),
        ),
      ledger.leaseBalances(tx, ids),
      tx.select().from(step).where(inArray(step.leaseId, ids)),
    ]);
    const names = new Map(tenants.map((t) => [t.id, t.name]));
    return rows.map((r) => {
      const unit = units.get(r.unitId);
      const schedule: billing.RentSchedule = {
        startDate: r.startDate,
        rentCents: r.rentCents,
        escalationBps: r.escalationBps,
        escalationEveryMonths: r.escalationEveryMonths,
        steps: steps
          .filter((s) => s.leaseId === r.id)
          .map((s) => ({ effectivePeriod: s.effectivePeriod.slice(0, 7), rentCents: s.rentCents })),
      };
      const startPeriod = r.startDate.slice(0, 7);
      const period = today.slice(0, 7) < startPeriod ? startPeriod : today.slice(0, 7);
      const b = balances.get(r.id)!;
      return {
        id: r.id,
        unitId: r.unitId,
        unitCode: unit?.code ?? '',
        propertyId: unit?.propertyId ?? r.unitId,
        propertyName: unit?.propertyName ?? '',
        tenantId: r.tenantId,
        tenantName: names.get(r.tenantId) ?? '',
        startDate: r.startDate,
        endDate: r.endDate,
        status: r.status,
        rentCents: money.toApiInt(r.rentCents),
        currentRentCents: money.toApiInt(billing.rentForPeriod(schedule, period)),
        depositCents: money.toApiInt(r.depositCents),
        billingDay: r.billingDay,
        escalationBps: r.escalationBps,
        escalationEveryMonths: r.escalationEveryMonths,
        nextEscalationPeriod: billing.nextEscalationPeriod(schedule, period),
        lateFeeKind: r.lateFeeKind,
        lateFeeFlatCents: cents(r.lateFeeFlatCents),
        lateFeeBps: r.lateFeeBps,
        lateFeeGraceDays: r.lateFeeGraceDays,
        notes: r.notes,
        balanceCents: money.toApiInt(b.receivable),
        depositHeldCents: money.toApiInt(b.depositHeld),
        terminatedAt: iso(r.terminatedAt),
        terminationReason: r.terminationReason,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async function toTenants(tx: Tx, rows: TenantRow[]) {
    if (!rows.length) return [];
    const leases = await tx
      .select({ id: ls.id, tenantId: ls.tenantId, status: ls.status })
      .from(ls)
      .where(
        and(
          inArray(
            ls.tenantId,
            rows.map((r) => r.id),
          ),
          sql`${ls.status} <> 'cancelled'`,
        ),
      );
    const balances = await ledger.leaseBalances(
      tx,
      leases.map((l) => l.id),
    );
    return rows.map((r) => {
      const mine = leases.filter((l) => l.tenantId === r.id);
      return {
        id: r.id,
        fullName: r.fullName,
        phone: r.phone,
        email: r.email,
        nationalId: r.nationalId,
        kraPin: r.kraPin,
        nextOfKinName: r.nextOfKinName,
        nextOfKinPhone: r.nextOfKinPhone,
        notes: r.notes,
        activeLeaseCount: mine.filter((l) => l.status === 'active').length,
        balanceCents: money.toApiInt(money.sum(mine.map((l) => balances.get(l.id)!.receivable))),
        archivedAt: iso(r.archivedAt),
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  function toCharge(r: typeof cr.$inferSelect) {
    return {
      id: r.id,
      leaseId: r.leaseId,
      kind: r.kind,
      label: r.label,
      method: r.method,
      amountCents: cents(r.amountCents),
      unitPriceCents: cents(r.unitPriceCents),
      meterId: r.meterId,
      startsOn: r.startsOn,
      endsOn: r.endsOn,
    };
  }

  async function addCharge(
    tx: Tx,
    ctx: Ctx,
    lease: LeaseRow,
    body: z.infer<typeof CreateChargeBody>,
  ) {
    const flatOk =
      body.method === 'flat' &&
      body.amountCents !== undefined &&
      body.unitPriceCents === undefined &&
      body.meterId === undefined;
    const meteredOk =
      body.method === 'metered' &&
      body.unitPriceCents !== undefined &&
      body.meterId !== undefined &&
      body.amountCents === undefined;
    if (!flatOk && !meteredOk) throw AppError.unprocessable('invalid_charge', CHARGE_RULE);
    if (body.meterId) {
      const [m] = await tx.select().from(mt).where(eq(mt.id, body.meterId));
      if (!m || m.unitId !== lease.unitId || m.archivedAt) {
        throw AppError.unprocessable(
          'invalid_charge',
          'The meter must be an active meter on the lease unit.',
        );
      }
    }
    const startsOn = body.startsOn ?? lease.startDate;
    if (body.endsOn && body.endsOn < startsOn)
      throw AppError.unprocessable('invalid_dates', 'endsOn is before startsOn.');
    const [row] = await tx
      .insert(cr)
      .values({
        id: uuidv7(),
        orgId: ctx.orgId,
        leaseId: lease.id,
        kind: body.kind,
        label: body.label || CHARGE_LABEL[body.kind]!,
        method: body.method,
        amountCents: big(body.amountCents) ?? null,
        unitPriceCents: big(body.unitPriceCents) ?? null,
        meterId: body.meterId ?? null,
        startsOn,
        endsOn: body.endsOn ?? null,
      })
      .returning();
    return row!;
  }

  /** Latest month already invoiced (terms can't rewrite billed months). */
  async function lastInvoicedPeriod(tx: Tx, leaseId: string): Promise<string | null> {
    const [row] = await tx
      .select({ period: inv.period })
      .from(inv)
      .where(and(eq(inv.leaseId, leaseId), eq(inv.kind, 'periodic'), eq(inv.status, 'issued')))
      .orderBy(desc(inv.period))
      .limit(1);
    return dateToPeriod(row?.period ?? null);
  }

  async function getLease(ctx: Ctx, id: string): Promise<z.infer<typeof LeaseDetail>> {
    return inTenant(db, ctx, async (tx) => {
      const row = await loadLeaseRow(tx, id);
      const [dto] = await toLeases(tx, [row], clock.today());
      const charges = await tx
        .select()
        .from(cr)
        .where(eq(cr.leaseId, id))
        .orderBy(asc(cr.createdAt));
      const steps = await tx
        .select()
        .from(step)
        .where(eq(step.leaseId, id))
        .orderBy(asc(step.effectivePeriod));
      const outstanding = (await outstandingByLease(tx, [id])).get(id)!;
      const a = billing.aging(
        outstanding.items.map((i) => ({
          dueOn: i.invoice.dueOn,
          outstandingCents: i.outstandingCents,
        })),
        clock.today(),
      );
      return {
        ...dto!,
        charges: charges.map(toCharge),
        rentSteps: steps.map((s) => ({
          effectivePeriod: s.effectivePeriod.slice(0, 7),
          rentCents: money.toApiInt(s.rentCents),
        })),
        arrears: Object.fromEntries(
          Object.entries(a).map(([k, v]) => [k, money.toApiInt(v)]),
        ) as z.infer<typeof LeaseDetail>['arrears'],
      };
    });
  }

  async function changeRent(
    ctx: Ctx,
    id: string,
    body: { effectivePeriod: string; rentCents: number },
  ) {
    await inTenant(db, ctx, async (tx) => {
      const lease = await loadLeaseRow(tx, id);
      if (lease.status !== 'active')
        throw AppError.unprocessable('lease_not_active', 'Only active leases can be changed.');
      if (body.effectivePeriod < lease.startDate.slice(0, 7)) {
        throw AppError.unprocessable(
          'invalid_dates',
          'The rent change is before the lease starts.',
        );
      }
      const last = await lastInvoicedPeriod(tx, id);
      if (last && body.effectivePeriod <= last) {
        throw AppError.unprocessable(
          'period_already_invoiced',
          `${last} is already invoiced; choose a later month or issue a credit note.`,
        );
      }
      await tx
        .insert(step)
        .values({
          orgId: ctx.orgId,
          leaseId: id,
          effectivePeriod: periodToDate(body.effectivePeriod),
          rentCents: BigInt(body.rentCents),
        })
        .onConflictDoUpdate({
          target: [step.leaseId, step.effectivePeriod],
          set: { rentCents: BigInt(body.rentCents) },
        });
      await record(tx, ctx, {
        action: 'lease.rent_changed',
        entityType: 'lease',
        entityId: id,
        diff: body,
      });
    });
    return getLease(ctx, id);
  }

  return {
    loadLeaseRow,
    toLeases,
    getLease,
    changeRent,

    // ── Tenants ──────────────────────────────────────────────────────────────────────────────
    async listTenants(ctx: Ctx, q: z.infer<typeof TenantQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx
          .select()
          .from(tn)
          .where(
            and(
              q.includeArchived ? undefined : isNull(tn.archivedAt),
              q.q
                ? sql`(${tn.fullName} ILIKE ${like(q.q)} OR ${tn.phone} ILIKE ${like(q.q)} OR ${tn.nationalId} ILIKE ${like(q.q)})`
                : undefined,
              after
                ? sql`(lower(${tn.fullName}), ${tn.id}) > (${after[0]}, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(sql`lower(${tn.fullName})`, asc(tn.id))
          .limit(q.limit + 1);
        return page(await toTenants(tx, rows), q.limit, (t) => [t.fullName.toLowerCase(), t.id]);
      });
    },

    async getTenant(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [row] = await tx.select().from(tn).where(eq(tn.id, id));
        if (!row) throw AppError.notFound('Tenant');
        return (await toTenants(tx, [row]))[0]!;
      });
    },

    async createTenant(ctx: Ctx, body: z.infer<typeof CreateTenantBody>) {
      return inTenant(db, ctx, async (tx) => {
        const id = uuidv7();
        const [row] = await tx
          .insert(tn)
          .values({
            id,
            orgId: ctx.orgId,
            fullName: body.fullName,
            phone: body.phone ?? null,
            email: body.email ?? null,
            nationalId: body.nationalId?.toUpperCase() ?? null,
            kraPin: body.kraPin ?? null,
            nextOfKinName: body.nextOfKinName || null,
            nextOfKinPhone: body.nextOfKinPhone ?? null,
            notes: body.notes || null,
          })
          .returning();
        await record(tx, ctx, {
          action: 'tenant.created',
          entityType: 'tenant',
          entityId: id,
          diff: body,
        });
        return (await toTenants(tx, [row!]))[0]!;
      });
    },

    async updateTenant(ctx: Ctx, id: string, body: z.infer<typeof UpdateTenantBody>) {
      return inTenant(db, ctx, async (tx) => {
        const set = defined({
          ...body,
          nationalId:
            body.nationalId === undefined ? undefined : (body.nationalId?.toUpperCase() ?? null),
        });
        const [row] = Object.keys(set).length
          ? await tx.update(tn).set(set).where(eq(tn.id, id)).returning()
          : await tx.select().from(tn).where(eq(tn.id, id));
        if (!row) throw AppError.notFound('Tenant');
        await record(tx, ctx, {
          action: 'tenant.updated',
          entityType: 'tenant',
          entityId: id,
          diff: body,
        });
        return (await toTenants(tx, [row]))[0]!;
      });
    },

    async archiveTenant(ctx: Ctx, id: string) {
      return inTenant(db, ctx, async (tx) => {
        const [active] = await tx
          .select({ id: ls.id })
          .from(ls)
          .where(and(eq(ls.tenantId, id), eq(ls.status, 'active')))
          .limit(1);
        if (active)
          throw AppError.conflict(
            'has_active_leases',
            "End or terminate the tenant's leases first.",
          );
        const [row] = await tx
          .update(tn)
          .set({ archivedAt: sql`coalesce(${tn.archivedAt}, now())` })
          .where(eq(tn.id, id))
          .returning();
        if (!row) throw AppError.notFound('Tenant');
        await record(tx, ctx, { action: 'tenant.archived', entityType: 'tenant', entityId: id });
        return (await toTenants(tx, [row]))[0]!;
      });
    },

    // ── Leases ───────────────────────────────────────────────────────────────────────────────
    async listLeases(ctx: Ctx, q: z.infer<typeof LeaseQuery>) {
      const after = decodeCursor(q.cursor, 2);
      return inTenant(db, ctx, async (tx) => {
        const unitFilter = q.propertyId
          ? await accounts.unitIdsInProperty(tx, q.propertyId)
          : undefined;
        if (unitFilter && !unitFilter.length) return { items: [], nextCursor: null };
        const rows = await tx
          .select()
          .from(ls)
          .where(
            and(
              q.status ? eq(ls.status, q.status) : undefined,
              q.unitId ? eq(ls.unitId, q.unitId) : undefined,
              q.tenantId ? eq(ls.tenantId, q.tenantId) : undefined,
              unitFilter ? inArray(ls.unitId, unitFilter) : undefined,
              after
                ? sql`(${ls.startDate}, ${ls.id}) < (${after[0]}::date, ${after[1]}::uuid)`
                : undefined,
            ),
          )
          .orderBy(desc(ls.startDate), desc(ls.id))
          .limit(q.limit + 1);
        return page(await toLeases(tx, rows, clock.today()), q.limit, (l) => [l.startDate, l.id]);
      });
    },

    async createLease(ctx: Ctx, body: z.infer<typeof CreateLeaseBody>) {
      assertTerms(body);
      if (body.endDate && body.endDate < body.startDate) {
        throw AppError.unprocessable('invalid_dates', 'endDate is before startDate.');
      }
      const today = clock.today();
      const id = await inTenant(db, ctx, async (tx) => {
        const unit = (await accounts.unitsById(tx, [body.unitId])).get(body.unitId);
        if (!unit) throw AppError.notFound('Unit');
        if (unit.archived || unit.status !== 'active') {
          throw AppError.unprocessable('unit_unavailable', 'The unit is archived or inactive.');
        }
        if (unit.mode !== 'long_term') {
          throw AppError.unprocessable(
            'unit_not_long_term',
            'Leases are for long-term units; use bookings for short-stay units.',
          );
        }
        const [tenant] = await tx.select().from(tn).where(eq(tn.id, body.tenantId));
        if (!tenant) throw AppError.notFound('Tenant');
        if (tenant.archivedAt)
          throw AppError.unprocessable('tenant_archived', 'The tenant is archived.');

        const leaseId = uuidv7();
        const [lease] = await tx
          .insert(ls)
          .values({
            id: leaseId,
            orgId: ctx.orgId,
            unitId: body.unitId,
            tenantId: body.tenantId,
            startDate: body.startDate,
            endDate: body.endDate ?? null,
            rentCents: BigInt(body.rentCents),
            depositCents: BigInt(body.depositCents ?? 0),
            billingDay: body.billingDay ?? 1,
            escalationBps: body.escalationBps ?? null,
            escalationEveryMonths: body.escalationEveryMonths ?? null,
            lateFeeKind: body.lateFeeKind ?? 'none',
            lateFeeFlatCents: big(body.lateFeeFlatCents) ?? null,
            lateFeeBps: body.lateFeeBps ?? null,
            lateFeeGraceDays: body.lateFeeGraceDays ?? 0,
            notes: body.notes || null,
          })
          .returning()
          .catch(overlapOr);
        await ledger.leaseAccounts(tx, ctx, leaseId);
        for (const charge of body.charges ?? []) await addCharge(tx, ctx, lease!, charge);

        if (lease!.depositCents > 0n) {
          await issueInvoice(tx, ctx, lease!, {
            kind: 'deposit',
            issuedOn: today,
            dueOn: lease!.startDate,
            lines: [
              {
                kind: 'deposit',
                description: 'Security deposit',
                amountCents: lease!.depositCents,
              },
            ],
          });
        }
        await billLease(tx, ctx, leaseId, today);
        await record(tx, ctx, {
          action: 'lease.created',
          entityType: 'lease',
          entityId: leaseId,
          diff: body,
        });
        return leaseId;
      });
      return getLease(ctx, id);
    },

    async updateLease(ctx: Ctx, id: string, body: z.infer<typeof UpdateLeaseBody>) {
      await inTenant(db, ctx, async (tx) => {
        const current = await loadLeaseRow(tx, id);
        if (current.status !== 'active')
          throw AppError.unprocessable('lease_not_active', 'Only active leases can be changed.');
        const touchesEscalation =
          body.escalationBps !== undefined || body.escalationEveryMonths !== undefined;
        const touchesFee =
          body.lateFeeKind !== undefined ||
          body.lateFeeFlatCents !== undefined ||
          body.lateFeeBps !== undefined;
        if (touchesEscalation || touchesFee) {
          assertTerms({
            ...(touchesEscalation
              ? {
                  escalationBps: body.escalationBps,
                  escalationEveryMonths: body.escalationEveryMonths,
                }
              : {}),
            ...(touchesFee
              ? {
                  lateFeeKind: body.lateFeeKind,
                  lateFeeFlatCents: body.lateFeeFlatCents,
                  lateFeeBps: body.lateFeeBps,
                }
              : {}),
          });
        }
        const set: Partial<typeof ls.$inferInsert> = {};
        if (body.billingDay !== undefined) set.billingDay = body.billingDay;
        if (touchesEscalation) {
          set.escalationBps = body.escalationBps ?? null;
          set.escalationEveryMonths = body.escalationEveryMonths ?? null;
        }
        if (touchesFee) {
          set.lateFeeKind = body.lateFeeKind ?? 'none';
          set.lateFeeFlatCents = big(body.lateFeeFlatCents) ?? null;
          set.lateFeeBps = body.lateFeeBps ?? null;
        }
        if (body.lateFeeGraceDays !== undefined) set.lateFeeGraceDays = body.lateFeeGraceDays;
        if (body.notes !== undefined) set.notes = body.notes || null;
        if (Object.keys(set).length) await tx.update(ls).set(set).where(eq(ls.id, id));
        await record(tx, ctx, {
          action: 'lease.updated',
          entityType: 'lease',
          entityId: id,
          diff: body,
        });
      });
      return getLease(ctx, id);
    },

    async renewLease(
      ctx: Ctx,
      id: string,
      body: {
        endDate: string | null;
        rentCents?: number | undefined;
        rentEffectivePeriod?: string | undefined;
      },
    ) {
      if ((body.rentCents === undefined) !== (body.rentEffectivePeriod === undefined)) {
        throw AppError.unprocessable(
          'invalid_renewal',
          'Send rentCents together with rentEffectivePeriod.',
        );
      }
      await inTenant(db, ctx, async (tx) => {
        const lease = await loadLeaseRow(tx, id);
        if (lease.status !== 'active')
          throw AppError.unprocessable('lease_not_active', 'Only active leases can be renewed.');
        if (lease.endDate && body.endDate !== null && body.endDate < lease.endDate) {
          throw AppError.unprocessable(
            'invalid_dates',
            'A renewal extends the lease; use terminate to end it earlier.',
          );
        }
        await tx.update(ls).set({ endDate: body.endDate }).where(eq(ls.id, id)).catch(overlapOr);
        await record(tx, ctx, {
          action: 'lease.renewed',
          entityType: 'lease',
          entityId: id,
          diff: body,
        });
      });
      if (body.rentCents !== undefined) {
        return changeRent(ctx, id, {
          effectivePeriod: body.rentEffectivePeriod!,
          rentCents: body.rentCents,
        });
      }
      return getLease(ctx, id);
    },

    /**
     * End a lease early. Invoices for months wholly after the end are voided; the final month's
     * invoice (if already issued) is credited down to the prorated amount.
     */
    async terminateLease(ctx: Ctx, id: string, body: { endDate: string; reason: string }) {
      const today = clock.today();
      await inTenant(db, ctx, async (tx) => {
        const lease = await loadLeaseRow(tx, id);
        if (lease.status !== 'active')
          throw AppError.unprocessable('lease_not_active', 'Only active leases can be terminated.');
        if (body.endDate < lease.startDate)
          throw AppError.unprocessable('invalid_dates', 'The end date is before the lease starts.');
        if (lease.endDate && body.endDate > lease.endDate) {
          throw AppError.unprocessable(
            'invalid_dates',
            'The lease already ends earlier; use renew to extend it.',
          );
        }
        const [ended] = await tx
          .update(ls)
          .set({
            status: 'terminated',
            endDate: body.endDate,
            terminatedAt: sql`now()`,
            terminationReason: body.reason,
          })
          .where(eq(ls.id, id))
          .returning();
        const endPeriod = body.endDate.slice(0, 7);
        const periodic = await tx
          .select()
          .from(inv)
          .where(and(eq(inv.leaseId, id), eq(inv.kind, 'periodic'), eq(inv.status, 'issued')));
        for (const invoice of periodic) {
          const period = invoice.period!.slice(0, 7);
          if (period > endPeriod) {
            await voidInvoice(tx, ctx, invoice.id, `Lease terminated: ${body.reason}`, today);
          } else if (period === endPeriod) {
            const billedLines = await tx.select().from(line).where(eq(line.invoiceId, invoice.id));
            const billed = money.sum(
              billedLines
                .filter((l) => TIME_BASED.has(l.kind) && !l.meterId)
                .map((l) => l.amountCents),
            );
            const recomputed = money.sum(
              (await buildPeriodicLines(tx, ended!, period))
                .filter((l) => TIME_BASED.has(l.kind) && !l.meterId)
                .map((l) => l.amountCents),
            );
            if (billed > recomputed) {
              await issueCreditNote(tx, ctx, ended!, {
                amountCents: billed - recomputed,
                reason: `Termination proration for ${invoice.number}`,
                invoiceId: invoice.id,
                issuedOn: today,
              });
            }
          }
        }
        await billLease(tx, ctx, id, today);
        await record(tx, ctx, {
          action: 'lease.terminated',
          entityType: 'lease',
          entityId: id,
          diff: body,
        });
      });
      return getLease(ctx, id);
    },

    /** Undo a lease entered by mistake: only while nothing has been credited against it. */
    async cancelLease(ctx: Ctx, id: string, reason: string) {
      const today = clock.today();
      await inTenant(db, ctx, async (tx) => {
        const lease = await loadLeaseRow(tx, id);
        if (lease.status === 'cancelled') return;
        const o = (await outstandingByLease(tx, [id])).get(id)!;
        const credited =
          money.sum(o.items.map((i) => i.invoice.totalCents - i.outstandingCents)) + o.credit;
        if (credited !== 0n)
          throw AppError.conflict(
            'lease_has_activity',
            'Payments or credits exist; terminate the lease instead.',
          );
        for (const { invoice } of o.items)
          await voidInvoice(tx, ctx, invoice.id, `Lease cancelled: ${reason}`, today);
        await tx
          .update(ls)
          .set({ status: 'cancelled', terminationReason: reason })
          .where(eq(ls.id, id));
        await record(tx, ctx, {
          action: 'lease.cancelled',
          entityType: 'lease',
          entityId: id,
          diff: { reason },
        });
      });
      return getLease(ctx, id);
    },

    async calendar(ctx: Ctx, from: string, to: string): Promise<z.infer<typeof LeaseCalendar>> {
      if (to < from || time.diffDays(from, to) > 400)
        throw AppError.unprocessable('invalid_range', 'Use a range of at most 400 days.');
      return inTenant(db, ctx, async (tx) => {
        const rows = await tx.select().from(ls).where(eq(ls.status, 'active'));
        const dtos = await toLeases(tx, rows, clock.today());
        const items: z.infer<typeof LeaseCalendar>['items'] = [];
        for (const [i, r] of rows.entries()) {
          const d = dtos[i]!;
          if (r.endDate && r.endDate >= from && r.endDate <= to) {
            items.push({
              kind: 'lease_end',
              date: r.endDate,
              leaseId: r.id,
              unitCode: d.unitCode,
              tenantName: d.tenantName,
              rentCents: null,
            });
          }
          const schedule = await rentSchedule(tx, r);
          const startPeriod = r.startDate.slice(0, 7);
          let p = billing.nextEscalationPeriod(
            schedule,
            startPeriod > from.slice(0, 7) ? startPeriod : time.addPeriods(from.slice(0, 7), -1),
          );
          while (p && `${p}-01` <= to) {
            if (`${p}-01` >= from && (!r.endDate || `${p}-01` <= r.endDate)) {
              items.push({
                kind: 'escalation',
                date: `${p}-01`,
                leaseId: r.id,
                unitCode: d.unitCode,
                tenantName: d.tenantName,
                rentCents: money.toApiInt(billing.rentForPeriod(schedule, p)),
              });
            }
            p = billing.nextEscalationPeriod(schedule, p);
          }
        }
        return { items: items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)) };
      });
    },

    // ── Charges ──────────────────────────────────────────────────────────────────────────────
    async listCharges(ctx: Ctx, leaseId: string) {
      return inTenant(db, ctx, async (tx) => {
        await loadLeaseRow(tx, leaseId);
        return (
          await tx.select().from(cr).where(eq(cr.leaseId, leaseId)).orderBy(asc(cr.createdAt))
        ).map(toCharge);
      });
    },

    async createCharge(ctx: Ctx, leaseId: string, body: z.infer<typeof CreateChargeBody>) {
      return inTenant(db, ctx, async (tx) => {
        const lease = await loadLeaseRow(tx, leaseId);
        if (lease.status !== 'active')
          throw AppError.unprocessable('lease_not_active', 'Only active leases take new charges.');
        const row = await addCharge(tx, ctx, lease, body);
        await record(tx, ctx, {
          action: 'charge.created',
          entityType: 'charge_rule',
          entityId: row.id,
          diff: body,
        });
        return toCharge(row);
      });
    },

    async updateCharge(ctx: Ctx, id: string, body: z.infer<typeof UpdateChargeBody>) {
      return inTenant(db, ctx, async (tx) => {
        const [current] = await tx.select().from(cr).where(eq(cr.id, id));
        if (!current) throw AppError.notFound('Charge');
        if (body.amountCents !== undefined && current.method !== 'flat')
          throw AppError.unprocessable('invalid_charge', CHARGE_RULE);
        if (body.unitPriceCents !== undefined && current.method !== 'metered')
          throw AppError.unprocessable('invalid_charge', CHARGE_RULE);
        if (body.endsOn && body.endsOn < current.startsOn)
          throw AppError.unprocessable('invalid_dates', 'endsOn is before startsOn.');
        const set = defined({
          label: body.label || undefined,
          amountCents: big(body.amountCents),
          unitPriceCents: big(body.unitPriceCents),
          endsOn: body.endsOn,
        });
        const [row] = Object.keys(set).length
          ? await tx.update(cr).set(set).where(eq(cr.id, id)).returning()
          : [current];
        await record(tx, ctx, {
          action: 'charge.updated',
          entityType: 'charge_rule',
          entityId: id,
          diff: body,
        });
        return toCharge(row!);
      });
    },
  };
}

export type LeasingService = ReturnType<typeof createLeasingService>;
