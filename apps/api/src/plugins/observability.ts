import * as Sentry from '@sentry/node';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { AppDeps } from '../deps';

/** GlitchTip (Sentry SDK) error capture; a no-op without GLITCHTIP_DSN. */
export const observabilityPlugin = fp(async (app: FastifyInstance, deps: AppDeps) => {
  const dsn = deps.config.observability.glitchtipDsn;
  if (!dsn) return;
  Sentry.init({ dsn, environment: deps.config.env, release: deps.version, tracesSampleRate: 0 });
  app.decorate('captureException', (err: unknown, req?: FastifyRequest) => {
    Sentry.withScope((scope) => {
      if (req) {
        scope.setTag('requestId', req.id);
        scope.setTag('route', req.routeOptions.url ?? 'unmatched');
        if (req.actor?.orgId) scope.setTag('orgId', req.actor.orgId);
      }
      Sentry.captureException(err);
    });
  });
  app.addHook('onClose', async () => {
    await Sentry.close(2000);
  });
});
