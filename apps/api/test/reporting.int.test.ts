import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPhoneMember, client, ownerWithOrg } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-05');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
});
afterAll(() => api.close());

type C = ReturnType<typeof client>;

async function pay(c: C, leaseId: string, kes: number, paidOn: string) {
  const res = await c.post('/v1/payments', {
    method: 'mpesa',
    amountCents: kes * 100,
    paidOn,
    leaseId,
  });
  expect(res.statusCode, res.body).toBe(201);
  return res.json();
}

/**
 * Agency with two client landlords in October 2026:
 * - Wanjiku (10% fee): Kileleshwa — K1 let at 20,000 (paid 20,000), K2 vacant (asking 18,000);
 *   a K1 repair of 3,000 (ticket) and a 1,000 property-wide wifi bill.
 *   → income 20,000 − expenses 4,000 − fee 2,000 = net 14,000.
 * - Otieno (flat 5,000): Lavington — L1 let at 30,000 (paid 30,000) → net 25,000.
 */
async function agency() {
  clock.set('2026-10-05');
  const o = await ownerWithOrg(api, 'agency', 'Nyumba Agency');
  const c = client(api, o.token);
  const wanjiku = (
    await c.post('/v1/client-landlords', {
      name: 'Wanjiku',
      mgmtFeeKind: 'percent',
      mgmtFeeBps: 1000,
    })
  ).json();
  const otieno = (
    await c.post('/v1/client-landlords', {
      name: 'Otieno',
      mgmtFeeKind: 'flat',
      mgmtFeeFlatCents: 500_000,
    })
  ).json();
  const kil = (
    await c.post('/v1/properties', {
      name: 'Kileleshwa',
      county: 'Nairobi',
      clientLandlordId: wanjiku.id,
    })
  ).json();
  const lav = (
    await c.post('/v1/properties', {
      name: 'Lavington',
      county: 'Nairobi',
      clientLandlordId: otieno.id,
    })
  ).json();
  const unit = async (p: string, code: string, rentCents: number) =>
    (await c.post(`/v1/properties/${p}/units`, { code, mode: 'long_term', rentCents })).json();
  const k1 = await unit(kil.id, 'K1', 2_000_000);
  await unit(kil.id, 'K2', 1_800_000);
  const l1 = await unit(lav.id, 'L1', 3_000_000);
  const lease = async (unitId: string, name: string, rentCents: number) => {
    const t = (await c.post('/v1/tenants', { fullName: name })).json();
    return (
      await c.post('/v1/leases', { unitId, tenantId: t.id, startDate: '2026-10-01', rentCents })
    ).json();
  };
  const lk1 = await lease(k1.id, 'Kevin', 2_000_000);
  const ll1 = await lease(l1.id, 'Lilian', 3_000_000);
  await pay(c, lk1.id, 20_000, '2026-10-05');
  await pay(c, ll1.id, 30_000, '2026-10-05');
  const t = (
    await c.post('/v1/tickets', { unitId: k1.id, title: 'Door lock', category: 'security' })
  ).json();
  await c.post(`/v1/tickets/${t.id}/updates`, { status: 'resolved', costCents: 300_000 });
  await c.post('/v1/unit-expenses', {
    propertyId: kil.id,
    incurredOn: '2026-10-05',
    category: 'wifi',
    amountCents: 100_000,
  });
  return { o, c, wanjiku, otieno, kil, lav, lk1, ll1 };
}

