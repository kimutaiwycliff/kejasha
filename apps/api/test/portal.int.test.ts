import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, ownerWithOrg, signInByOtp, signUp, uniquePhone } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-21');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
});
afterAll(() => api.close());

/** A landlord org with a Paybill, one unit leased to `phone` and one to someone else. */
async function landlord(name: string, phone: string) {
  const o = await ownerWithOrg(api, 'landlord', name);
  const c = client(api, o.token);
  const p = (await c.post('/v1/properties', { name: `${name} Court`, county: 'Nairobi' })).json();
  const unit = async (code: string) =>
    (
      await c.post(`/v1/properties/${p.id}/units`, {
        code,
        mode: 'long_term',
        rentCents: 2_000_000,
      })
    ).json();
  const mine = await unit('A1');
  const theirs = await unit('A2');
  const me = (await c.post('/v1/tenants', { fullName: 'Grace Achieng', phone })).json();
  const other = (
    await c.post('/v1/tenants', { fullName: 'Someone Else', phone: uniquePhone() })
  ).json();
  const myLease = (
    await c.post('/v1/leases', {
      unitId: mine.id,
      tenantId: me.id,
      startDate: '2026-10-01',
      rentCents: 2_000_000,
    })
  ).json();
  const otherLease = (
    await c.post('/v1/leases', {
      unitId: theirs.id,
      tenantId: other.id,
      startDate: '2026-10-01',
      rentCents: 2_000_000,
    })
  ).json();
  const ch = (
    await c.post('/v1/payment-channels', {
      kind: 'paybill',
      shortcode: String(600_000 + Math.floor(Math.random() * 99_999)),
      displayName: 'Paybill',
    })
  ).json();
  await c.put(`/v1/payment-channels/${ch.id}/credentials`, {
    consumerKey: 'k',
    consumerSecret: 's',
    passkey: 'p',
  });
  return { o, c, myLease, otherLease };
}

describe('tenant portal', () => {
  it('a tenant renting from two landlords sees both, pays, gets receipts and reports repairs', async () => {
    const phone = uniquePhone();
    const a = await landlord('Kamau Homes', phone);
    const b = await landlord('Wairimu Estates', phone);
    const t = client(api, (await signInByOtp(api, phone)).token);

    const me = (await t.get('/v1/portal/me')).json();
    expect(me.phoneVerified).toBe(true);
    expect(me.tenancies.map((x: { landlordName: string }) => x.landlordName).sort()).toEqual([
      'Kamau Homes',
      'Wairimu Estates',
    ]);
    const leaseA = me.tenancies.find(
      (x: { landlordName: string }) => x.landlordName === 'Kamau Homes',
    ).leases[0];
    expect(leaseA).toMatchObject({
      leaseId: a.myLease.id,
      unitCode: 'A1',
      status: 'active',
      balanceCents: 2_000_000,
    });

    // Another tenant's lease in the same building is invisible.
    expect((await t.get(`/v1/portal/leases/${a.otherLease.id}/statement`)).statusCode).toBe(404);
    expect((await t.post(`/v1/portal/leases/${a.otherLease.id}/pay`, {})).statusCode).toBe(404);

    const st = (await t.get(`/v1/portal/leases/${a.myLease.id}/statement`)).json();
    expect(st.closingBalanceCents).toBe(2_000_000);

    const stk = await t.post(`/v1/portal/leases/${b.myLease.id}/pay`, {});
    expect(stk.statusCode, stk.body).toBe(201);
    expect(stk.json()).toMatchObject({
      leaseId: b.myLease.id,
      amountCents: 2_000_000,
      accountRef: 'A1',
    });

    // The landlord records a payment; the tenant downloads its receipt (and only theirs).
    const paid = (
      await a.c.post('/v1/payments', {
        method: 'mpesa',
        amountCents: 2_000_000,
        paidOn: '2026-10-05',
        leaseId: a.myLease.id,
      })
    ).json();
    const other = (
      await a.c.post('/v1/payments', {
        method: 'mpesa',
        amountCents: 2_000_000,
        paidOn: '2026-10-05',
        leaseId: a.otherLease.id,
      })
    ).json();
    const pdf = await t.get(`/v1/portal/payments/${paid.id}/receipt`);
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect((await t.get(`/v1/portal/payments/${other.id}/receipt`)).statusCode).toBe(404);

    const ticket = await t.post('/v1/portal/tickets', {
      leaseId: a.myLease.id,
      title: 'No water',
      category: 'plumbing',
    });
    expect(ticket.statusCode, ticket.body).toBe(201);
    expect(ticket.json()).toMatchObject({ reporterKind: 'tenant', unitCode: 'A1', status: 'open' });
    expect((await a.c.get(`/v1/tickets/${ticket.json().id}`)).json().tenantId).toBeTruthy();
    expect(
      (await t.get('/v1/portal/tickets')).json().items.map((x: { title: string }) => x.title),
    ).toEqual(['No water']);

    // Portal users are not org members.
    expect((await t.get('/v1/tenants')).statusCode).toBe(403);
  });

  it('an email-only user has no tenancies', async () => {
    const s = await signUp(api, 'Curious');
    const me = (await client(api, s.token).get('/v1/portal/me')).json();
    expect(me).toEqual({ phone: null, phoneVerified: false, tenancies: [] });
  });
});
