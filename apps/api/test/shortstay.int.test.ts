import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, ownerWithOrg } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-21'); // a Wednesday
let api: TestApi;

// A local iCal "channel" whose body each test controls.
let icsBody = '';
let server: Server;
let feedBase = '';
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
  server = createServer((req, res) => {
    const etag = `"${createHash('sha1').update(icsBody).digest('hex')}"`;
    if (req.headers['if-none-match'] === etag) {
      res.writeHead(304).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/calendar', etag }).end(icsBody);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  feedBase = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.close();
  await api.close();
});

type C = ReturnType<typeof client>;

/** Org with one short-stay unit (BnB1, KES 5,000/night) and one long-term unit. */
async function setup() {
  clock.set('2026-10-21');
  const o = await ownerWithOrg(api);
  const c = client(api, o.token);
  const prop = (await c.post('/v1/properties', { name: 'Diani Villas', county: 'Kwale' })).json();
  const unit = (
    await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'BNB1',
      mode: 'short_stay',
      baseNightlyCents: 500_000,
    })
  ).json();
  const lt = (
    await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'LT1',
      mode: 'long_term',
      rentCents: 2_000_000,
    })
  ).json();
  expect(unit.id).toBeTruthy();
  return { o, c, prop, unit, lt };
}

const trialBalance = async (orgId: string) =>
  (
    await api.deps.db.pools.owner.query(
      'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
      [orgId],
    )
  ).rows[0].t;

const book = (c: C, unitId: string, over: Record<string, unknown> = {}) =>
  c.post('/v1/bookings', {
    unitId,
    checkIn: '2026-10-23',
    checkOut: '2026-10-26',
    source: 'direct',
    ...over,
  });

describe('rates and quotes', () => {
  it('prices night by night: season > weekend > base, plus cleaning; seasons cannot overlap', async () => {
    const { c, unit, lt } = await setup();
    const plan = await c.put(`/v1/units/${unit.id}/rate-plan`, {
      baseNightlyCents: 500_000,
      weekendNightlyCents: 600_000,
      minStayNights: 2,
      cleaningFeeCents: 150_000,
    });
    expect(plan.statusCode, plan.body).toBe(200);
    const season = await c.post(`/v1/units/${unit.id}/seasons`, {
      label: 'Festive',
      startsOn: '2026-12-20',
      endsOn: '2027-01-03',
      nightlyCents: 800_000,
      minStayNights: 3,
    });
    expect(season.statusCode, season.body).toBe(201);
    expect(season.json().seasons).toHaveLength(1);
    const overlap = await c.post(`/v1/units/${unit.id}/seasons`, {
      label: 'New year',
      startsOn: '2027-01-01',
      endsOn: '2027-01-05',
      nightlyCents: 900_000,
    });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().code).toBe('season_overlap');

    // Fri, Sat (weekend) + Sun (base) + cleaning.
    const q = (
      await c.get(`/v1/units/${unit.id}/quote?checkIn=2026-10-23&checkOut=2026-10-26`)
    ).json();
    expect(q.nights.map((n: { rate: string }) => n.rate)).toEqual(['weekend', 'weekend', 'base']);
    expect(q).toMatchObject({
      nightCount: 3,
      nightsTotalCents: 1_700_000,
      totalCents: 1_850_000,
      meetsMinStay: true,
      available: true,
    });
    const festive = (
      await c.get(`/v1/units/${unit.id}/quote?checkIn=2026-12-30&checkOut=2027-01-01`)
    ).json();
    expect(festive).toMatchObject({
      nightsTotalCents: 1_600_000,
      minStayNights: 3,
      meetsMinStay: false,
    });

    expect((await c.get(`/v1/units/${lt.id}/rate-plan`)).json().code).toBe('unit_not_short_stay');
    expect(
      (await c.get(`/v1/units/${unit.id}/quote?checkIn=2026-10-26&checkOut=2026-10-23`)).statusCode,
    ).toBe(422);
  });
});

