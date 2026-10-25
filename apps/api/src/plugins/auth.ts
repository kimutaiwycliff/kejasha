import { hasRole, isRole, type Role } from '@kejasha/auth';
import { problemResponse } from '@kejasha/contracts';
import { and, eq, schema, withTenant, type Tx } from '@kejasha/db';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from '../deps';
import { AppError } from '../errors';
import { toFetchHeaders } from '../lib/headers';

/**
 * Authentication & authorisation for every route (ADR-004).
 * - Routes under /v1 default to `auth: 'org'` (signed in with an active org). Public routes must
 *   opt out with `config: { auth: 'public' }`; `'user'` needs a session but no org.
 * - `minRole` enforces owner > manager > agent > caretaker.
 * - `viewer` members are denied by default: only routes with `allowViewer` admit them, and in an
 *   agency they must be scoped to one client landlord (`member_scope`).
 * - Each route's OpenAPI `security` and 401/403 responses are derived from this config, so the
 *   documentation cannot drift from what is enforced.
 */
export type AuthMode = 'public' | 'user' | 'org';

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: AuthMode;
    minRole?: Role;
    /** Read-only owners (`viewer`) may call this route; every other org route refuses them. */
    allowViewer?: boolean;
  }
  interface FastifyRequest {
    /** Run `fn` in a tenant transaction for the caller's active org (RLS applies). */
    tenant<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  }
}

const SECURED = [{ bearerAuth: [] }, { cookieAuth: [] }];

function modeOf(url: string | undefined, configured: AuthMode | undefined): AuthMode {
  if (configured) return configured;
  return url?.startsWith('/v1/') ? 'org' : 'public';
}

export const authPlugin = fp(async (app: FastifyInstance, deps: AppDeps) => {
  const { auth, db } = deps;

  app.addHook('onRoute', (route) => {
    const mode = modeOf(route.url, route.config?.auth);
    if (!route.url.startsWith('/v1/') || !route.schema) return;
    const schemaObj = route.schema as Record<string, unknown> & {
      response?: Record<string | number, unknown>;
    };
    schemaObj.security = mode === 'public' ? [] : SECURED;
    if (mode !== 'public') {
      schemaObj.response ??= {};
      schemaObj.response[401] ??= problemResponse(401);
      schemaObj.response[403] ??= problemResponse(403);
    }
  });

  app.decorateRequest('tenant', async function <
    T,
  >(this: FastifyRequest, fn: (tx: Tx) => Promise<T>) {
    const orgId = this.actor?.orgId;
    if (!orgId)
      throw new AppError(
        403,
        'no_active_org',
        'No active organization',
        'Select an organization first.',
      );
    return withTenant(db, { orgId, userId: this.actor?.userId }, fn);
  });

  app.addHook('onRequest', async (req) => {
    if (req.method === 'OPTIONS' || req.routeOptions.url === undefined) return;
    const mode = modeOf(req.routeOptions.url, req.routeOptions.config.auth);
    if (mode === 'public') return;

    const result = await auth.api.getSession({ headers: toFetchHeaders(req) });
    if (!result) {
      throw new AppError(
        401,
        'unauthenticated',
        'Unauthenticated',
        'Sign in and send the session cookie or a Bearer token.',
      );
    }
    const orgId =
      (result.session as { activeOrganizationId?: string | null }).activeOrganizationId ??
      undefined;
    let role: Role | undefined;
    if (orgId) {
      const [m] = await db.owner
        .select({ role: schema.member.role })
        .from(schema.member)
        .where(
          and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, result.user.id)),
        )
        .limit(1);
      role = isRole(m?.role) ? m.role : undefined;
    }
    // A session whose active org the user no longer belongs to behaves as "no active org".
    req.actor = {
      userId: result.user.id,
      sessionId: result.session.id,
      orgId: role ? orgId : undefined,
      role,
    };

    if (mode === 'org' && !req.actor.orgId) {
      throw new AppError(
        403,
        'no_active_org',
        'No active organization',
        'Create or select an organization first.',
      );
    }
    if (mode === 'org' && req.actor.role === 'viewer') {
      if (!req.routeOptions.config.allowViewer)
        throw new AppError(
          403,
          'viewer_read_only',
          'Forbidden',
          'Read-only members can only view dashboards, statements and reports.',
        );
      const orgId = req.actor.orgId!;
      const [org] = await db.owner
        .select({ kind: schema.organization.kind })
        .from(schema.organization)
        .where(eq(schema.organization.id, orgId));
      const [scope] = await withTenant(db, { orgId, userId: req.actor.userId }, (tx) =>
        tx
          .select({ id: schema.memberScope.clientLandlordId })
          .from(schema.memberScope)
          .where(eq(schema.memberScope.userId, req.actor!.userId)),
      );
      if (org?.kind === 'agency' && !scope)
        throw new AppError(
          403,
          'viewer_scope_required',
          'Forbidden',
          'Ask the agency to link your account to your landlord record.',
        );
      req.actor.scope = scope?.id;
      return;
    }
    const minRole = req.routeOptions.config.minRole;
    if (minRole && (!req.actor.role || !hasRole(req.actor.role, minRole))) {
      throw new AppError(
        403,
        'insufficient_role',
        'Forbidden',
        `This action needs the ${minRole} role or higher.`,
      );
    }
  });
});
