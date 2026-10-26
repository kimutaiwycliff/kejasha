import type { ProblemDetails } from '@kejasha/contracts';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import Router from 'find-my-way';
import { PG, pgError } from '@kejasha/db';
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
} from 'fastify-type-provider-zod';
import { AppError, problemType } from '../errors';

const TITLES: Record<number, string> = {
  400: 'Bad request',
  401: 'Unauthorized',
  402: 'Payment required',
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
    } else if (isBetterAuthError(err)) {
      const upstream = err.body?.code ?? 'AUTH_ERROR';
      const [status, code] = BETTER_AUTH_ERRORS[upstream] ?? [
        err.statusCode,
        upstream.toLowerCase(),
      ];
      problem = {
        type: problemType(code),
        title: TITLES[status] ?? 'Request error',
        status,
        code,
        ...(err.body?.message ? { detail: err.body.message } : {}),
      };
    } else if (pgConstraint(err)) {
      problem = pgConstraint(err)!;
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

/** Constraint violations that escape a service become 409/422, never 500. */
function pgConstraint(err: unknown): ProblemDetails | undefined {
  const pg = pgError(err);
  if (!pg) return undefined;
  const map: Record<string, [number, string, string]> = {
    [PG.uniqueViolation]: [409, 'conflict', 'This would create a duplicate.'],
    [PG.exclusionViolation]: [409, 'overlap', 'This overlaps an existing record.'],
    [PG.checkViolation]: [422, 'constraint_violation', 'The values are not consistent.'],
    [PG.foreignKeyViolation]: [422, 'invalid_reference', 'A referenced record does not exist.'],
    // Backstop: contracts reject NUL; any other text Postgres cannot encode is a documented 422
    // (a schema-valid request must never be answered with 400).
    [PG.invalidByteSequence]: [
      422,
      'invalid_text',
      'The text contains characters that cannot be stored.',
    ],
    [PG.untranslatableCharacter]: [
      422,
      'invalid_text',
      'The text contains characters that cannot be stored.',
    ],
  };
  const hit = map[pg.code];
  if (!hit) return undefined;
  const [status, code, detail] = hit;
  return {
    type: problemType(code),
    title: TITLES[status] ?? 'Request error',
    status,
    code,
    detail: pg.constraint ? `${detail} (${pg.constraint})` : detail,
  };
}

/**
 * Better Auth error codes → our status + stable code. Credential failures are 401, duplicates 409,
 * throttling 429; anything unmapped keeps Better Auth's status with its code lower-cased.
 */
const BETTER_AUTH_ERRORS: Record<string, [number, string]> = {
  INVALID_EMAIL_OR_PASSWORD: [401, 'invalid_credentials'],
  INVALID_OTP: [401, 'invalid_otp'],
  OTP_EXPIRED: [401, 'otp_expired'],
  OTP_NOT_FOUND: [401, 'invalid_otp'],
  INVALID_TOKEN: [401, 'invalid_token'],
  TOO_MANY_ATTEMPTS: [429, 'too_many_attempts'],
  USER_ALREADY_EXISTS: [409, 'email_taken'],
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: [409, 'email_taken'],
  USER_IS_ALREADY_A_MEMBER_OF_THIS_ORGANIZATION: [409, 'already_a_member'],
  USER_IS_ALREADY_INVITED_TO_THIS_ORGANIZATION: [409, 'already_invited'],
  INVITATION_NOT_FOUND: [404, 'not_found'],
  YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION: [403, 'not_invitation_recipient'],
};

interface BetterAuthError {
  name: 'APIError';
  statusCode: number;
  body?: { code?: string; message?: string };
}

function isBetterAuthError(err: unknown): err is BetterAuthError {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { name?: unknown }).name === 'APIError' &&
    typeof (err as { statusCode?: unknown }).statusCode === 'number' &&
    (err as { statusCode: number }).statusCode < 500
  );
}

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