describe('bookings', () => {
  it('books from the quote, posts the receivable, enforces min stay, overlap and buffer days', async () => {
    const { o, c, unit } = await setup();
    await c.put(`/v1/units/${unit.id}/rate-plan`, {
      baseNightlyCents: 500_000,
      weekendNightlyCents: 600_000,
      minStayNights: 2,
      bufferDays: 1,
      cleaningFeeCents: 150_000,
      checkinInstructions: 'Gate code 4321.',
    });
    const res = await book(c, unit.id, {
      guest: { fullName: 'Amina Hassan', phone: '0711222333' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const b = res.json();
    expect(b).toMatchObject({
      nights: 3,
      grossCents: 1_850_000,
      cleaningFeeCents: 150_000,
      balanceCents: 1_850_000,
      paidCents: 0,
      netCents: 1_850_000,
      isRepeatGuest: false,
      guestName: 'Amina Hassan',
    });

    // Same dates, overlapping dates, and the buffer day after check-out are all unavailable.
    for (const dates of [
      { checkIn: '2026-10-23', checkOut: '2026-10-26' },
      { checkIn: '2026-10-25', checkOut: '2026-10-28' },
      { checkIn: '2026-10-26', checkOut: '2026-10-28' },
    ]) {
      const clash = await book(c, unit.id, dates);
      expect(clash.statusCode, JSON.stringify(dates)).toBe(409);
      expect(clash.json().code).toBe('dates_unavailable');
    }
    // One night is below the minimum unless explicitly allowed.
    expect(
      (await book(c, unit.id, { checkIn: '2026-10-28', checkOut: '2026-10-29' })).json().code,
    ).toBe('min_stay');
    const short = await book(c, unit.id, {
      checkIn: '2026-10-28',
      checkOut: '2026-10-29',
      allowShortStay: true,
      guest: { fullName: 'A. Hassan', phone: '+254711222333' },
    });
    expect(short.statusCode, short.body).toBe(201);
    expect(short.json()).toMatchObject({ guestId: b.guestId, isRepeatGuest: true });

    // The confirmation SMS is queued with the check-in instructions.
    const { rows } = await api.deps.db.pools.owner.query(
      `SELECT payload FROM outbox WHERE org_id = $1 AND topic = 'notifications.sms' ORDER BY created_at`,
      [o.org.id],
    );
    expect(rows[0].payload.message).toContain('Gate code 4321.');
    expect(rows[0].payload.message).toContain('KES 18,500');

    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it('lets exactly one of many concurrent bookings for the same dates win', async () => {
    const { c, unit } = await setup();
    const results = await Promise.all(Array.from({ length: 6 }, () => book(c, unit.id)));
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409, 409]);
  });

  it('re-prices with delta entries and reverses everything billed on cancel; the dates free up', async () => {
    const { o, c, unit } = await setup();
    const b = (await book(c, unit.id, { grossCents: 1_500_000 })).json();
    const moved = await c.patch(`/v1/bookings/${b.id}`, {
      checkOut: '2026-10-27',
      grossCents: 2_000_000,
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json()).toMatchObject({ nights: 4, balanceCents: 2_000_000 });
    const { rows } = await api.deps.db.pools.owner.query(
      `SELECT count(*)::int AS n FROM ledger_entry WHERE booking_id = $1`,
      [b.id],
    );
    expect(rows[0].n).toBe(2);

    const cancelled = await c.post(`/v1/bookings/${b.id}/cancel`, {
      reason: 'Guest changed plans',
    });
    expect(cancelled.json()).toMatchObject({ status: 'cancelled', balanceCents: 0 });
    expect((await c.post(`/v1/bookings/${b.id}/check-in`)).json().code).toBe(
      'invalid_booking_status',
    );
    expect((await book(c, unit.id)).statusCode).toBe(201);
    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it('moves through check-in and check-out; OTA bookings carry commission and no receivable', async () => {
    const { o, c, unit } = await setup();
    const ota = (
      await book(c, unit.id, {
        source: 'airbnb',
        grossCents: 3_000_000,
        commissionBps: 1500,
        guest: { fullName: 'Lena Fischer' },
      })
    ).json();
    expect(ota).toMatchObject({ commissionCents: 450_000, netCents: 2_550_000, balanceCents: 0 });
    const { rows } = await api.deps.db.pools.owner.query(
      `SELECT count(*)::int AS n FROM ledger_entry WHERE booking_id = $1`,
      [ota.id],
    );
    expect(rows[0].n).toBe(0);
    expect((await c.post(`/v1/bookings/${ota.id}/check-out`)).statusCode).toBe(409);
    expect((await c.post(`/v1/bookings/${ota.id}/check-in`)).json().status).toBe('checked_in');
    expect((await c.post(`/v1/bookings/${ota.id}/check-out`)).json().status).toBe('checked_out');
    expect(await trialBalance(o.org.id)).toBe('0');
  });
});

describe('blocks and calendar', () => {
  it('blocks share the booking exclusion and show on the calendar', async () => {
    const { c, unit, prop } = await setup();
    await book(c, unit.id, { guest: { fullName: 'Peter Kamau' } });
    const clash = await c.post('/v1/calendar-blocks', {
      unitId: unit.id,
      startsOn: '2026-10-25',
      endsOn: '2026-10-27',
      reason: 'owner_use',
    });
    expect(clash.json().code).toBe('dates_unavailable');
    const block = await c.post('/v1/calendar-blocks', {
      unitId: unit.id,
      startsOn: '2026-11-01',
      endsOn: '2026-11-04',
      reason: 'maintenance',
      note: 'Repaint',
    });
    expect(block.statusCode, block.body).toBe(201);
    expect(
      (await book(c, unit.id, { checkIn: '2026-11-03', checkOut: '2026-11-05' })).json().code,
    ).toBe('dates_unavailable');

    const cal = (
      await c.get(`/v1/calendar?from=2026-10-01&to=2026-11-30&propertyId=${prop.id}`)
    ).json();
    expect(cal.units).toHaveLength(1);
    expect(
      cal.units[0].entries.map((e: { kind: string; label: string }) => [e.kind, e.label]),
    ).toEqual([
      ['booking', 'Peter Kamau'],
      ['block', 'Repaint'],
    ]);
    expect((await c.get('/v1/calendar?from=2026-01-01&to=2026-12-31')).json().code).toBe(
      'invalid_range',
    );

    expect((await c.delete(`/v1/calendar-blocks/${block.json().id}`)).statusCode).toBe(204);
    expect(
      (await book(c, unit.id, { checkIn: '2026-11-03', checkOut: '2026-11-05' })).statusCode,
    ).toBe(201);
  });
});

describe('payments for bookings', () => {
  async function withPaybill(c: C) {
    const channel = (
      await c.post('/v1/payment-channels', {
        kind: 'paybill',
        shortcode: '600982',
        displayName: 'Villas Paybill',
      })
    ).json();
    await c.put(`/v1/payment-channels/${channel.id}/credentials`, {
      consumerKey: 'ck',
      consumerSecret: 'cs',
      passkey: 'pk',
    });
    return new URL(channel.callbackUrls.confirmation).pathname.split('/')[4]!;
  }
  const c2b = (token: string, over: Record<string, string>) =>
    api.app.inject({
      method: 'POST',
      url: `/v1/payments/daraja/${token}/c2b/confirmation`,
      payload: {
        TransactionType: 'Pay Bill',
        TransID: `SS${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
        TransTime: '20261021101530',
        TransAmount: '10000.00',
        BusinessShortCode: '600982',
        BillRefNumber: 'BNB1',
        MSISDN: '254700999999',
        FirstName: 'AMINA',
        MiddleName: '',
        LastName: 'HASSAN',
        ...over,
      },
    });

  it('matches a Paybill payment to the booking by unit code, then by guest phone', async () => {
    const { o, c, unit } = await setup();
    const token = await withPaybill(c);
    const b = (
      await book(c, unit.id, {
        grossCents: 1_500_000,
        guest: { fullName: 'Amina Hassan', phone: '0711222333' },
      })
    ).json();

    await c2b(token, { TransAmount: '10000.00' });
    let p = (await c.get('/v1/payments')).json().items[0];
    expect(p).toMatchObject({
      matchStatus: 'matched',
      matchMethod: 'auto_account',
      bookingId: b.id,
      leaseId: null,
      unitCode: 'BNB1',
      tenantName: 'Amina Hassan',
    });
    expect((await c.get(`/v1/bookings/${b.id}`)).json()).toMatchObject({
      paidCents: 1_000_000,
      balanceCents: 500_000,
    });

    await c2b(token, { TransAmount: '5000.00', BillRefNumber: 'WRONG', MSISDN: '254711222333' });
    p = (await c.get('/v1/payments'))
      .json()
      .items.find((x: { amountCents: number }) => x.amountCents === 500_000);
    expect(p).toMatchObject({ matchStatus: 'matched', matchMethod: 'auto_phone', bookingId: b.id });
    expect((await c.get(`/v1/bookings/${b.id}`)).json().balanceCents).toBe(0);

    const pdf = await c.get(`/v1/payments/${p.id}/receipt`);
    expect(pdf.statusCode, pdf.body.slice(0, 200)).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it('allocates manually to a booking, refuses OTA bookings, and requests STK for a booking', async () => {
    const { c, unit } = await setup();
    await withPaybill(c);
    const direct = (
      await book(c, unit.id, {
        grossCents: 1_200_000,
        guest: { fullName: 'Joy Achieng', phone: '0733444555' },
      })
    ).json();
    const ota = (
      await book(c, unit.id, {
        source: 'booking',
        checkIn: '2026-11-10',
        checkOut: '2026-11-12',
        grossCents: 900_000,
      })
    ).json();

    const manual = (
      await c.post('/v1/payments', { method: 'cash', amountCents: 200_000, paidOn: '2026-10-21' })
    ).json();
    expect(manual.matchStatus).toBe('unmatched');
    expect((await c.post(`/v1/payments/${manual.id}/allocate`, {})).json().code).toBe(
      'target_required',
    );
    expect(
      (await c.post(`/v1/payments/${manual.id}/allocate`, { bookingId: ota.id })).json().code,
    ).toBe('booking_not_collected');
    const allocated = await c.post(`/v1/payments/${manual.id}/allocate`, { bookingId: direct.id });
    expect(allocated.json()).toMatchObject({ matchStatus: 'matched', bookingId: direct.id });
    expect((await c.get(`/v1/bookings/${direct.id}`)).json().balanceCents).toBe(1_000_000);

    const stk = await c.post('/v1/stk-requests', { bookingId: direct.id });
    expect(stk.statusCode, stk.body).toBe(201);
    expect(stk.json()).toMatchObject({
      bookingId: direct.id,
      leaseId: null,
      amountCents: 1_000_000,
      msisdn: '+254733444555',
      accountRef: 'BNB1',
    });
    expect((await c.post('/v1/stk-requests', { bookingId: ota.id })).json().code).toBe(
      'booking_not_collected',
    );

    const unallocated = await c.post(`/v1/payments/${manual.id}/unallocate`, {
      reason: 'Wrong booking',
    });
    expect(unallocated.json()).toMatchObject({ matchStatus: 'unmatched', bookingId: null });
  });
});

describe('iCal import', () => {
  const ics = (events: { uid: string; start: string; end: string; summary: string }[]) =>
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Airbnb Inc//Hosting Calendar 1.0//EN',
      ...events.flatMap((e) => [
        'BEGIN:VEVENT',
        `DTSTART;VALUE=DATE:${e.start.replace(/-/g, '')}`,
        `DTEND;VALUE=DATE:${e.end.replace(/-/g, '')}`,
        `UID:${e.uid}`,
        `SUMMARY:${e.summary}`,
        'END:VEVENT',
      ]),
      'END:VCALENDAR',
    ].join('\r\n');

  it('imports reservations and blocks, records conflicts, skips unchanged feeds and cancels removed stays', async () => {
    const { c, unit } = await setup();
    await book(c, unit.id, {
      checkIn: '2026-11-20',
      checkOut: '2026-11-23',
      guest: { fullName: 'Direct Guest' },
    });
    icsBody = ics([
      { uid: 'res-1@airbnb.com', start: '2026-11-01', end: '2026-11-05', summary: 'Reserved' },
      {
        uid: 'blk-1@airbnb.com',
        start: '2026-11-10',
        end: '2026-11-12',
        summary: 'Airbnb (Not available)',
      },
      { uid: 'res-2@airbnb.com', start: '2026-11-21', end: '2026-11-24', summary: 'Reserved' },
      { uid: 'old@airbnb.com', start: '2026-09-01', end: '2026-09-03', summary: 'Reserved' },
    ]);
    const created = await c.post('/v1/ical-feeds', {
      unitId: unit.id,
      source: 'airbnb',
      url: `${feedBase}/calendar/ical/123.ics?s=secret-token-abcd`,
    });
    expect(created.statusCode, created.body).toBe(201);
    const feed = created.json();
    expect(feed.urlHint).toMatch(/^127\.0\.0\.1:\d+\/…abcd$/);
    expect(JSON.stringify(feed)).not.toContain('secret-token');
    expect(
      (
        await c.post('/v1/ical-feeds', {
          unitId: unit.id,
          source: 'airbnb',
          url: `${feedBase}/calendar/ical/123.ics?s=secret-token-abcd`,
        })
      ).json().code,
    ).toBe('feed_exists');

    const first = (await c.post(`/v1/ical-feeds/${feed.id}/sync`)).json();
    expect(first).toMatchObject({ status: 'ok', added: 2, conflicts: 1, error: null });
    const listed = (await c.get(`/v1/ical-feeds?unitId=${unit.id}`)).json().items[0];
    expect(listed.conflicts).toEqual([
      { uid: 'res-2@airbnb.com', start: '2026-11-21', end: '2026-11-24', summary: 'Reserved' },
    ]);
    const imported = (await c.get(`/v1/bookings?unitId=${unit.id}&source=airbnb`)).json().items;
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({
      checkIn: '2026-11-01',
      checkOut: '2026-11-05',
      fromIcal: true,
      grossCents: 0,
    });
    const cal = (await c.get('/v1/calendar?from=2026-11-01&to=2026-11-30')).json().units[0].entries;
    expect(cal.filter((e: { kind: string }) => e.kind === 'block')).toHaveLength(1);
    const blockId = cal.find((e: { kind: string }) => e.kind === 'block').id;
    expect((await c.delete(`/v1/calendar-blocks/${blockId}`)).json().code).toBe('managed_by_ical');

    // Unchanged feed → 304.
    expect((await c.post(`/v1/ical-feeds/${feed.id}/sync`)).json().status).toBe('not_modified');

    // The reservation moves a day, the block disappears.
    icsBody = ics([
      { uid: 'res-1@airbnb.com', start: '2026-11-02', end: '2026-11-06', summary: 'Reserved' },
    ]);
    const third = (await c.post(`/v1/ical-feeds/${feed.id}/sync`)).json();
    expect(third).toMatchObject({ status: 'ok', added: 0, updated: 1, removed: 1, conflicts: 0 });

    // The reservation is cancelled on Airbnb (gone from the feed): our copy is cancelled, dates free.
    icsBody = ics([]);
    expect((await c.post(`/v1/ical-feeds/${feed.id}/sync`)).json()).toMatchObject({ removed: 1 });
    expect((await c.get(`/v1/bookings/${imported[0].id}`)).json().status).toBe('cancelled');
    expect(
      (await book(c, unit.id, { checkIn: '2026-11-02', checkOut: '2026-11-06' })).statusCode,
    ).toBe(201);
  });

  it('reverses what was billed when a priced, directly-collected imported stay leaves the feed', async () => {
    const { o, c, unit } = await setup();
    icsBody = ics([
      { uid: 'own-site-1', start: '2026-11-01', end: '2026-11-04', summary: 'Reserved' },
    ]);
    const feed = (
      await c.post('/v1/ical-feeds', {
        unitId: unit.id,
        source: 'other',
        url: `${feedBase}/own-site.ics`,
      })
    ).json();
    await c.post(`/v1/ical-feeds/${feed.id}/sync`);
    const imported = (await c.get(`/v1/bookings?unitId=${unit.id}&source=other`)).json().items[0];
    expect(
      (await c.patch(`/v1/bookings/${imported.id}`, { grossCents: 1_200_000 })).json().balanceCents,
    ).toBe(1_200_000);

    icsBody = ics([]);
    await c.post(`/v1/ical-feeds/${feed.id}/sync`);
    expect((await c.get(`/v1/bookings/${imported.id}`)).json()).toMatchObject({
      status: 'cancelled',
      balanceCents: 0,
    });
    // Back on the feed → re-confirmed and billed again.
    icsBody = ics([
      { uid: 'own-site-1', start: '2026-11-01', end: '2026-11-04', summary: 'Reserved' },
    ]);
    await c.post(`/v1/ical-feeds/${feed.id}/sync`);
    expect((await c.get(`/v1/bookings/${imported.id}`)).json()).toMatchObject({
      status: 'confirmed',
      balanceCents: 1_200_000,
    });
    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it('records fetch and parse failures on the feed', async () => {
    const { c, unit } = await setup();
    icsBody = 'not a calendar';
    const feed = (
      await c.post('/v1/ical-feeds', {
        unitId: unit.id,
        source: 'booking',
        url: `${feedBase}/bad.ics`,
      })
    ).json();
    const r = (await c.post(`/v1/ical-feeds/${feed.id}/sync`)).json();
    expect(r).toMatchObject({ status: 'error' });
    const dead = (
      await c.post('/v1/ical-feeds', {
        unitId: unit.id,
        source: 'other',
        url: 'http://127.0.0.1:1/x.ics',
      })
    ).json();
    expect((await c.post(`/v1/ical-feeds/${dead.id}/sync`)).json().status).toBe('error');
    const listed = (await c.get('/v1/ical-feeds')).json().items;
    expect(
      listed.every(
        (f: { lastStatus: string; lastError: string | null }) =>
          f.lastStatus === 'error' && f.lastError,
      ),
    ).toBe(true);
    expect(
      (
        await c.post('/v1/ical-feeds', {
          unitId: unit.id,
          source: 'other',
          url: 'ftp://example.com/x.ics',
        })
      ).json().code,
    ).toBe('invalid_feed_url');
  });
});

describe('profit report', () => {
  it('reconciles gross − commission − expenses per unit and compares channels', async () => {
    const { c, unit } = await setup();
    // Oct 28 → Nov 2 (5 nights): 4 nights in October.
    await book(c, unit.id, {
      checkIn: '2026-10-28',
      checkOut: '2026-11-02',
      grossCents: 2_500_000,
    });
    await book(c, unit.id, {
      source: 'airbnb',
      checkIn: '2026-10-10',
      checkOut: '2026-10-14',
      grossCents: 2_400_000,
      commissionBps: 1500,
    });
    await book(c, unit.id, {
      source: 'direct',
      checkIn: '2026-10-15',
      checkOut: '2026-10-17',
      grossCents: 900_000,
    }).then(async (r) => c.post(`/v1/bookings/${r.json().id}/cancel`, { reason: 'x' }));
    await c.post('/v1/calendar-blocks', {
      unitId: unit.id,
      startsOn: '2026-10-01',
      endsOn: '2026-10-03',
      reason: 'owner_use',
    });
    for (const [category, amountCents] of [
      ['cleaning', 300_000],
      ['wifi', 250_000],
      ['tokens', 150_000],
    ] as const) {
      expect(
        (
          await c.post('/v1/unit-expenses', {
            unitId: unit.id,
            incurredOn: '2026-10-20',
            category,
            amountCents,
          })
        ).statusCode,
      ).toBe(201);
    }
    await c.post('/v1/unit-expenses', {
      unitId: unit.id,
      incurredOn: '2026-11-01',
      category: 'repair',
      amountCents: 999_999,
    });

    const r = (await c.get('/v1/reports/short-stay?period=2026-10')).json();
    const u = r.units[0];
    // Direct: 4/5 of 25,000 = 20,000. Airbnb: 24,000 gross, 3,600 commission.
    expect(u).toMatchObject({
      nightsSold: 8,
      availableNights: 29,
      grossCents: 4_400_000,
      commissionCents: 360_000,
      expensesCents: 700_000,
      netCents: 3_340_000,
    });
    expect(u.netCents).toBe(u.grossCents - u.commissionCents - u.expensesCents);
    expect(u.adrCents).toBe(550_000);
    expect(r.totals).toMatchObject({ grossCents: 4_400_000, netCents: 3_340_000 });
    const bySource = Object.fromEntries(
      r.channels.map((ch: { source: string }) => [ch.source, ch]),
    );
    expect(bySource.airbnb).toMatchObject({
      grossCents: 2_400_000,
      commissionCents: 360_000,
      netCents: 2_040_000,
    });
    expect(bySource.direct).toMatchObject({ grossCents: 2_000_000, commissionCents: 0 });

    const expenses = (
      await c.get(`/v1/unit-expenses?unitId=${unit.id}&from=2026-10-01&to=2026-10-31`)
    ).json().items;
    expect(expenses).toHaveLength(3);
  });
});
