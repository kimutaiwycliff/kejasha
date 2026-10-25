import type { PortalMe, PortalPayBody, PortalTicketBody } from '@kejasha/contracts';
import { eq, inArray, schema } from '@kejasha/db';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import type { Ctx } from '../../lib/ctx';
import * as leasingIdx from '../leasing';
import { createLeasing } from '../leasing';
import { createMaintenanceService } from '../maintenance';
import { createPayments } from '../payments';

/**
 * Tenant portal (B6). A tenant is a signed-in user whose **verified** phone matches tenant records
 * in one or more orgs. Every read and write then runs in that org's tenant transaction through the
 * normal services; a lease is reachable only if its tenant record carries the caller's phone.
 */
export function createPortalService(deps: AppDeps) {
  const { db } = deps;
  const leasing = createLeasing(deps);
  const payments = createPayments(deps);
  // Tenants never assign tickets, so member lookups are not needed.
  const tickets = createMaintenanceService(deps, { memberRoles: async () => new Map() });

  async function verifiedPhone(userId: string) {
    const [u] = await db.owner
      .select({ phone: schema.user.phoneNumber, verified: schema.user.phoneNumberVerified })
      .from(schema.user)
      .where(eq(schema.user.id, userId));
    return { phone: u?.phone ?? null, verified: Boolean(u?.verified && u.phone) };
  }

  /** The (org, tenant) records this user may act as. */
  async function records(userId: string) {
    const p = await verifiedPhone(userId);
    return { ...p, records: p.verified ? await leasingIdx.tenantRecordsByPhone(db, p.phone!) : [] };
  }

  const ctxFor = (orgId: string, userId: string): Ctx => ({ orgId, userId, actorKind: 'user' });

  /** Resolve a lease the caller may see (404 otherwise — never reveals other tenants' leases). */
  async function lease(userId: string, leaseId: string) {
    const owner = await leasingIdx.leaseOwnerOf(db, leaseId);
    const { records: mine, phone } = await records(userId);
    const rec = owner && mine.find((r) => r.orgId === owner.orgId && r.tenantId === owner.tenantId);
    if (!owner || !rec || owner.status === 'cancelled') throw AppError.notFound('Lease');
    return { ...owner, ctx: ctxFor(owner.orgId, userId), phone: phone! };
  }

  return {
    async me(userId: string): Promise<z.infer<typeof PortalMe>> {
      const { phone, verified, records: mine } = await records(userId);
      const orgIds = [...new Set(mine.map((r) => r.orgId))];
      const orgs = orgIds.length
        ? await db.owner
            .select({ id: schema.organization.id, name: schema.organization.name })
            .from(schema.organization)
            .where(inArray(schema.organization.id, orgIds))
        : [];
      const tenancies = [];
      for (const orgId of orgIds) {
        const leases = [];
        for (const r of mine.filter((x) => x.orgId === orgId)) {
          const page = await leasing.service.listLeases(ctxFor(orgId, userId), {
            tenantId: r.tenantId,
            limit: 100,
          } as Parameters<typeof leasing.service.listLeases>[1]);
          for (const l of page.items) {
            if (l.status === 'cancelled') continue;
            leases.push({
              leaseId: l.id,
              unitCode: l.unitCode,
              propertyName: l.propertyName,
              startDate: l.startDate,
              endDate: l.endDate,
              status: l.status as 'active' | 'terminated',
              currentRentCents: l.currentRentCents,
              balanceCents: l.balanceCents,
            });
          }
        }
        tenancies.push({
          orgId,
          landlordName: orgs.find((o) => o.id === orgId)?.name ?? '',
          leases,
        });
      }
      return { phone, phoneVerified: verified, tenancies };
    },

    async statement(
      userId: string,
      leaseId: string,
      q: { from?: string | undefined; to?: string | undefined },
    ) {
      const l = await lease(userId, leaseId);
      return leasing.views.statement(l.ctx, leaseId, q);
    },

    async receipt(userId: string, paymentId: string) {
      const { records: mine } = await records(userId);
      for (const orgId of new Set(mine.map((r) => r.orgId))) {
        const ctx = ctxFor(orgId, userId);
        const p = await payments.payments.get(ctx, paymentId).catch(() => null);
        if (!p?.leaseId) continue;
        await lease(userId, p.leaseId); // must be one of the caller's leases
        return payments.receipts.pdf(ctx, paymentId);
      }
      throw AppError.notFound('Payment');
    },

    async pay(userId: string, leaseId: string, body: z.infer<typeof PortalPayBody>) {
      const l = await lease(userId, leaseId);
      return payments.daraja.createStk(l.ctx, {
        leaseId,
        phone: l.phone,
        ...(body.amountCents !== undefined ? { amountCents: body.amountCents } : {}),
      });
    },

    async reportTicket(userId: string, body: z.infer<typeof PortalTicketBody>) {
      const l = await lease(userId, body.leaseId);
      return tickets.create(l.ctx, {
        unitId: l.unitId,
        title: body.title,
        category: body.category,
        reporterKind: 'tenant',
        tenantId: l.tenantId,
        ...(body.description ? { description: body.description } : {}),
      });
    },

    async tickets(userId: string) {
      const { records: mine } = await records(userId);
      const all = [];
      for (const r of mine)
        all.push(...(await tickets.forTenant(ctxFor(r.orgId, userId), r.tenantId)));
      return { items: all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)) };
    },
  };
}

export type PortalService = ReturnType<typeof createPortalService>;
