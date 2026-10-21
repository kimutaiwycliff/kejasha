import { randomUUID } from 'node:crypto';
import Fastify, { LogController, type FastifyInstance } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppDeps } from './deps';
import { registerModules } from './modules';
import { errorsPlugin } from './plugins/errors';
import { idempotencyPlugin } from './plugins/idempotency';
import { observabilityPlugin } from './plugins/observability';
import { openapiPlugin } from './plugins/openapi';
import { requestContextPlugin } from './plugins/request-context';
import { securityPlugin } from './plugins/security';

const REQUEST_ID_RE = /^[A-Za-z0-9_\-.:]{1,128}$/;

/** Builds the API without listening. Used by the server, tests, journeys and spec generation. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
    },
    // One structured access line per request comes from request-context instead.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(observabilityPlugin, deps);
  await app.register(errorsPlugin);
  await app.register(requestContextPlugin);
  await app.register(securityPlugin, deps);
  await app.register(openapiPlugin);
  await app.register(idempotencyPlugin, { db: deps.db });
  await registerModules(app, deps);

  return app;
}
