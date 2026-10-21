/**
 * Read-only iCal import (ADR-010): fetch with ETag/Last-Modified and parse RFC 5545 VEVENTs into
 * stays. Feed URLs come from users, so fetching is guarded against SSRF (private addresses).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export interface IcalEvent {
  uid: string;
  /** First night (YYYY-MM-DD). */
  start: string;
  /** Exclusive end (check-out day). */
  end: string;
  summary: string;
  cancelled: boolean;
  /** Reservation → booking; anything else (blocked / not available) → calendar block. */
  kind: 'booking' | 'block';
}

export class IcalError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IcalError';
  }
}

/** RFC 5545 §3.1: lines are folded with CRLF followed by a space or tab. */
export function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/);
}

function toDate(value: string, params: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) throw new IcalError('bad_date', `Unrecognised iCal date: ${value}`);
  if (!m[4] || /VALUE=DATE(?!-)/.test(params)) return `${m[1]}-${m[2]}-${m[3]}`;
  // A DATE-TIME: take the Nairobi calendar date of that instant (UTC "Z" or floating time).
  const instant = new Date(
    `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}${m[7] ? 'Z' : '+03:00'}`,
  );
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(instant);
}

const RESERVATION = /reserved|reservation|booked|booking/i;

export function parseIcal(text: string): IcalEvent[] {
  if (!/BEGIN:VCALENDAR/.test(text))
    throw new IcalError('not_ical', 'The feed is not an iCalendar file.');
  const events: IcalEvent[] = [];
  let current: Record<string, { value: string; params: string }> | null = null;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') current = {};
    else if (line === 'END:VEVENT' && current) {
      const uid = current.UID?.value;
      const dtStart = current.DTSTART;
      if (uid && dtStart) {
        const start = toDate(dtStart.value, dtStart.params);
        const end = current.DTEND ? toDate(current.DTEND.value, current.DTEND.params) : start;
        const summary = (current.SUMMARY?.value ?? '')
          .replace(/\\([,;\\])/g, '$1')
          .replace(/\\n/gi, ' ')
          .trim();
        const description = current.DESCRIPTION?.value ?? '';
        events.push({
          uid,
          start,
          // All-day events with no DTEND last one day.
          end:
            end > start
              ? end
              : new Date(Date.parse(`${start}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10),
          summary,
          cancelled: (current.STATUS?.value ?? '').toUpperCase() === 'CANCELLED',
          kind:
            RESERVATION.test(summary) || /reservation url|confirmation code/i.test(description)
              ? 'booking'
              : 'block',
        });
      }
      current = null;
    } else if (current) {
      const colon = line.indexOf(':');
      if (colon <= 0) continue;
      const [name, ...params] = line.slice(0, colon).split(';');
      current[name!.toUpperCase()] = {
        value: line.slice(colon + 1),
        params: params.join(';').toUpperCase(),
      };
    }
  }
  return events;
}

// ── Fetching (SSRF-guarded) ────────────────────────────────────────────────────────────────

function isPrivate(address: string): boolean {
  if (isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number) as [number, number];
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = address.toLowerCase();
  return (
    v6 === '::1' ||
    v6 === '::' ||
    v6.startsWith('fc') ||
    v6.startsWith('fd') ||
    v6.startsWith('fe80') ||
    v6.startsWith('::ffff:127.') ||
    v6.startsWith('::ffff:10.') ||
    v6.startsWith('::ffff:192.168.')
  );
}

export async function assertPublicUrl(
  url: string,
  opts: { allowPrivate?: boolean } = {},
): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new IcalError('invalid_url', 'The feed URL is not valid.');
  }
  if (parsed.protocol !== 'https:' && !(opts.allowPrivate && parsed.protocol === 'http:')) {
    throw new IcalError('invalid_url', 'Feed URLs must use https.');
  }
  if (opts.allowPrivate) return parsed;
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host)
    ? [host]
    : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addresses.length) throw new IcalError('unreachable', `Cannot resolve ${host}.`);
  if (addresses.some(isPrivate))
    throw new IcalError('forbidden_address', 'Feed URLs must point to the public internet.');
  return parsed;
}

export interface FetchResult {
  notModified: boolean;
  body: string | null;
  etag: string | null;
  lastModified: string | null;
}

const MAX_BYTES = 2 * 1024 * 1024;

/** Read the body but stop at MAX_BYTES even when the server sends no Content-Length. */
async function readCapped(res: Response): Promise<string> {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new IcalError('too_large', 'The feed is larger than 2 MB.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function fetchFeed(
  url: string,
  cache: { etag?: string | null; lastModified?: string | null },
  opts: { allowPrivate?: boolean; fetch?: typeof fetch } = {},
): Promise<FetchResult> {
  await assertPublicUrl(url, opts);
  const headers: Record<string, string> = { Accept: 'text/calendar, text/plain;q=0.8' };
  if (cache.etag) headers['If-None-Match'] = cache.etag;
  if (cache.lastModified) headers['If-Modified-Since'] = cache.lastModified;
  // No redirects: a public URL must not bounce us to an internal one.
  const res = await (opts.fetch ?? fetch)(url, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 304)
    return {
      notModified: true,
      body: null,
      etag: cache.etag ?? null,
      lastModified: cache.lastModified ?? null,
    };
  if (res.status >= 300 && res.status < 400)
    throw new IcalError('redirect_refused', 'The feed redirects; use its final URL.');
  if (!res.ok) throw new IcalError('http_error', `The feed answered HTTP ${res.status}.`);
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_BYTES) throw new IcalError('too_large', 'The feed is larger than 2 MB.');
  const body = await readCapped(res);
  return {
    notModified: false,
    body,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
  };
}