describe('owner statements', () => {
  it('reconcile to the ledger, apply the management fee, and render a branded PDF', async () => {
    const { o, c, wanjiku, otieno } = await agency();
    const list = (await c.get('/v1/owner-statements?period=2026-10')).json();
    const by = Object.fromEntries(
      list.items.map((i: { landlordName: string }) => [i.landlordName, i]),
    );
    expect(by.Wanjiku).toMatchObject({
      incomeCents: 2_000_000,
      expensesCents: 400_000,
      managementFeeCents: 200_000,
      netCents: 1_400_000,
    });
    expect(by.Otieno).toMatchObject({
      incomeCents: 3_000_000,
      expensesCents: 0,
      managementFeeCents: 500_000,
      netCents: 2_500_000,
    });

    // Statement income = the ledger's collections for the period.
    const { rows } = await api.deps.db.pools.owner.query(
      `SELECT coalesce(sum(p.amount_cents), 0)::text AS t
         FROM ledger_posting p JOIN ledger_account a ON a.id = p.account_id AND a.kind = 'collections'
         JOIN ledger_entry e ON e.id = p.entry_id
        WHERE p.org_id = $1 AND e.occurred_on BETWEEN '2026-10-01' AND '2026-10-31'`,
      [o.org.id],
    );
    expect(Number(rows[0].t)).toBe(
      list.items.reduce((s: number, i: { incomeCents: number }) => s + i.incomeCents, 0),
    );

    const st = (await c.get(`/v1/owner-statements/${wanjiku.id}?period=2026-10`)).json();
    expect(st).toMatchObject({
      landlordName: 'Wanjiku',
      managedBy: 'Nyumba Agency',
      managementFee: { kind: 'percent', bps: 1000 },
    });
    expect(st.income).toEqual([
      expect.objectContaining({
        unitCode: 'K1',
        propertyName: 'Kileleshwa',
        payments: 1,
        receivedCents: 2_000_000,
      }),
    ]);
    expect(
      st.expenses.map((e: { category: string; unitCode: string | null; amountCents: number }) => [
        e.category,
        e.unitCode,
        e.amountCents,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['repair', 'K1', 300_000],
        ['wifi', null, 100_000],
      ]),
    );

    // A reversed payment in the month comes off the statement.
    const otienoPay = (await c.get('/v1/payments?limit=10'))
      .json()
      .items.find((p: { unitCode: string }) => p.unitCode === 'L1');
    await c.post(`/v1/payments/${otienoPay.id}/unallocate`, { reason: 'Wrong tenant' });
    const after = (await c.get(`/v1/owner-statements/${otieno.id}?period=2026-10`)).json();
    expect(after).toMatchObject({
      incomeCents: 0,
      managementFeeCents: 500_000,
      netCents: -500_000,
    });
    expect(after.income[0]).toMatchObject({ payments: 0, receivedCents: 0 });

    expect((await c.patch('/v1/org', { brandColor: '#1D4ED8' })).json().brandColor).toBe('#1D4ED8');
    const pdf = await c.get(`/v1/owner-statements/${wanjiku.id}/pdf?period=2026-10`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('reports and exports', () => {
  it('rent roll, collections, occupancy, dashboard and CSV', async () => {
    const { c, wanjiku } = await agency();
    const roll = (await c.get(`/v1/reports/rent-roll?clientLandlordId=${wanjiku.id}`)).json();
    expect(
      roll.items.map(
        (i: {
          unitCode: string;
          status: string;
          tenantName: string | null;
          rentCents: number;
          balanceCents: number;
        }) => [i.unitCode, i.status, i.tenantName, i.rentCents, i.balanceCents],
      ),
    ).toEqual([
      ['K1', 'occupied', 'Kevin', 2_000_000, 0],
      ['K2', 'vacant', null, 1_800_000, 0],
    ]);
    expect(roll.totals).toMatchObject({
      units: 2,
      occupied: 1,
      occupancyBps: 5000,
      rentCents: 2_000_000,
    });

    const col = (await c.get('/v1/reports/collections?from=2026-10-01&to=2026-10-31')).json();
    expect(col).toMatchObject({ totalCents: 5_000_000, count: 2 });
    expect(col.byMethod).toEqual([{ key: 'mpesa', amountCents: 5_000_000, count: 2 }]);
    expect(col.byDay).toEqual([{ date: '2026-10-05', amountCents: 5_000_000, count: 2 }]);
    expect((await c.get('/v1/reports/collections?from=2026-10-31&to=2026-10-01')).json().code).toBe(
      'invalid_range',
    );

    const occ = (await c.get('/v1/reports/occupancy?period=2026-10')).json();
    expect(occ.longTerm).toEqual({ units: 3, occupied: 2, occupancyBps: 6667 });

    const dash = (
      await c.get(`/v1/reports/owner-dashboard?period=2026-10&clientLandlordId=${wanjiku.id}`)
    ).json();
    expect(dash).toMatchObject({
      landlordName: 'Wanjiku',
      collectedCents: 2_000_000,
      expensesCents: 400_000,
      managementFeeCents: 200_000,
      netCents: 1_400_000,
      longTermOccupancyBps: 5000,
      activeTickets: 1,
    });
    expect(dash.trend).toHaveLength(6);
    expect(dash.trend.at(-1)).toMatchObject({ period: '2026-10', netCents: 1_400_000 });

    const csv = await c.get(`/v1/exports/rent-roll?clientLandlordId=${wanjiku.id}`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('rent-roll-2026-10-05.csv');
    expect(csv.body.split('\r\n').slice(0, 3)).toEqual([
      'Property,Unit,Status,Tenant,Rent (KES),Lease start,Lease end,Balance (KES)',
      'Kileleshwa,K1,occupied,Kevin,20000.00,2026-10-01,,0.00',
      'Kileleshwa,K2,vacant,,18000.00,,,0.00',
    ]);
    for (const ds of [
      'collections',
      'payments',
      'unit-expenses',
      'bookings',
      'tickets',
      'tenants',
      'arrears',
    ]) {
      const r = await c.get(`/v1/exports/${ds}?from=2026-10-01&to=2026-10-31`);
      expect(r.statusCode, `${ds}: ${r.body.slice(0, 200)}`).toBe(200);
      expect(r.body.length).toBeGreaterThan(10);
    }
    expect((await c.get('/v1/exports/payments?from=2026-10-01&to=2026-10-31')).body).toContain(
      '20000.00',
    );
  });
});

describe('read-only owner (viewer)', () => {
  it('sees only their landlord, cannot write, and needs a scope in an agency', async () => {
    const { o, c, wanjiku, otieno } = await agency();
    const viewer = await addPhoneMember(api, o, 'viewer');
    const v = client(api, viewer.token);
    expect((await v.get('/v1/owner-statements?period=2026-10')).json().code).toBe(
      'viewer_scope_required',
    );

    const members = (await c.get('/v1/members')).json().items;
    const vm = members.find((m: { userId: string }) => m.userId === viewer.userId);
    expect(
      (await c.put(`/v1/members/${vm.id}/scope`, { clientLandlordId: wanjiku.id }))
        .json()
        .items.find((m: { userId: string }) => m.userId === viewer.userId).clientLandlordId,
    ).toBe(wanjiku.id);
    const owner = members.find((m: { userId: string }) => m.userId === o.userId);
    expect(
      (await c.put(`/v1/members/${owner.id}/scope`, { clientLandlordId: wanjiku.id })).json().code,
    ).toBe('not_a_viewer');

    const list = (await v.get('/v1/owner-statements?period=2026-10')).json();
    expect(list.items.map((i: { landlordName: string }) => i.landlordName)).toEqual(['Wanjiku']);
    expect((await v.get(`/v1/owner-statements/${otieno.id}?period=2026-10`)).statusCode).toBe(404);
    expect((await v.get(`/v1/owner-statements/${wanjiku.id}/pdf?period=2026-10`)).statusCode).toBe(
      200,
    );
    expect((await v.get('/v1/reports/owner-dashboard?period=2026-10')).json()).toMatchObject({
      landlordName: 'Wanjiku',
      netCents: 1_400_000,
    });
    expect(
      (await v.get('/v1/reports/rent-roll'))
        .json()
        .items.map((i: { unitCode: string }) => i.unitCode),
    ).toEqual(['K1', 'K2']);
    expect(
      (await v.get('/v1/reports/collections?from=2026-10-01&to=2026-10-31')).json().totalCents,
    ).toBe(2_000_000);
    expect((await v.get('/v1/exports/rent-roll')).body).not.toContain('Lavington');
    expect((await v.get('/v1/exports/payments')).json().code).toBe('viewer_read_only');
    expect(
      (await v.get('/v1/compliance/mri?period=2026-10'))
        .json()
        .landlords.map((l: { name: string }) => l.name),
    ).toEqual(['Wanjiku']);
    expect((await v.get('/v1/org')).json().name).toBe('Nyumba Agency');

    // Everything else is refused — reads and writes alike.
    for (const [method, url] of [
      ['get', '/v1/tenants'],
      ['get', '/v1/payments'],
      ['get', '/v1/properties'],
      ['get', '/v1/members'],
      ['post', '/v1/properties'],
      ['post', '/v1/tickets'],
    ] as const) {
      const r = method === 'get' ? await v.get(url) : await v.post(url, {});
      expect(r.statusCode, url).toBe(403);
      expect(r.json().code, url).toBe('viewer_read_only');
    }
  });

  it('a viewer of a landlord org sees the whole org without a scope', async () => {
    clock.set('2026-10-05');
    const o = await ownerWithOrg(api, 'landlord');
    const v = client(api, (await addPhoneMember(api, o, 'viewer')).token);
    const r = await v.get('/v1/owner-statements?period=2026-10');
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().items).toHaveLength(1);
  });
});
