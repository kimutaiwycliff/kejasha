import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobHandlers } from '../src/jobs';
import { client, ownerWithOrg } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-01');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
});
afterAll(() => api.close());

type C = ReturnType<typeof client>;
const silent = { info: () => {}, error: () => {} };

async function pay(c: C, leaseId: string, kes: number, paidOn: string) {
  const res = await c.post('/v1/payments', {
    method: 'mpesa',
    amountCents: kes * 100,
    paidOn,
    leaseId,
  });
  expect(res.statusCode, res.body).toBe(201);
}

/**
 * Hand-calculated October 2026:
 * - A1 (Riverside, residential): rent 20,000 + service charge 2,000, deposit 40,000; tenant has a
 *   PIN. Pays 62,000 on 1 Oct (deposit + October) → rent 20,000. Pays 11,000 on 25 Oct, applied
 *   to the November invoice (22,000) → rent 11,000 × 20,000 / 22,000 = 10,000.
 * - C1 (Riverside): rent 15,000, no PIN, pays 15,000 on 5 Oct → rent 15,000.
 * - B1 (Hillview, commercial): pays 50,000 → not MRI.
 * Total rent 45,000 → MRI 3,375.00, due 20 Nov 2026.
 */
async function october() {
  clock.set('2026-10-01');
  const o = await ownerWithOrg(api);
  const c = client(api, o.token);
  const riverside = (
    await c.post('/v1/properties', { name: 'Riverside', county: 'Nairobi' })
  ).json();
  const hillview = (
    await c.post('/v1/properties', { name: 'Hillview', county: 'Nairobi', kind: 'commercial' })
  ).json();
  const mk = async (propertyId: string, code: string, rentCents: number) =>
    (
      await c.post(`/v1/properties/${propertyId}/units`, { code, mode: 'long_term', rentCents })
    ).json();
  const a1 = await mk(riverside.id, 'A1', 2_000_000);
  const c1 = await mk(riverside.id, 'C1', 1_500_000);
  const b1 = await mk(hillview.id, 'B1', 5_000_000);
  const tA = (
    await c.post('/v1/tenants', { fullName: 'Amina Hassan', kraPin: 'A012345678Z' })
  ).json();
  const tC = (await c.post('/v1/tenants', { fullName: 'Chege Kamau' })).json();
  const tB = (
    await c.post('/v1/tenants', { fullName: 'Biashara Ltd', kraPin: 'P051234567X' })
  ).json();
  const leaseA = (
    await c.post('/v1/leases', {
      unitId: a1.id,
      tenantId: tA.id,
      startDate: '2026-10-01',
      rentCents: 2_000_000,
      depositCents: 4_000_000,
      charges: [{ kind: 'service_charge', method: 'flat', amountCents: 200_000 }],
    })
  ).json();
  const leaseC = (
    await c.post('/v1/leases', {
      unitId: c1.id,
      tenantId: tC.id,
      startDate: '2026-10-01',
      rentCents: 1_500_000,
    })
  ).json();
  const leaseB = (
    await c.post('/v1/leases', {
      unitId: b1.id,
      tenantId: tB.id,
      startDate: '2026-10-01',
      rentCents: 5_000_000,
    })
  ).json();
  await pay(c, leaseA.id, 62_000, '2026-10-01');
  await pay(c, leaseC.id, 15_000, '2026-10-05');
  await pay(c, leaseB.id, 50_000, '2026-10-05');
  clock.set('2026-10-31'); // the November invoice is issued 5 days before it is due
  expect((await c.post('/v1/billing/run')).statusCode).toBe(200);
  await pay(c, leaseA.id, 11_000, '2026-10-25');
  return { o, c, leaseA };
}

