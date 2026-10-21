import { problemResponse } from '@kejasha/contracts';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { AppError } from '../errors';

const ISO_DATE = /^(\d{4})-\d{2}-\d{2}$/;
const ISO_PERIOD = /^(\d{4})-\d{2}$/;
const MIN_YEAR = 1900;
const MAX_YEAR = 2199;

function findOutOfRange(value: unknown, depth = 0): string | undefined {
  if (depth > 6 || value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    const m = ISO_DATE.exec(value) ?? ISO_PERIOD.exec(value);
    if (m) {
      const year = Number(m[1]);
      if (year < MIN_YEAR || year > MAX_YEAR) return value;
    }
    return undefined;
  }
  if (Array.isArray(value)) {
    for (const v of value) {
      const hit = findOutOfRange(v, depth + 1);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof value === 'object') {
    for (const v of Object.values(value)) {
      const hit = findOutOfRange(v, depth + 1);
      if (hit) return hit;
    }
  }
  return undefined;
}

/**
 * Business dates must fall in 1900–2199. Far-away dates are valid ISO but meaningless here and
 * would make billing iterate over thousands of months, so they are refused (422) before handlers.
 */
export const dateRangePlugin = fp(async (app: FastifyInstance) => {
  // Every route that takes a body or query can answer 422 date_out_of_range — say so in the spec.
  app.addHook('onRoute', (route) => {
    const schema = route.schema as
      (Record<string, unknown> & { response?: Record<string | number, unknown> }) | undefined;
    if (!schema || !route.url.startsWith('/v1/') || !(schema.body || schema.querystring)) return;
    schema.response ??= {};
    schema.response[422] ??= problemResponse(422);
  });

  app.addHook('preHandler', async (req) => {
    const hit = findOutOfRange(req.body) ?? findOutOfRange(req.query);
    if (hit) {
      throw AppError.unprocessable(
        'date_out_of_range',
        `${hit} is outside the supported range (${MIN_YEAR}–${MAX_YEAR}).`,
      );
    }
  });
});
