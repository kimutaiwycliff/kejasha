import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from '../deps';

/**
 * CORS from APP_DOMAIN-derived origins (ADR-016), security headers, and a Redis-backed rate
 * limiter that is OFF unless a route opts in with `config: { rateLimit: {...} }`.
 */
export const securityPlugin = fp(async (app: FastifyInstance, deps: AppDeps) => {
  await app.register(cors, {
    origin: deps.config.domain.trustedOrigins,
    credentials: true,
    exposedHeaders: ['x-request-id', 'idempotent-replayed'],
  });
  await app.register(helmet, {
    // Set per response below: strict for the API, none for Scalar's own bundle at /docs.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  // The API serves JSON, PDFs and CSV only: nothing may run, frame or load from them (review L4).
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.url.startsWith('/docs'))
      reply.header(
        'content-security-policy',
        "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
      );
    return payload;
  });
  await app.register(rateLimit, {
    global: false,
    redis: deps.redis,
    nameSpace: 'kj:rl:',
    skipOnError: true,
  });
});
