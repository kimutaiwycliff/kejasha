import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testClock } from '../helpers';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B4): a host sets up two short-stay units with rates, connects an Airbnb calendar,
 * takes a WhatsApp booking that is paid by Paybill, cannot double-book, records costs, and reads a
 * monthly P&L that reconciles to the bookings and expenses. The ledger stays at zero.
 */
const clock = testClock('2026-10-05');
let j: Journey;
let server: Server;
let feedUrl = '';
const ics = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261009',
  'DTEND;VALUE=DATE:20261012',
  'UID:abc123@airbnb.com',
  'SUMMARY:Reserved',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABC',
  'END:VEVENT',
  'BEGIN:VEVENT',
  'DTSTART;VALUE=DATE:20261025',
  'DTEND;VALUE=DATE:20261027',
  'UID:blk@airbnb.com',
  'SUMMARY:Airbnb (Not available)',
  'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

beforeAll(async () => {
  j = await startJourney({ clock });
  server = createServer((_req, res) =>
    res.writeHead(200, { 'content-type': 'text/calendar' }).end(ics),
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  feedUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/calendar/ical/42.ics?s=tok`;
});
afterAll(async () => {
  server.close();
  await j.close();
});

it('short-stay host: rates, iCal, booking, payment, P&L', async () => {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Halima',
      email: `halima-${randomUUID().slice(0, 6)}@example.test`,
      password: 'a-strong-password',
    },
  });
  const me = j.as(s.data!.token);
  const org = await me.POST('/v1/orgs', {
    body: { name: 'Halima Stays', kind: 'host', county: 'Mombasa' },
  });
  const prop = await me.POST('/v1/properties', {
    body: { name: 'Nyali Apartments', county: 'Mombasa' },
  });
  const units = [];
  for (const code of ['NY1', 'NY2']) {
    const u = await me.POST('/v1/properties/{propertyId}/units', {
      params: { path: { propertyId: prop.data!.id } },
      body: { code, mode: 'short_stay', baseNightlyCents: 450_000, bedrooms: 1 },
    });
    expect(u.response.status, JSON.stringify(u.error)).toBe(201);
    units.push(u.data!);
  }
  const [ny1, ny2] = units as [(typeof units)[0], (typeof units)[0]];
  await me.PUT('/v1/units/{unitId}/rate-plan', {
    params: { path: { unitId: ny1.id } },
    body: {
      baseNightlyCents: 450_000,
      weekendNightlyCents: 550_000,
      minStayNights: 2,
      cleaningFeeCents: 100_000,
      checkinInstructions: 'Keys at the front desk.',
    },
  });

  // Airbnb calendar → one imported reservation and one block on NY1.
  const feed = await me.POST('/v1/ical-feeds', {
    body: { unitId: ny1.id, source: 'airbnb', url: feedUrl },
  });
  expect(feed.response.status, JSON.stringify(feed.error)).toBe(201);
  const sync = await me.POST('/v1/ical-feeds/{id}/sync', {
    params: { path: { id: feed.data!.id } },
  });
  expect(sync.data).toMatchObject({ status: 'ok', added: 2, conflicts: 0 });
  const airbnb = (
    await me.GET('/v1/bookings', { params: { query: { source: 'airbnb', limit: 10 } } })
  ).data!.items[0]!;
  // The host fills in the payout and Airbnb's fee.
  await me.PATCH('/v1/bookings/{id}', {
    params: { path: { id: airbnb.id } },
    body: { grossCents: 1_650_000, commissionBps: 1550 },
  });

  // A WhatsApp enquiry for the imported dates is refused; NY2 is quoted and booked instead.
  const clash = await me.POST('/v1/bookings', {
    body: { unitId: ny1.id, checkIn: '2026-10-10', checkOut: '2026-10-13', source: 'whatsapp' },
  });
  expect(clash.response.status).toBe(409);
  const quote = await me.GET('/v1/units/{unitId}/quote', {
    params: { path: { unitId: ny2.id }, query: { checkIn: '2026-10-16', checkOut: '2026-10-19' } },
  });
  expect(quote.data).toMatchObject({ nightCount: 3, totalCents: 1_350_000, available: true });

  // Two staff members try to take the same NY2 dates at once — exactly one wins.
  const attempts = await Promise.all(
    ['Musa Ali', 'Grace Wairimu'].map((fullName, i) =>
      me.POST('/v1/bookings', {
        body: {
          unitId: ny2.id,
          checkIn: '2026-10-16',
          checkOut: '2026-10-19',
          source: 'whatsapp',
          guest: { fullName, phone: `07220000${i}1` },
        },
      }),
    ),
  );
  expect(attempts.map((a) => a.response.status).sort()).toEqual([201, 409]);
  const booking = attempts.find((a) => a.response.status === 201)!.data!;
  expect(booking).toMatchObject({ grossCents: 1_350_000, balanceCents: 1_350_000 });

  // The guest pays by Paybill with the unit code as account number.
  const channel = await me.POST('/v1/payment-channels', {
    body: { kind: 'paybill', shortcode: '700200', displayName: 'Nyali Paybill' },
  });
  await me.PUT('/v1/payment-channels/{id}/credentials', {
    params: { path: { id: channel.data!.id } },
    body: { consumerKey: 'k', consumerSecret: 's', passkey: 'p' },
  });
  const token = new URL(channel.data!.callbackUrls!.confirmation).pathname.split('/')[4]!;
  await j.client.POST('/v1/payments/daraja/{channelToken}/c2b/confirmation', {
    params: { path: { channelToken: token } },
    body: {
      TransID: 'SKN0000001',
      TransTime: '20261005120000',
      TransAmount: '13500.00',
      BusinessShortCode: '700200',
      BillRefNumber: 'NY2',
      MSISDN: '254722000001',
      FirstName: 'G',
      LastName: 'W',
    },
  });
  const paid = await me.GET('/v1/bookings/{id}', { params: { path: { id: booking.id } } });
  expect(paid.data).toMatchObject({ paidCents: 1_350_000, balanceCents: 0 });
  const receipts = await j.api.deps.db.pools.owner.query(
    `SELECT payload FROM outbox WHERE org_id = $1 AND dedupe_key LIKE 'receipt:%'`,
    [org.data!.id],
  );
  expect(receipts.rows[0].payload.message).toMatch(/Received KES 13,500\.00 for NY2 .* Fully paid/);

  // Stay, costs, and the month's P&L.
  clock.set('2026-10-16');
  await me.POST('/v1/bookings/{id}/check-in', { params: { path: { id: booking.id } } });
  clock.set('2026-10-19');
  await me.POST('/v1/bookings/{id}/check-out', { params: { path: { id: booking.id } } });
  for (const [unitId, category, amountCents] of [
    [ny1.id, 'cleaning', 200_000],
    [ny2.id, 'cleaning', 150_000],
    [ny2.id, 'tokens', 100_000],
  ] as const) {
    await me.POST('/v1/unit-expenses', {
      body: { unitId, incurredOn: '2026-10-19', category, amountCents },
    });
  }
  const report = (
    await me.GET('/v1/reports/short-stay', { params: { query: { period: '2026-10' } } })
  ).data!;
  const by = Object.fromEntries(report.units.map((u) => [u.unitCode, u]));
  // NY1: Airbnb 16,500 − 15.5% (2,557.50) − 2,000 cleaning. NY2: 13,500 − 2,500 costs.
  expect(by.NY1).toMatchObject({
    nightsSold: 3,
    grossCents: 1_650_000,
    commissionCents: 255_750,
    expensesCents: 200_000,
    netCents: 1_194_250,
  });
  expect(by.NY2).toMatchObject({
    nightsSold: 3,
    grossCents: 1_350_000,
    commissionCents: 0,
    expensesCents: 250_000,
    netCents: 1_100_000,
  });
  expect(by.NY1!.availableNights).toBe(29); // 31 − the 2 blocked nights
  expect(report.totals.netCents).toBe(by.NY1!.netCents + by.NY2!.netCents);
  const airbnbChannel = report.channels.find((c) => c.source === 'airbnb')!;
  expect(airbnbChannel.commissionCents).toBe(255_750);

  const { rows } = await j.api.deps.db.pools.owner.query(
    'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
    [org.data!.id],
  );
  expect(rows[0].t).toBe('0');
});
