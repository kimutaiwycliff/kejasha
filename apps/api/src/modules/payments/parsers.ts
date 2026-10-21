import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { money, phone as phoneLib } from '@kejasha/core';

// Resolved lazily: processes that bundle this module but never parse PDFs (the worker) need not
// have pdfjs-dist installed.
const standardFonts = () =>
  `${join(dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json')), 'standard_fonts')}/`;

/**
 * Parsers for reconciliation without a Paybill (ADR-009). Layouts follow Safaricom's documented
 * formats; they are tested against synthetic fixtures and must be re-validated against real
 * statements/SMS before launch (B3 plan, "honest limits").
 */
export interface ParsedPayment {
  providerRef: string;
  paidAt: Date;
  amountCents: bigint;
  msisdn: string | null;
  payerName: string | null;
  accountRef: string | null;
}

export class ParseError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

const REF = /^[A-Z0-9]{10}$/;
const MASKED_OR_FULL_PHONE =
  /(\+?254\d{9}|0[17]\d{8}|0[17]\d{2}\*{3}\d{3}|254[17]\d{2}\*{3,6}\d{3})/;

/** Nairobi wall time → instant. Accepts YYYY-MM-DD, DD-MM-YYYY or DD/MM/YYYY with HH:mm[:ss]. */
export function parseNairobiDateTime(value: string): Date {
  const v = value.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
  let y: string, mo: string, d: string;
  if (m) [, y, mo, d] = m as unknown as [string, string, string, string];
  else {
    m = /^(\d{1,2})[-/](\d{1,2})[-/](\d{4}) (\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(v);
    if (!m) throw new ParseError('bad_date', `Unrecognised date: ${value}`);
    [, d, mo, y] = m as unknown as [string, string, string, string];
  }
  const iso = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}T${m[4]!.padStart(2, '0')}:${m[5]}:${m[6] ?? '00'}+03:00`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new ParseError('bad_date', `Invalid date: ${value}`);
  return date;
}

/** "254712345678 - JANE WANJIRU" / "0712***678 JANE WANJIRU" → phone + name. */
export function splitParty(text: string): { msisdn: string | null; payerName: string | null } {
  const m = MASKED_OR_FULL_PHONE.exec(text);
  const raw = m?.[1] ?? null;
  const msisdn = raw ? (phoneLib.normalizeKenyanPhone(raw) ?? raw) : null;
  const name = text
    .replace(raw ?? '', ' ')
    .replace(/funds received from|payment received from|received from|from/gi, ' ')
    .replace(/[-–]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { msisdn, payerName: name || null };
}

// ── CSV (M-Pesa business portal "Account statement" export) ────────────────────────────────

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function parseBusinessCsv(text: string): { rows: ParsedPayment[]; total: number } {
  const table = parseCsv(text.replace(/^\uFEFF/, ''));
  const headerAt = table.findIndex((r) => r.some((c) => /^receipt\s*no\.?$/i.test(c.trim())));
  if (headerAt < 0)
    throw new ParseError(
      'unrecognised_statement',
      'No "Receipt No." header found — is this an M-Pesa statement CSV?',
    );
  const header = table[headerAt]!.map((h) => h.trim().toLowerCase());
  const col = (re: RegExp) => header.findIndex((h) => re.test(h));
  const c = {
    ref: col(/^receipt\s*no/),
    time: col(/^completion\s*time/),
    status: col(/^transaction\s*status/),
    paidIn: col(/^paid\s*in/),
    details: col(/^details/),
    party: col(/^other\s*party/),
    account: col(/^a\/c\s*no|^account/),
  };
  if (c.ref < 0 || c.time < 0 || c.paidIn < 0)
    throw new ParseError(
      'unrecognised_statement',
      'Statement is missing Receipt No., Completion Time or Paid In columns.',
    );
  const body = table.slice(headerAt + 1).filter((r) => REF.test((r[c.ref] ?? '').trim()));
  const rows: ParsedPayment[] = [];
  for (const r of body) {
    const status = c.status >= 0 ? (r[c.status] ?? '').trim().toLowerCase() : 'completed';
    const paidInRaw = (r[c.paidIn] ?? '').trim();
    if (status !== 'completed' || !paidInRaw || /^-|^0(\.0+)?$/.test(paidInRaw)) continue;
    const party = splitParty(c.party >= 0 ? (r[c.party] ?? '') : (r[c.details] ?? ''));
    rows.push({
      providerRef: r[c.ref]!.trim(),
      paidAt: parseNairobiDateTime(r[c.time]!),
      amountCents: money.parseKes(paidInRaw),
      msisdn: party.msisdn,
      payerName: party.payerName,
      accountRef: c.account >= 0 ? (r[c.account] ?? '').trim() || null : null,
    });
  }
  return { rows, total: body.length };
}

// ── PDF (personal / business M-Pesa statement) ─────────────────────────────────────────────

const PDF_ROW =
  /^([A-Z0-9]{10})\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2})\s+(.+?)\s+(Completed|COMPLETED)\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/;

/** Rows from already-extracted statement lines (exported for tests). */
export function parseStatementLines(lines: string[]): { rows: ParsedPayment[]; total: number } {
  const rows: ParsedPayment[] = [];
  let total = 0;
  for (const line of lines) {
    const m = PDF_ROW.exec(line.replace(/\s+/g, ' ').trim());
    if (!m) continue;
    total++;
    const paidIn = money.parseKes(m[5]!);
    if (paidIn <= 0n) continue;
    const party = splitParty(m[3]!);
    rows.push({
      providerRef: m[1]!,
      paidAt: parseNairobiDateTime(m[2]!),
      amountCents: paidIn,
      ...party,
      accountRef: null,
    });
  }
  return { rows, total };
}

export async function pdfLines(data: Uint8Array, password?: string): Promise<string[]> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    password,
    useSystemFonts: false,
    standardFontDataUrl: standardFonts(),
  });
  let doc;
  try {
    doc = await task.promise;
  } catch (err) {
    const name = (err as { name?: string }).name;
    const code = (err as { code?: number }).code;
    if (name === 'PasswordException') {
      throw new ParseError(
        code === 2 ? 'statement_password_incorrect' : 'statement_password_required',
        'The statement PDF is password-protected.',
      );
    }
    throw new ParseError('unrecognised_statement', 'The file is not a readable PDF.');
  }
  const lines: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const byY = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str?.trim()) continue;
      const y = Math.round(item.transform[5]!);
      byY.set(y, [...(byY.get(y) ?? []), { x: item.transform[4]!, s: item.str }]);
    }
    for (const y of [...byY.keys()].sort((a, b) => b - a)) {
      lines.push(
        byY
          .get(y)!
          .sort((a, b) => a.x - b.x)
          .map((i) => i.s)
          .join(' '),
      );
    }
  }
  await task.destroy();
  return lines;
}

export async function parseStatementPdf(data: Uint8Array, password?: string) {
  return parseStatementLines(await pdfLines(data, password));
}

// ── SMS (share-to-app, ADR-017) ────────────────────────────────────────────────────────────

/**
 * Incoming M-Pesa confirmation SMS. Recognises "You have received Ksh… from NAME PHONE on D/M/YY
 * at h:mm AM" and the Till/merchant "Ksh… received from PHONE NAME on …" forms. Outgoing SMS
 * ("sent to", "paid to", "withdraw") are rejected so they can never be booked as rent.
 */
export function parseMpesaSms(text: string): ParsedPayment {
  const t = text.replace(/\s+/g, ' ').trim();
  if (/\b(sent to|paid to|withdraw|bought|you have sent)\b/i.test(t)) {
    throw new ParseError('sms_not_incoming', 'This SMS is for money leaving the account.');
  }
  const ref = /^([A-Z0-9]{10})\s+Confirmed/i.exec(t)?.[1];
  const amount =
    /(?:received|have received)\s+Ksh\s?([\d,]+\.\d{2})|Ksh\s?([\d,]+\.\d{2})\s+received/i.exec(t);
  const from =
    /from\s+(.+?)\s+on\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(
      t,
    );
  if (!ref || !amount || !from)
    throw new ParseError(
      'sms_not_recognised',
      'This does not look like an M-Pesa payment confirmation.',
    );
  let hour = Number(from[5]) % 12;
  if (from[7]!.toUpperCase() === 'PM') hour += 12;
  const year = from[4]!.length === 2 ? `20${from[4]}` : from[4]!;
  const paidAt = new Date(
    `${year}-${from[3]!.padStart(2, '0')}-${from[2]!.padStart(2, '0')}T${String(hour).padStart(2, '0')}:${from[6]}:00+03:00`,
  );
  if (Number.isNaN(paidAt.getTime()))
    throw new ParseError('sms_not_recognised', 'The SMS date could not be read.');
  return {
    providerRef: ref.toUpperCase(),
    paidAt,
    amountCents: money.parseKes(amount[1] ?? amount[2]!),
    ...splitParty(from[1]!),
    accountRef: /account (?:number )?([A-Za-z0-9-]{1,12})\b/i.exec(t)?.[1] ?? null,
  };
}
