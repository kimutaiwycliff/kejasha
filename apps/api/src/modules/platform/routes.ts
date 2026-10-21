import { HealthResponse, MetaConfigResponse, problemResponses } from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { checkHealth, metaConfig } from './service';

export const platformRoutes: FastifyPluginAsyncZod<AppDeps> = async (app, deps) => {
  app.get(
    '/v1/health',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['platform'],
        summary: 'Liveness and dependency health',
        description: 'Returns 200 when every configured dependency is up, 503 otherwise.',
        response: { 200: HealthResponse, 503: HealthResponse, ...problemResponses() },
      },
    },
    async (_req, reply) => {
      const health = await checkHealth(deps);
      return reply.status(health.status === 'ok' ? 200 : 503).send(health);
    },
  );

  app.get(
    '/v1/meta/config',
    {
      schema: {
        operationId: 'getMetaConfig',
        tags: ['platform'],
        summary: 'Canonical client configuration',
        description:
          'Installed clients read this to discover the canonical API URL after a domain move (ADR-016).',
        response: { 200: MetaConfigResponse, ...problemResponses() },
      },
    },
    async () => metaConfig(deps),
  );
};
