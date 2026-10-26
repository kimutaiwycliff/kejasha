import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyReply,
  type FastifyServerOptions,
} from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import type { AppDeps } from './deps';
import { problemType } from './errors';
import { registerModules } from './modules';
import { errorsPlugin } from './plugins/errors';
import { authPlugin } from './plugins/auth';
import { billingGatePlugin } from './plugins/billing-gate';
import { dateRangePlugin } from './plugins/date-range';
import { idempotencyPlugin } from './plugins/idempotency';
import { observabilityPlugin } from './plugins/observability';
import { openapiPlugin } from './plugins/openapi';
import { requestContextPlugin } from './plugins/request-context';
import { securityPlugin } from './plugins/security';

/** Error fields worth logging; SQL text and bound parameters are left out on purpose. */
function safeError(e: unknown, depth = 0): Record<string, unknown> {
  if (!(e instanceof Error)) return { message: String(e) };
  const x = e as Error & { code?: unknown; statusCode?: unknown; cause?: unknown };
  return {
    type: x.constructor?.name ?? 'Error',
    // Drizzle puts the SQL and its parameters in the message itself.
    message: x.message.startsWith('Failed query')
      ? 'Failed query (SQL and parameters redacted)'
      : x.message,
    stack: x.stack?.startsWith('Error: Failed query') ? undefined : x.stack,
    ...(x.code !== undefined ? { code: x.code } : {}),
    ...(x.statusCode !== undefined ? { statusCode: x.statusCode } : {}),
    ...(x.cause && depth < 2 ? { cause: safeError(x.cause, depth + 1) } : {}),
  };
}

const REQUEST_ID_RE = /^[A-Za-z0-9_\-.:]{1,128}$/;

/** Builds the API without listening. Used by the server, tests, journeys and spec generation. */
export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: [
        'req.headers.authorization',
        'req.headers.cookie',
        'res.headers["set-cookie"]',
        '*.password',
        '*.newPassword',
        '*.token',
        '*.passkey',
        '*.consumerSecret',
      ],
      // Database errors carry the SQL and its bound parameters (hashes, tokens, phones): never log
      // those, and never forward them to GlitchTip (review M8).
      serializers: {
        err: (e: Error) => {
          const out = safeError(e);
          return {
            ...out,
            type: String(out.type),
            message: String(out.message),
            stack: String(out.stack ?? ''),
          };
        },
      },
    },
    // One structured access line per request comes from request-context instead.
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
    },
    trustProxy: deps.config.api.trustProxy as FastifyServerOptions['trustProxy'],
    bodyLimit: 1024 * 1024,
    // A client that announces a body and never sends it must not hold a socket open (slowloris).
    // Node only enforces requestTimeout every connectionsCheckingInterval (default 30 s), so the
    // server is created here with a 2 s check.
    serverFactory: (handler) =>
      createServer({ requestTimeout: 15_000, connectionsCheckingInterval: 2_000 }, handler),
    // Router-level rejections (malformed URL encoding, path parameter longer than the router
    // allows) answer like every other bad request: 400 problem+json, not Fastify's own body.
    frameworkErrors: (err, req, reply) => {
      const code = err.code === 'FST_ERR_MAX_PARAM_LENGTH' ? 'path_too_long' : 'invalid_path';
      return (reply as unknown as FastifyReply)
        .status(400)
        .type('application/problem+json')
        .send({
          type: problemType(code),
          title: 'Bad request',
          status: 400,
          code,
          detail:
            code === 'path_too_long' ? 'A path parameter is too long.' : 'The URL is malformed.',
          requestId: req.id,
          instance: req.url,
        });
    },
    // Strip prototype-polluting keys rather than rejecting otherwise valid requests.
    onProtoPoisoning: 'remove',
    onConstructorPoisoning: 'remove',
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(observabilityPlugin, deps);
  await app.register(errorsPlugin);
  await app.register(requestContextPlugin);
  await app.register(securityPlugin, deps);
  // Before openapi: its onRoute hook stamps security onto each route schema.
  await app.register(authPlugin, deps);
  await app.register(billingGatePlugin, deps);
  await app.register(dateRangePlugin);
  await app.register(openapiPlugin);
  await app.register(idempotencyPlugin, { db: deps.db });
  await registerModules(app, deps);

  return app;
}
