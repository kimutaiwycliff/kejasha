import { z } from 'zod';

/**
 * Shared contract primitives (ADR-002). Every schema that appears as a request or response body
 * is named with `.meta({ id })` so it becomes a reusable OpenAPI component and a named type in
 * the generated TypeScript and Kotlin clients (ADR-017).
 */

export const Uuid = z.uuid().meta({ description: 'UUID identifier' });

/**
 * Input rules: the documented JSON Schema must describe exactly what is accepted, so no hidden
 * trimming/upper-casing runs before validation. Normalisation happens in transforms afterwards.
 */
export const IdInput = z.guid().meta({ description: 'UUID identifier' });
/** Any string Postgres can store: no NUL characters. */
export const SafeString = (max: number) =>
  z
    .string()
    .max(max)
    // eslint-disable-next-line no-control-regex -- NUL is exactly what must be rejected
    .regex(/^[^\u0000]*$/, 'Must not contain NUL characters');
/** Optional free text; surrounding whitespace is trimmed after validation. */
export const TextInput = (max: number) => SafeString(max).transform((v) => v.trim());
/** Required text with at least one non-space character; trimmed after validation. */
export const RequiredTextInput = (max: number, min = 1) =>
  z
    .string()
    .min(min)
    .max(max)
    // eslint-disable-next-line no-control-regex -- NUL is exactly what must be rejected
    .regex(/^[^\u0000]*\S[^\u0000]*$/, 'Must not be blank')
    .transform((v) => v.trim());

/** Money in minor units (cents) — int64 on the wire, `bigint` in the domain (ADR-006). */
export const Cents = z.int().meta({
  format: 'int64',
  description: 'Amount in minor units (cents). KES 1.00 = 100.',
});

export const Currency = z.enum(['KES']).meta({ id: 'Currency' });

export const Money = z
  .object({ amountCents: Cents, currency: Currency })
  .meta({ id: 'Money', description: 'A monetary amount in minor units.' });

export const IsoDate = z.iso
  .date()
  .meta({ description: 'Africa/Nairobi business date (YYYY-MM-DD)' });

/**
 * Business-date input. Years outside 1900–2199 answer 422 `date_out_of_range` (enforced centrally
 * by the API), keeping the schema simple enough for clients and fuzzers.
 */
export const BusinessDateInput = z.iso.date().meta({
  description: 'Africa/Nairobi business date (YYYY-MM-DD); years 1900–2199',
  example: '2026-10-21',
});
export const Timestamp = z.iso.datetime({ offset: true }).meta({ description: 'RFC 3339 instant' });

/** A stored file with a short-lived download link (empty when storage is not configured). */
export const FileLink = z.object({ key: z.string(), url: z.string() }).meta({ id: 'FileLink' });

export const FieldError = z
  .object({
    path: z.string().meta({ description: 'Dotted path to the offending field, e.g. body.phone' }),
    message: z.string(),
  })
  .meta({ id: 'FieldError' });

/** RFC 9457 problem details. `code` is the stable machine-readable error identifier. */
export const ProblemDetails = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.int(),
    code: z.string(),
    detail: z.string().optional(),
    instance: z.string().optional(),
    requestId: z.string().optional(),
    errors: z.array(FieldError).optional(),
  })
  .meta({ id: 'ProblemDetails' });
export type ProblemDetails = z.infer<typeof ProblemDetails>;

export const CursorQuery = z.object({
  cursor: z
    .string()
    .max(512)
    .regex(/^[A-Za-z0-9_-]*$/, 'Invalid cursor')
    .optional()
    .meta({
      description: 'Opaque cursor from `nextCursor`; an unknown cursor answers 422 invalid_cursor',
    }),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

/** Cursor pagination envelope; `name` gives the component a stable id, e.g. `UnitPage`. */
export function pageOf<T extends z.ZodType>(item: T, name: string) {
  return z
    .object({ items: z.array(item), nextCursor: z.string().nullable() })
    .meta({ id: `${name}Page` });
}

type ErrorStatus = 400 | 401 | 403 | 404 | 405 | 409 | 422 | 429 | 500 | 503;

const ERROR_DESCRIPTIONS: Record<ErrorStatus, string> = {
  400: 'Validation failed',
  401: 'Not signed in',
  403: 'Not allowed',
  404: 'Not found',
  405: 'Method not allowed',
  409: 'Conflict',
  422: 'Unprocessable',
  429: 'Rate limited',
  500: 'Internal error',
  503: 'Unavailable',
};

/** One problem response, documented with its real media type (RFC 9457). */
export function problemResponse(status: ErrorStatus) {
  return {
    description: ERROR_DESCRIPTIONS[status],
    content: { 'application/problem+json': { schema: ProblemDetails } },
  };
}
export type ProblemResponse = ReturnType<typeof problemResponse>;

/** Problem responses for a route's schema.response map. 400 and 500 are always included. */
export function problemResponses<S extends ErrorStatus = never>(...statuses: S[]) {
  const all = [...new Set<ErrorStatus>([400, 500, ...statuses])];
  return Object.fromEntries(all.map((s) => [s, problemResponse(s)])) as Record<
    S | 400 | 500,
    ProblemResponse
  >;
}
