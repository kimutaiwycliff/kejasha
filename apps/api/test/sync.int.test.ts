import { uuidv7 } from '@kejasha/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPhoneMember, client, ownerWithOrg } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-21');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
});
afterAll(() => api.close());

type C = ReturnType<typeof client>;

/** Two properties (caretaker on Riverside only), a let unit with a water meter on each. */
async function setup() {
  const o = await ownerWithOrg(api);
  const c = client(api, o.token);
  const make = async (name: string, code: string) => {
    const p = (await c.post('/v1/properties', { name, county: 'Nairobi' })).json();
    const u = (
      await c.post(`/v1/properties/${p.id}/units`, {
        code,
        mode: 'long_term',
        rentCents: 1_000_000,
      })
    ).json();
    const m = (await c.post(`/v1/units/${u.id}/meters`, { kind: 'water' })).json().items[0];
    return { p, u, m };
  };
  const river = await make('Riverside', 'R1');
  const hill = await make('Hillview', 'H1');
  const t = (await c.post('/v1/tenants', { fullName: 'Jane Wanjiru', phone: '0712000111' })).json();
  const lease = (
    await c.post('/v1/leases', {
      unitId: river.u.id,
      tenantId: t.id,
      startDate: '2026-10-01',
      rentCents: 1_000_000,
    })
  ).json();
  const caretaker = await addPhoneMember(api, o, 'caretaker');
  await c.put(`/v1/properties/${river.p.id}/staff`, { userIds: [caretaker.userId] });
  return { o, c, care: client(api, caretaker.token), caretaker, river, hill, t, lease };
}

const pull = async (c: C, cursor?: string) => {
  const res = await c.get(`/v1/sync/pull${cursor ? `?cursor=${cursor}` : ''}`);
  expect(res.statusCode, res.body).toBe(200);
  return res.json();
};
const ids = (x: { upserted: { id: string }[] }) => x.upserted.map((r) => r.id).sort();

describe('sync pull', () => {
  it('snapshot, then only what changed; staff see tenants and leases', async () => {
    const { c, river, hill, t, lease } = await setup();
    const first = await pull(c);
    expect(first).toMatchObject({ reset: true, hasMore: false });
    expect(ids(first.changes.properties)).toEqual([river.p.id, hill.p.id].sort());
    expect(ids(first.changes.meters)).toEqual([river.m.id, hill.m.id].sort());
    expect(ids(first.changes.tenants)).toEqual([t.id]);
    expect(first.changes.leases.upserted[0]).toMatchObject({
      id: lease.id,
      unitId: river.u.id,
      status: 'active',
    });

    const quiet = await pull(c, first.cursor);
    expect(quiet.reset).toBe(false);
    for (const table of Object.values(quiet.changes) as {
      upserted: unknown[];
      deleted: unknown[];
    }[]) {
      expect(table.upserted).toEqual([]);
      expect(table.deleted).toEqual([]);
    }

    await c.patch(`/v1/units/${hill.u.id}`, { label: 'Ground floor' });
    await c.delete(`/v1/properties/${hill.p.id}`).catch(() => undefined);
    const changed = await pull(c, quiet.cursor);
    expect(
      changed.changes.units.upserted.map((u: { id: string; label: string }) => [u.id, u.label]),
    ).toEqual([[hill.u.id, 'Ground floor']]);
    expect(changed.changes.meters.upserted).toEqual([]);

    expect((await c.get('/v1/sync/pull?cursor=bm90LWEtY3Vyc29y')).json().code).toBe(
      'invalid_cursor',
    );
  });

  it('caretakers see only assigned properties, never tenants or leases; access changes force a reset', async () => {
    const { c, care, caretaker, river, hill } = await setup();
    const first = await pull(care);
    expect(ids(first.changes.properties)).toEqual([river.p.id]);
    expect(ids(first.changes.meters)).toEqual([river.m.id]);
    expect(first.changes.tenants.upserted).toEqual([]);
    expect(first.changes.leases.upserted).toEqual([]);

    await c.put(`/v1/properties/${hill.p.id}/staff`, { userIds: [caretaker.userId] });
    const widened = await pull(care, first.cursor);
    expect(widened.reset).toBe(true);
    expect(ids(widened.changes.properties)).toEqual([river.p.id, hill.p.id].sort());

    await c.put(`/v1/properties/${river.p.id}/staff`, { userIds: [] });
    const narrowed = await pull(care, widened.cursor);
    expect(narrowed.reset).toBe(true);
    expect(ids(narrowed.changes.properties)).toEqual([hill.p.id]);
  });
});

