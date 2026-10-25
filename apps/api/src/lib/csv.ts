import type { FastifyReply } from 'fastify';

/**
 * RFC 4180 CSV for exports. Cells that a spreadsheet would run as a formula (= + - @, tab, CR)
 * are prefixed with an apostrophe (CSV injection), except plain negative numbers.
 */
export type Cell = string | number | bigint | boolean | null | undefined;

function cell(v: Cell): string {
  if (v === null || v === undefined) return '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

/** Cents → "12345.67" (plain decimal, no grouping, for spreadsheets). */
export function kes(cents: bigint): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  return `${neg ? '-' : ''}${a / 100n}.${String(a % 100n).padStart(2, '0')}`;
}

/** Send a CSV download, bypassing the JSON serializer. */
export function sendCsv<R extends FastifyReply>(reply: R, filename: string, body: string): R {
  reply.header(
    'content-disposition',
    `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
  );
  return reply
    .type('text/csv; charset=utf-8')
    .serializer((p: unknown) => p as string)
    .send(body) as R;
}
