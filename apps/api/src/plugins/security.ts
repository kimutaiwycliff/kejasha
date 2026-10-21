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
    // Scalar at /docs needs inline scripts/styles from its own bundle.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(rateLimit, {
    global: false,
    redis: deps.redis,
    nameSpace: 'kj:rl:',
    skipOnError: true,
  });
});
