import type {
  OperatorOrg,
  OperatorOrgDetail,
  OperatorOrgQuery,
  SubscriptionAction,
  UpdatePlanBody,
} from '@kejasha/contracts';
import { time } from '@kejasha/core';
import { and, desc, eq, inArray, schema, sql } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { decodeCursor, page } from '../../lib/pagination';
import { toUser } from '../identity';
import { effectiveStatus, toInvoiceDto, toPlanDto } from '../subscriptions';

const {
  organization: og,
  subscription: sub,
  member: mb,
  unit: un,
  plan: pl,
  subscriptionInvoice: inv,
  auditLog: al,
} = schema;

/**
 * Kejasha platform operators (B6b). Cross-tenant by nature, so it uses the owner role, and every
 * request is already logged by the auth plugin (`operator_access_log`); org-changing actions are
 * also written to that org's own audit log as `operator`.
 */
export function createOperatorService(deps: AppDeps) {
  const { db, clock } = deps;

  async function rows(orgIds?: string[], q?: z.infer<typeof OperatorOrgQuery>) {
    const after = q ? decodeCursor(q.cursor, 2) : undefined;
    const orgs = await db.owner
      .select({ o: og, s: sub })
      .from(og)
      .leftJoin(sub, eq(sub.orgId, og.id))
      .where(
        and(
          orgIds ? inArray(og.id, orgIds) : undefined,
          q?.q ? sql`${og.name} ILIKE ${`%${q.q}%`}` : undefined,
          q?.status ? eq(sub.status, q.status) : undefined,
          after
            ? sql`(${og.createdAt}, ${og.id}) < (${after[0]}::timestamptz, ${after[1]}::uuid)`
            : undefined,
        ),
      )
      .orderBy(desc(og.createdAt), desc(og.id))
      .limit(q ? q.limit + 1 : 1000);
    const ids = orgs.map((r) => r.o.id);
    const members = ids.length
      ? await db.owner
          .select({ orgId: mb.organizationId, n: sql<number>`count(*)::int` })
          .from(mb)
          .where(inArray(mb.organizationId, ids))
          .groupBy(mb.organizationId)
      : [];
    const units = ids.length
      ? await db.owner
          .select({ orgId: un.orgId, n: sql<number>`count(*)::int` })
          .from(un)
          .where(and(inArray(un.orgId, ids), sql`${un.archivedAt} IS NULL`))
          .groupBy(un.orgId)
      : [];
    const today = clock.today();
    return orgs.map(({ o, s }): z.infer<typeof OperatorOrg> => ({
      id: o.id,
      name: o.name,
      kind: o.kind as 'landlord' | 'agency' | 'host',
      createdAt: o.createdAt.toISOString(),
      planCode: s?.planCode ?? null,
      status: s ? effectiveStatus(s, today) : null,
      currentPeriodEnd: s?.currentPeriodEnd ?? null,
      trialEndsOn: s?.trialEndsOn ?? null,
      members: members.find((m) => m.orgId === o.id)?.n ?? 0,
      units: units.find((u) => u.orgId === o.id)?.n ?? 0,
    }));
  }

  async function auditOrg(
    orgId: string,
    operatorId: string,
    action: string,
    diff: unknown,
    requestId?: string,
  ) {
    await db.owner.insert(al).values({
      orgId,
      actorKind: 'operator',
      actorUserId: operatorId,
      action,
      entityType: 'subscription',
      entityId: orgId,
      diff: diff as object,
      requestId: requestId ?? null,
    });
  }

  return {
    async listOrgs(q: z.infer<typeof OperatorOrgQuery>) {
      return page(await rows(undefined, q), q.limit, (o) => [o.createdAt, o.id]);
    },

    async getOrg(orgId: string): Promise<z.infer<typeof OperatorOrgDetail>> {
      const [o] = await rows([orgId]);
      if (!o) throw AppError.notFound('Organization');
      const [s] = await db.owner.select().from(sub).where(eq(sub.orgId, orgId));
      const invoices = await db.owner
        .select()
        .from(inv)
        .where(eq(inv.orgId, orgId))
        .orderBy(desc(inv.periodStart))
        .limit(24);
      const owners = await db.owner
        .select({ u: schema.user })
        .from(mb)
        .innerJoin(schema.user, eq(schema.user.id, mb.userId))
        .where(and(eq(mb.organizationId, orgId), eq(mb.role, 'owner')));
      return {
        ...o,
        billingEmail: s?.billingEmail ?? null,
        invoices: invoices.map(toInvoiceDto),
        owners: owners.map(({ u }) => {
          const d = toUser(u);
          return { name: d.name, email: d.email, phone: d.phone };
        }),
      };
    },

    async act(
      orgId: string,
      operatorId: string,
      body: z.infer<typeof SubscriptionAction>,
      requestId?: string,
    ) {
      const [s] = await db.owner.select().from(sub).where(eq(sub.orgId, orgId));
      if (!s) throw AppError.notFound('Subscription');
      const today = clock.today();
      let set: Partial<typeof sub.$inferInsert>;
      switch (body.action) {
        case 'grant_trial':
          if (!body.days)
            throw AppError.unprocessable('days_required', 'Send the number of trial days.');
          set = { status: 'trialing', trialEndsOn: time.addDays(today, body.days) };
          break;
        case 'extend_period': {
          if (!body.days) throw AppError.unprocessable('days_required', 'Send the number of days.');
          const from =
            s.currentPeriodEnd && s.currentPeriodEnd >= today ? s.currentPeriodEnd : today;
          set = {
            status: 'active',
            pastDueSince: null,
            currentPeriodStart: s.currentPeriodStart ?? today,
            currentPeriodEnd: time.addDays(from, body.days),
          };
          break;
        }
        case 'change_plan':
          if (!body.planCode) throw AppError.unprocessable('plan_required', 'Send the planCode.');
          set = { planCode: body.planCode };
          break;
        case 'suspend':
          set = { status: 'suspended' };
          break;
        case 'reactivate':
          if (!s.currentPeriodEnd || s.currentPeriodEnd < today)
            throw AppError.unprocessable(
              'no_paid_period',
              'Nothing paid covers today; extend the period instead.',
            );
          set = { status: 'active', pastDueSince: null };
          break;
        case 'cancel':
          set = { status: 'cancelled', cancelledAt: clock.now() };
          break;
      }
      await db.owner.update(sub).set(set).where(eq(sub.orgId, orgId));
      await auditOrg(orgId, operatorId, `subscription.${body.action}`, { ...body }, requestId);
      return this.getOrg(orgId);
    },

    async plans() {
      return (await db.owner.select().from(pl).orderBy(pl.code)).map(toPlanDto);
    },

    async updatePlan(code: 'landlord' | 'host' | 'agency', body: z.infer<typeof UpdatePlanBody>) {
      const set: Partial<typeof pl.$inferInsert> = { updatedAt: clock.now() };
      if (body.name !== undefined) set.name = body.name;
      if (body.baseCents !== undefined) set.baseCents = BigInt(body.baseCents);
      if (body.unitPriceCents !== undefined) set.unitPriceCents = BigInt(body.unitPriceCents);
      if (body.listingPriceCents !== undefined)
        set.listingPriceCents = BigInt(body.listingPriceCents);
      if (body.minimumCents !== undefined) set.minimumCents = BigInt(body.minimumCents);
      if (body.whiteLabel !== undefined) set.whiteLabel = body.whiteLabel;
      const [row] = await db.owner.update(pl).set(set).where(eq(pl.code, code)).returning();
      if (!row) throw AppError.notFound('Plan');
      return toPlanDto(row);
    },

    async audit(orgId: string) {
      const rows = await db.owner
        .select()
        .from(al)
        .where(eq(al.orgId, orgId))
        .orderBy(desc(al.occurredAt), desc(al.id))
        .limit(200);
      return rows.map((r) => ({
        id: String(r.id),
        actorKind: r.actorKind as 'user' | 'system' | 'operator',
        actorUserId: r.actorUserId,
        action: r.action,
        entityType: r.entityType,
        entityId: r.entityId,
        diff: r.diff ?? null,
        occurredAt: r.occurredAt.toISOString(),
      }));
    },
  };
}

export type OperatorService = ReturnType<typeof createOperatorService>;
