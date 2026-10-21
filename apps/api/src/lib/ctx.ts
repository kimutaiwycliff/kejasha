import type { Role } from '@kejasha/auth';
import { withTenant, type Db, type Tx } from '@kejasha/db';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors';
// Bring the FastifyRequest augmentations (actor, tenant) into any program that imports services,
// e.g. the worker, which never loads the plugins themselves.
import type {} from '../plugins/auth';
import type {} from '../plugins/request-context';

/**
 * Who is acting, independent of transport. HTTP handlers build it from the request; the worker's
 * scheduled jobs build a `system` context — both run the same service code.
 */
export interface Ctx {
  orgId: string;
  userId?: string | undefined;
  role?: Role | undefined;
  actorKind: 'user' | 'system';
  requestId?: string | undefined;
}

export function ctxOf(req: FastifyRequest): Ctx {
  const a = req.actor;
  if (!a?.orgId)
    throw new AppError(
      403,
      'no_active_org',
      'No active organization',
      'Select an organization first.',
    );
  return { orgId: a.orgId, userId: a.userId, role: a.role, actorKind: 'user', requestId: req.id };
}

export function systemCtx(orgId: string): Ctx {
  return { orgId, actorKind: 'system' };
}

export function inTenant<T>(db: Db, ctx: Ctx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withTenant(db, { orgId: ctx.orgId, userId: ctx.userId }, fn);
}