describe('Monthly Rental Income', () => {
  it('matches the hand calculation, excludes commercial, exports eRITS CSV, and snapshots filings', async () => {
    const { c } = await october();
    const month = (await c.get('/v1/compliance/mri?period=2026-10')).json();
    expect(month).toMatchObject({ period: '2026-10', dueOn: '2026-11-20', rateBps: 750 });
    expect(month.landlords).toHaveLength(1);
    const self = month.landlords[0];
    expect(self).toMatchObject({
      isSelf: true,
      rentCents: 4_500_000,
      taxCents: 337_500,
      yearToDateRentCents: 4_500_000,
      band: 'below_threshold',
      hasMixedProperties: false,
      tenantsMissingPin: 1,
      filing: null,
    });

    const detail = (
      await c.get(`/v1/compliance/mri/${self.clientLandlordId}?period=2026-10`)
    ).json();
    expect(
      detail.lines.map(
        (l: { unitCode: string; receivedCents: number; rentCents: number; taxCents: number }) => [
          l.unitCode,
          l.receivedCents,
          l.rentCents,
          l.taxCents,
        ],
      ),
    ).toEqual([
      ['A1', 7_300_000, 3_000_000, 225_000],
      ['C1', 1_500_000, 1_500_000, 112_500],
    ]);

    const csv = await c.get(`/v1/compliance/mri/${self.clientLandlordId}/erits.csv?period=2026-10`);
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.split('\r\n')).toEqual([
      'Tenant PIN,Tenant name,Unit,Property,Rent received (KES),MRI 7.5% (KES)',
      'A012345678Z,Amina Hassan,A1,Riverside,30000.00,2250.00',
      ',Chege Kamau,C1,Riverside,15000.00,1125.00',
      ',TOTAL,,,45000.00,3375.00',
      '',
    ]);

    // Filing snapshots the figures; a later receipt in the month shows as a difference.
    const filed = await c.post(`/v1/compliance/mri/${self.clientLandlordId}/filings`, {
      period: '2026-10',
      filedOn: '2026-10-31',
      kraReference: 'KRA20261031001',
    });
    expect(filed.statusCode, filed.body).toBe(201);
    expect(filed.json().filing).toMatchObject({
      taxCents: 337_500,
      differenceCents: 0,
      kraReference: 'KRA20261031001',
    });
    expect(
      (
        await c.post(`/v1/compliance/mri/${self.clientLandlordId}/filings`, {
          period: '2026-10',
          filedOn: '2026-10-31',
        })
      ).json().code,
    ).toBe('already_filed');
    const c1Lease = detail.lines.find((l: { unitCode: string }) => l.unitCode === 'C1').leaseId;
    await pay(c, c1Lease, 1_000, '2026-10-30'); // advance rent → +1,000 rent → +75 tax
    const after = (await c.get('/v1/compliance/mri?period=2026-10')).json().landlords[0];
    expect(after.filing.differenceCents).toBe(7_500);
    expect((await c.delete(`/v1/compliance/mri-filings/${after.filing.id}`)).statusCode).toBe(204);

    const pins = (await c.get('/v1/compliance/tenant-pins')).json();
    expect(pins).toMatchObject({ total: 3, missing: 1 });
    expect(pins.items[0]).toMatchObject({
      fullName: 'Chege Kamau',
      kraPin: null,
      unitCodes: ['C1'],
    });
  });

  it('reminds owners on the 15th for an unfiled eligible month, once', async () => {
    clock.set('2026-10-01');
    const o = await ownerWithOrg(api);
    const c = client(api, o.token);
    const p = (await c.post('/v1/properties', { name: 'Tower', county: 'Nairobi' })).json();
    const u = (
      await c.post(`/v1/properties/${p.id}/units`, {
        code: 'T1',
        mode: 'long_term',
        rentCents: 30_000_000,
      })
    ).json();
    const t = (await c.post('/v1/tenants', { fullName: 'Big Tenant' })).json();
    const l = (
      await c.post('/v1/leases', {
        unitId: u.id,
        tenantId: t.id,
        startDate: '2026-10-01',
        rentCents: 30_000_000,
      })
    ).json();
    await pay(c, l.id, 300_000, '2026-10-02'); // KES 300,000 → eligible band
    clock.set('2026-11-15');
    const jobs = createJobHandlers(api.deps, silent);
    await jobs.compliance['compliance.daily_run']!({} as never, {} as never);
    await jobs.compliance['compliance.daily_run']!({} as never, {} as never);
    const { rows } = await api.deps.db.pools.owner.query(
      `SELECT payload FROM outbox WHERE org_id = $1 AND dedupe_key LIKE 'mri:%'`,
      [o.org.id],
    );
    expect(rows).toHaveLength(1); // the owner signed up by email only
    expect(rows[0].payload).toMatchObject({
      subject: 'Monthly Rental Income for 2026-10: KES 22,500.00 due by 2026-11-20',
    });
  });
});

describe('licences', () => {
  it('tracks expiry status and sends reminders at 30/7/1/0 days', async () => {
    clock.set('2026-10-21');
    const o = await ownerWithOrg(api, 'host');
    const c = client(api, o.token);
    const p = (await c.post('/v1/properties', { name: 'Diani Villas', county: 'Kwale' })).json();
    const u = (
      await c.post(`/v1/properties/${p.id}/units`, {
        code: 'DV1',
        mode: 'short_stay',
        baseNightlyCents: 800_000,
      })
    ).json();
    const tra = await c.post('/v1/licences', {
      unitId: u.id,
      kind: 'tra_short_stay',
      number: 'TRA/2026/001',
      issuedOn: '2025-11-20',
      expiresOn: '2026-11-20',
      feeCents: 1_000_000,
    });
    expect(tra.statusCode, tra.body).toBe(201);
    expect(tra.json()).toMatchObject({
      status: 'expiring',
      daysToExpiry: 30,
      propertyName: 'Diani Villas',
      unitCode: 'DV1',
    });
    const permit = (
      await c.post('/v1/licences', {
        propertyId: p.id,
        kind: 'county_business_permit',
        expiresOn: '2026-10-01',
      })
    ).json();
    expect(permit).toMatchObject({ status: 'expired', unitId: null });
    expect(
      (await c.post('/v1/licences', { kind: 'other', expiresOn: '2027-01-01' })).json().code,
    ).toBe('target_required');
    expect(
      (await c.get('/v1/licences?status=expired')).json().items.map((l: { id: string }) => l.id),
    ).toEqual([permit.id]);

    const jobs = createJobHandlers(api.deps, silent);
    await jobs.compliance['compliance.daily_run']!({} as never, {} as never);
    const sent = async () =>
      (
        await api.deps.db.pools.owner.query(
          `SELECT payload FROM outbox WHERE org_id = $1 AND dedupe_key LIKE 'licence:%' ORDER BY created_at`,
          [o.org.id],
        )
      ).rows;
    expect((await sent()).map((r) => r.payload.subject)).toEqual([
      'TRA short-stay licence for DV1 (Diani Villas) is expiring',
    ]);
    clock.set('2026-11-19');
    await jobs.compliance['compliance.daily_run']!({} as never, {} as never);
    expect(await sent()).toHaveLength(2);

    // Renewal moves the expiry; archiving stops reminders.
    const renewed = (
      await c.patch(`/v1/licences/${tra.json().id}`, { expiresOn: '2027-11-20' })
    ).json();
    expect(renewed.status).toBe('valid');
    expect((await c.delete(`/v1/licences/${permit.id}`)).statusCode).toBe(204);
    expect((await c.get('/v1/licences')).json().items).toHaveLength(1);
  });
});
