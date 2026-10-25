/**
 * Read-only iCal import (ADR-010): fetch with ETag/Last-Modified and parse RFC 5545 VEVENTs into
 * stays. Feed URLs come from users, so fetching is guarded against SSRF (private addresses).
 */
import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import { BlockList, isIP, type LookupFunction } from 'node:net';

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

// Special-purpose ranges (RFC 6890 and friends): never fetch from these (review M1).
const BLOCKED = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['100::', 64],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const)
  BLOCKED.addSubnet(net, prefix, 'ipv6');

/** IPv4 hidden in an IPv6 address (IPv4-mapped ::ffff:a.b.c.d / ::ffff:xxxx:xxxx, NAT64 64:ff9b::/96). */
function embeddedV4(v6: string): string | null {
  const m = /^(?:::ffff:|64:ff9b::)(.+)$/i.exec(v6);
  if (!m) return null;
  const tail = m[1]!;
  if (isIP(tail) === 4) return tail;
  const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(tail);
  if (!hex) return null;
  const hi = parseInt(hex[1]!, 16);
  const lo = parseInt(hex[2]!, 16);
  return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
}

export function isPrivate(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return BLOCKED.check(address, 'ipv4');
  if (kind !== 6) return true;
  const v4 = embeddedV4(address);
  if (v4) return BLOCKED.check(v4, 'ipv4');
  return BLOCKED.check(address, 'ipv6');
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

/**
 * DNS lookup that validates every resolved address before the socket connects: the connection
 * uses exactly the address that was checked, so a rebinding DNS answer cannot slip a private IP in
 * between check and connect (review M1).
 */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, '', 4);
      if (!allowPrivate && addresses.some((a) => isPrivate(a.address)))
        return callback(
          new IcalError('forbidden_address', 'Feed URLs must point to the public internet.'),
          '',
          4,
        );
      if ((options as { all?: boolean }).all)
        return (callback as unknown as (e: null, a: typeof addresses) => void)(null, addresses);
      const first = addresses[0];
      if (!first)
        return callback(new IcalError('unreachable', `Cannot resolve ${hostname}.`), '', 4);
      callback(null, first.address, first.family);
    });
  };
}

/** GET over node:http(s) with the guarded lookup; no redirects followed, 20 s timeout. */
function pinnedGet(
  url: string,
  headers: Record<string, string>,
  allowPrivate: boolean,
): Promise<Response> {
  const u = new URL(url);
  const send = u.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = send(
      u,
      { method: 'GET', headers, lookup: guardedLookup(allowPrivate), timeout: 20_000 },
      (res) => {
        const h = new Headers();
        for (const [k, v] of Object.entries(res.headers))
          if (v !== undefined) h.set(k, Array.isArray(v) ? v.join(', ') : String(v));
        const status = res.statusCode && res.statusCode >= 200 ? res.statusCode : 502;
        const body =
          status === 204 || status === 304
            ? null
            : (Readable.toWeb(res) as ReadableStream<Uint8Array>);
        if (!body) res.resume();
        resolve(new Response(body, { status, headers: h }));
      },
    );
    req.on('timeout', () =>
      req.destroy(new IcalError('timeout', 'The feed took too long to answer.')),
    );
    req.on('error', reject);
    req.end();
  });
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
  const res = opts.fetch
    ? await opts.fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(20_000) })
    : await pinnedGet(url, headers, Boolean(opts.allowPrivate));
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
