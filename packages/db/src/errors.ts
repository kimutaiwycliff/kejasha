/** Postgres error details, unwrapping Drizzle's query-error wrapper. */
export interface PgErrorInfo {
  code: string;
  constraint?: string | undefined;
  detail?: string | undefined;
}

export function pgError(err: unknown): PgErrorInfo | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (
      typeof e === 'object' &&
      e &&
      'code' in e &&
      typeof e.code === 'string' &&
      /^[0-9A-Z]{5}$/.test(e.code)
    ) {
      const o = e as { code: string; constraint?: string; detail?: string };
      return { code: o.code, constraint: o.constraint, detail: o.detail };
    }
    e = typeof e === 'object' && e && 'cause' in e ? e.cause : undefined;
  }
  return undefined;
}

export const PG = {
  uniqueViolation: '23505',
  foreignKeyViolation: '23503',
  checkViolation: '23514',
  insufficientPrivilege: '42501',
  exclusionViolation: '23P01',
  invalidByteSequence: '22021',
  untranslatableCharacter: '22P05',
} as const;
