import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import type { Role } from '@kejasha/auth';

/** Who is calling. Set by the auth plugin; read by logging, idempotency scoping and audit. */
export interface Actor {
  userId: string;
  sessionId: string;
  orgId?: string | undefined;
  role?: Role | undefined;
  /** Viewers scoped to one client landlord see only that landlord's figures. */
  scope?: string | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | undefined;
  }
}

/** Request id echo + one structured access log line per request. */
export const requestContextPlugin = fp(async (app: FastifyInstance) => {
  app.decorateRequest('actor', undefined);

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-request-id', req.id);
  });

  app.addHook('onResponse', async (req, reply) => {
    req.log.info(
      {
        orgId: req.actor?.orgId,
        userId: req.actor?.userId,
        method: req.method,
        route: req.routeOptions.url ?? 'unmatched',
        status: reply.statusCode,
        ms: Math.round(reply.elapsedTime),
      },
      'request completed',
    );
  });
});
