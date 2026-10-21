import { AppError } from '../errors';

/**
 * Opaque keyset cursors: base64url JSON of the sort key values of the last row returned.
 * Lists fetch `limit + 1` rows to know whether another page exists.
 */
export function encodeCursor(values: (string | number | null)[]): string {
  return Buffer.from(JSON.stringify(values)).toString('base64url');
}

export function decodeCursor(
  cursor: string | undefined,
  arity: number,
): (string | number | null)[] | undefined {
  if (!cursor) return undefined;
  try {
    const values = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (Array.isArray(values) && values.length === arity)
      return values as (string | number | null)[];
  } catch {
    // fall through
  }
  throw AppError.unprocessable('invalid_cursor', 'The cursor is malformed or from another list.');
}

export function page<T>(rows: T[], limit: number, keyOf: (row: T) => (string | number | null)[]) {
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(keyOf(last)) : null };
}
