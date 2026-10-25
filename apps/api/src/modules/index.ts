import { inArray, schema } from '@kejasha/db';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../deps';
import { accountsRoutes, createAccountsService } from './accounts';
import { createIdentityService, identityRoutes, toUser } from './identity';
import { complianceRoutes, createCompliance } from './compliance';
import { createLeasing, leasingRoutes } from './leasing';
import { createMaintenanceService, maintenanceRoutes } from './maintenance';
import { createPayments, paymentsRoutes } from './payments';
import { platformRoutes } from './platform';
import { createReportingModule, reportingRoutes } from './reporting';
import { createShortStay, shortStayRoutes } from './shortstay';

/**
 * Composition root (ADR-001): builds module services, wires cross-module hooks, registers routes.
 * Modules never import each other's internals; dependencies are injected here.
 */
export async function registerModules(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const orgCreated: Parameters<typeof createIdentityService>[1]['orgCreated'] = [];
  const memberRemoved: Parameters<typeof createIdentityService>[1]['memberRemoved'] = [];
  const identity = createIdentityService(deps, { orgCreated, memberRemoved });

  const accounts = createAccountsService(deps, {
    memberRoles: identity.memberRoles,
    async users(ids) {
      if (!ids.length) return new Map();
      const rows = await deps.db.owner
        .select()
        .from(schema.user)
        .where(inArray(schema.user.id, ids));
      return new Map(rows.map((u) => [u.id, { name: toUser(u).name, phone: toUser(u).phone }]));
    },
  });
  orgCreated.push(accounts.onOrgCreated);
  memberRemoved.push(accounts.onMemberRemoved);

  await app.register(platformRoutes, deps);
  await app.register(identityRoutes(identity), deps);
  await app.register(accountsRoutes(accounts), deps);
  await app.register(leasingRoutes(createLeasing(deps)), deps);
  await app.register(paymentsRoutes(createPayments(deps)), deps);
  await app.register(shortStayRoutes(createShortStay(deps)), deps);
  await app.register(
    maintenanceRoutes(createMaintenanceService(deps, { memberRoles: identity.memberRoles })),
    deps,
  );
  await app.register(
    complianceRoutes(createCompliance(deps, { staffContacts: identity.staffContacts })),
    deps,
  );
  await app.register(reportingRoutes(createReportingModule(deps)), deps);
}
