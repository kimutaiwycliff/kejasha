import { problemResponse } from '@kejasha/contracts';
import { eq, schema } from '@kejasha/db';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from '../deps';
import { AppError } from '../errors';
import { effectiveStatus } from '../modules/subscriptions';

/**
 * No free use (B6b): an org's writes need a paid subscription. Reads always work.
 * - `open` routes (billing, org profile, members, invitations) work in every state, so an
 *   unpaid or suspended org can always pay and manage its people.
 * - `setup` routes (landlords, properties, units) also work while `incomplete`, so a new org can
 *   set up before its first payment.
 * - Everything else answers 402 `subscription_required` (never paid) or `subscription_suspended`.
 */
const OPEN = [
  /^\/v1\/billing(\/|$)/,
  /^\/v1\/org$/,
  /^\/v1\/members(\/|$)/,
  /^\/v1\/invitations(\/|$)/,
];
const SETUP = [/^\/v1\/client-landlords(\/|$)/, /^\/v1\/properties(\/|$)/, /^\/v1\/units\/:id$/];
const WRITE = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

declare module 'fastify' {
  interface FastifyContextConfig {
    billing?: 'open' | 'setup' | 'paid';
  }
}

export const billingGatePlugin = fp(async (app: FastifyInstance, deps: AppDeps) => {
  const { db, clock, config } = deps;

  app.addHook('onRoute', (route) => {
    if (!route.url.startsWith('/v1/')) return;
    const cfg = (route.config ??= {});
    cfg.billing ??= OPEN.some((r) => r.test(route.url))
      ? 'open'
      : SETUP.some((r) => r.test(route.url))
        ? 'setup'
        : 'paid';
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const orgRoute = cfg.auth === undefined || cfg.auth === 'org';
    if (orgRoute && cfg.billing !== 'open' && methods.some((m) => WRITE.has(m)) && route.schema) {
      const s = route.schema as { response?: Record<string | number, unknown> };
      s.response ??= {};
      s.response[402] ??= problemResponse(402);
    }
  });

  app.addHook('onRequest', async (req) => {
    if (!config.billing.required || !WRITE.has(req.method)) return;
    // Only org routes act on the org; user routes (portal, identity) do not, even with an active org.
    const auth = req.routeOptions.config.auth;
    if (auth !== undefined && auth !== 'org') return;
    const orgId = req.actor?.orgId;
    const level = req.routeOptions.config.billing ?? 'paid';
    if (!orgId || level === 'open') return;
    const [s] = await db.owner
      .select({ status: schema.subscription.status, trialEndsOn: schema.subscription.trialEndsOn })
      .from(schema.subscription)
      .where(eq(schema.subscription.orgId, orgId));
    const status = effectiveStatus(s, clock.today());
    if (status === 'active' || status === 'past_due' || status === 'trialing') return;
    if (status === 'incomplete') {
      if (level === 'setup') return;
      throw new AppError(
        402,
        'subscription_required',
        'Payment required',
        'Pay for your first month in Billing to start using Kejasha.',
      );
    }
    throw new AppError(
      402,
      'subscription_suspended',
      'Payment required',
      'Your account is read-only until the subscription is paid (Billing).',
    );
  });
});