describe('sync push', () => {
  it('a batch of 50 readings pushed twice is applied once', async () => {
    const { care, river } = await setup();
    const readings = Array.from({ length: 50 }, (_, i) => ({
      id: uuidv7(),
      meterId: river.m.id,
      readOn: new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10),
      reading: String(100 + i * 2),
    }));
    const once = (await care.post('/v1/sync/push', { meterReadings: readings })).json();
    expect(once.results.filter((r: { status: string }) => r.status === 'applied')).toHaveLength(50);
    const twice = (await care.post('/v1/sync/push', { meterReadings: readings })).json();
    expect(twice.results.map((r: { status: string }) => r.status)).toEqual(
      Array(50).fill('duplicate'),
    );
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT count(*)::int AS n FROM meter_reading WHERE meter_id = $1',
      [river.m.id],
    );
    expect(rows[0].n).toBe(50);

    // A device's pull returns them, with the client's own ids.
    const p = await pull(care);
    expect(ids(p.changes.meterReadings)).toEqual(readings.map((r) => r.id).sort());
  });

  it('tickets, notes and cash created offline; a note on a closed ticket is rejected', async () => {
    const { c, care, river, hill, lease } = await setup();
    const ticketId = uuidv7();
    const res = (
      await care.post('/v1/sync/push', {
        tickets: [{ id: ticketId, unitId: river.u.id, title: 'Leaking tap', category: 'plumbing' }],
        ticketUpdates: [
          {
            id: uuidv7(),
            ticketId,
            note: 'Washer replaced',
            status: 'resolved',
            costCents: 50_000,
          },
        ],
        meterReadings: [
          { id: uuidv7(), meterId: river.m.id, readOn: '2026-10-20', reading: '120' },
          { id: uuidv7(), meterId: river.m.id, readOn: '2026-10-21', reading: '110' },
          { id: uuidv7(), meterId: hill.m.id, readOn: '2026-10-21', reading: '5' },
        ],
        cashCollections: [
          { id: uuidv7(), leaseId: lease.id, amountCents: 1_000_000, receivedOn: '2026-10-21' },
        ],
      })
    ).json();
    expect(
      res.results.map((r: { type: string; status: string; code: string | null }) => [
        r.type,
        r.status,
        r.code,
      ]),
    ).toEqual([
      ['ticket', 'applied', null],
      ['ticket_update', 'applied', null],
      ['meter_reading', 'applied', null],
      ['meter_reading', 'rejected', 'reading_decreased'],
      ['meter_reading', 'rejected', 'not_found'],
      ['cash_collection', 'applied', null],
    ]);
    expect((await c.get(`/v1/tickets/${ticketId}`)).json()).toMatchObject({
      status: 'resolved',
      costCents: 50_000,
    });

    await c.post(`/v1/tickets/${ticketId}/updates`, { status: 'closed' });
    const late = (
      await care.post('/v1/sync/push', {
        ticketUpdates: [{ id: uuidv7(), ticketId, note: 'Dripping again' }],
      })
    ).json();
    expect(late.results[0]).toMatchObject({ status: 'rejected', code: 'ticket_finished' });

    // Cash stays a proposal until confirmed.
    expect((await c.get('/v1/cash-collections?status=pending')).json().items).toHaveLength(1);
    const tooMany = {
      meterReadings: Array.from({ length: 201 }, (_, i) => ({
        id: uuidv7(),
        meterId: river.m.id,
        readOn: '2026-10-01',
        reading: String(i),
      })),
    };
    expect((await care.post('/v1/sync/push', tooMany)).statusCode).toBeGreaterThanOrEqual(400);
  });
});
