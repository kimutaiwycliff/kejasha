import { describe, expect, it } from 'vitest';
import { assertPublicUrl, fetchFeed, isPrivate, parseIcal, unfold } from './index';

// Shapes modelled on Airbnb and Booking.com exports.
const airbnb = [
  'BEGIN:VCALENDAR',
  'PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20261105',
  'DTSTART;VALUE=DATE:20261101',
  'UID:1418fb94e984-0a9c1f4ad5b5d6c8b9a3e4f2@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCDEF\\nPhone Num',
  ' ber (Last 4 Digits): 1234',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTEND;VALUE=DATE:20261210',
  'DTSTART;VALUE=DATE:20261208',
  'UID:7f0b2c1d-blocked@airbnb.com',
  'SUMMARY:Airbnb (Not available)',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

describe('parseIcal', () => {
  it('reads reservations and blocks, unfolding long lines', () => {
    expect(unfold('A:1\r\n 23\r\nB:4')).toEqual(['A:123', 'B:4']);
    expect(parseIcal(airbnb)).toEqual([
      {
        uid: '1418fb94e984-0a9c1f4ad5b5d6c8b9a3e4f2@airbnb.com',
        start: '2026-11-01',
        end: '2026-11-05',
        summary: 'Reserved',
        cancelled: false,
        kind: 'booking',
      },
      {
        uid: '7f0b2c1d-blocked@airbnb.com',
        start: '2026-12-08',
        end: '2026-12-10',
        summary: 'Airbnb (Not available)',
        cancelled: false,
        kind: 'block',
      },
    ]);
  });

  it('handles Booking.com closures, date-times, single days and cancellations', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:abc@booking.com',
      'DTSTART;VALUE=DATE:20261120',
      'DTEND;VALUE=DATE:20261123',
      'SUMMARY:CLOSED - Not available',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:dt@x',
      'DTSTART:20261130T210000Z',
      'DTEND:20261202T080000Z',
      'SUMMARY:Booked',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:one-day@x',
      'DTSTART;VALUE=DATE:20261224',
      'SUMMARY:Owner',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    expect(parseIcal(ics)).toEqual([
      {
        uid: 'abc@booking.com',
        start: '2026-11-20',
        end: '2026-11-23',
        summary: 'CLOSED - Not available',
        cancelled: false,
        kind: 'block',
      },
      {
        uid: 'dt@x',
        start: '2026-12-01',
        end: '2026-12-02',
        summary: 'Booked',
        cancelled: true,
        kind: 'booking',
      }, // 21:00Z = Dec 1 Nairobi
      {
        uid: 'one-day@x',
        start: '2026-12-24',
        end: '2026-12-25',
        summary: 'Owner',
        cancelled: false,
        kind: 'block',
      },
    ]);
    expect(() => parseIcal('<html>login</html>')).toThrow(/not an iCalendar/);
  });
});

describe('fetching', () => {
  it('refuses private, loopback and non-https URLs', async () => {
    await expect(assertPublicUrl('http://example.com/x.ics')).rejects.toMatchObject({
      code: 'invalid_url',
    });
    await expect(assertPublicUrl('https://127.0.0.1/x.ics')).rejects.toMatchObject({
      code: 'forbidden_address',
    });
    await expect(assertPublicUrl('https://10.0.0.5/x.ics')).rejects.toMatchObject({
      code: 'forbidden_address',
    });
    await expect(assertPublicUrl('https://[::1]/x.ics')).rejects.toMatchObject({
      code: 'forbidden_address',
    });
    await expect(assertPublicUrl('https://169.254.169.254/latest/meta-data')).rejects.toMatchObject(
      { code: 'forbidden_address' },
    );
  });

  it('uses conditional requests and refuses redirects', async () => {
    const seen: Record<string, string>[] = [];
    const fake = (async (_url: string, init: RequestInit) => {
      seen.push(init.headers as Record<string, string>);
      return seen.length === 1
        ? new Response(airbnb, {
            headers: { etag: '"v1"', 'last-modified': 'Wed, 21 Oct 2026 07:00:00 GMT' },
          })
        : new Response(null, { status: 304 });
    }) as unknown as typeof fetch;
    const first = await fetchFeed('https://93.184.216.34/x.ics', {}, { fetch: fake });
    expect(first).toMatchObject({ notModified: false, etag: '"v1"' });
    const second = await fetchFeed(
      'https://93.184.216.34/x.ics',
      { etag: first.etag, lastModified: first.lastModified },
      { fetch: fake },
    );
    expect(second.notModified).toBe(true);
    expect(seen[1]).toMatchObject({ 'If-None-Match': '"v1"' });
    const redirecting = (async () =>
      new Response(null, {
        status: 302,
        headers: { location: 'http://10.0.0.1' },
      })) as unknown as typeof fetch;
    await expect(
      fetchFeed('https://93.184.216.34/x.ics', {}, { fetch: redirecting }),
    ).rejects.toMatchObject({ code: 'redirect_refused' });
  });
});

describe('private address detection (review M1)', () => {
  it('blocks special-purpose ranges, IPv4-mapped (dotted and hex) and NAT64 forms', () => {
    for (const a of [
      '127.0.0.1',
      '10.1.2.3',
      '172.20.0.1',
      '192.168.1.1',
      '169.254.169.254',
      '100.64.0.1',
      '198.18.0.5',
      '192.0.0.8',
      '224.0.0.1',
      '255.255.255.255',
      '0.0.0.0',
      '::1',
      '::',
      'fd00::1',
      'fe80::1',
      'fec0::1',
      'ff02::1',
      '2002:7f00:1::',
      '2001:db8::1',
      '::ffff:127.0.0.1',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '64:ff9b::a00:1',
      '64:ff9b::7f00:1',
    ])
      expect(isPrivate(a), a).toBe(true);
    for (const a of ['93.184.216.34', '8.8.8.8', '2606:4700:4700::1111', '::ffff:5db8:d822'])
      expect(isPrivate(a), a).toBe(false);
    expect(isPrivate('not-an-ip')).toBe(true);
  });

  it('refuses a feed whose host is an IPv4-mapped loopback literal', async () => {
    await expect(fetchFeed('https://[::ffff:7f00:1]/x.ics', {})).rejects.toMatchObject({
      code: 'forbidden_address',
    });
  });
});
