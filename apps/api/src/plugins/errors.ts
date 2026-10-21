import type { ProblemDetails } from '@kejasha/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import Router from 'find-my-way';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError, problemType } from '../errors';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  413: 'Payload too large',
  415: 'Unsupported media type',
  422: 'Unprocessable',
  429: 'Too many requests',
  500: 'Internal server error',
  503: 'Service unavailable',
};

function codeFromFastify(err: FastifyError): string {
  return (err.code ?? 'error').replace(/^FST_(ERR_)?/, '').toLowerCase();
}

/** Every error leaves the API as application/problem+json. */
export const errorsPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((err: FastifyError, req, reply) => {
    let problem: ProblemDetails;

    if (hasZodFastifySchemaValidationErrors(err)) {
      problem = {
        type: problemType('validation_error'),
        title: 'Validation failed',
        status: 400,
        code: 'validation_error',
        detail: 'The request did not match the schema.',
        errors: err.validation.map((v) => ({
          path: [
            err.validationContext,
            ...(v.instancePath ? v.instancePath.slice(1).split('/') : []),
          ]
            .filter(Boolean)
            .join('.'),
          message: v.message ?? 'Invalid value',
        })),
      };
    } else if (err instanceof AppError) {
      problem = {
        type: problemType(err.code),
        title: err.title,
        status: err.status,
        code: err.code,
        ...(err.detail ? { detail: err.detail } : {}),
      };
    } else if (isResponseSerializationError(err)) {
      req.log.error({ err, issues: err.cause.issues }, 'response failed contract validation');
      problem = internal();
    } else if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      const code = codeFromFastify(err);
      problem = {
        type: problemType(code),
        title: TITLES[err.statusCode] ?? 'Request error',
        status: err.statusCode,
        code,
        detail: err.message,
      };
    } else {
      req.log.error({ err }, 'unhandled error');
      problem = internal();
    }

    problem.requestId = req.id;
    problem.instance = req.url;
    if (problem.status >= 500) app.captureException?.(err, req);
    return reply.status(problem.status).type('application/problem+json').send(problem);
  });

  // Index of path pattern → methods, so a wrong method on a real path is 405 (with Allow), not 404.
  const paths = Router();
  const methodsByPattern = new Map<string, Set<string>>();
  app.addHook('onRoute', (route) => {
    if (route.url === '*' || route.url === '/*') return; // CORS preflight catch-all
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    let set = methodsByPattern.get(route.url);
    if (!set) {
      set = new Set();
      methodsByPattern.set(route.url, set);
      paths.on('GET', route.url, () => {}, { pattern: route.url });
    }
    for (const m of methods) set.add(m.toUpperCase());
  });

  // Methods outside this set (e.g. QUERY, TRACE) are refused before body parsing kicks in.
  app.addHook('onRequest', async (req, reply) => {
    if (STANDARD_METHODS.has(req.method)) return;
    return notFound(req, reply);
  });

  app.setNotFoundHandler((req, reply) => notFound(req, reply));

  function notFound(req: FastifyRequest, reply: FastifyReply) {
    const match = paths.find('GET', req.url.split('?')[0] ?? req.url);
    const allowed = match
      ? methodsByPattern.get((match.store as { pattern: string }).pattern)
      : undefined;
    if (allowed && !allowed.has(req.method)) {
      const allow = [...allowed].sort().join(', ');
      const problem: ProblemDetails = {
        type: problemType('method_not_allowed'),
        title: 'Method not allowed',
        status: 405,
        code: 'method_not_allowed',
        detail: `${req.method} is not supported here. Allowed: ${allow}`,
        requestId: req.id,
      };
      return reply
        .status(405)
        .header('allow', allow)
        .type('application/problem+json')
        .send(problem);
    }
    const problem: ProblemDetails = {
      type: problemType('route_not_found'),
      title: 'Not found',
      status: 404,
      code: 'route_not_found',
      detail: `${req.method} ${req.url} does not exist`,
      requestId: req.id,
    };
    return reply.status(404).type('application/problem+json').send(problem);
  }
});

const STANDARD_METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);

function internal(): ProblemDetails {
  return {
    type: problemType('internal_error'),
    title: 'Internal server error',
    status: 500,
    code: 'internal_error',
    detail: 'Something went wrong. Quote the requestId when contacting support.',
  };
}

declare module 'fastify' {
  interface FastifyInstance {
    captureException?: (err: unknown, req?: FastifyRequest) => void;
  }
}
