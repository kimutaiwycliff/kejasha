/** Postgres SQLSTATE from an error, unwrapping Drizzle's query error wrapper. */
export function pgCode(err: unknown): string | undefined {
  let e: unknown = err;
  for (let i = 0; i < 5 && e; i++) {
    if (typeof e === 'object' && e && 'code' in e && typeof e.code === 'string') return e.code;
    e = typeof e === 'object' && e && 'cause' in e ? e.cause : undefined;
  }
  return undefined;
}

export async function expectPgError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (err) {
    const actual = pgCode(err);
    if (actual === code) return;
    throw new Error(`Expected SQLSTATE ${code}, got ${actual ?? 'none'}: ${String(err)}`, {
      cause: err,
    });
  }
  throw new Error(`Expected SQLSTATE ${code}, but the statement succeeded`);
}
