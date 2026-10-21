import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    /** Populated by auth in B1; read by logging, idempotency scoping and audit. */
    actor: { orgId?: string; userId?: string } | undefined;
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
