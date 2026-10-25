import { sign } from '@kejasha/integrations-paystack';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createJobHandlers } from '../src/jobs';
import { client, ownerWithOrg, signUp } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const SECRET = 'sk_test_kejasha_secret';
const clock = testClock('2026-10-25');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({ BILLING_REQUIRED: 'true', PAYSTACK_SECRET_KEY: SECRET }, { clock });
});
afterAll(() => api.close());

type C = ReturnType<typeof client>;
const silent = { info: () => {}, error: () => {} };
const runBilling = () =>
  createJobHandlers(api.deps, silent).billing['billing.daily_run']!({} as never, {} as never);

function webhook(event: string, data: object, signature?: string) {
  const raw = JSON.stringify({ event, data });
  return api.app.inject({
    method: 'POST',
    url: '/v1/billing/paystack/webhook',
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-paystack-signature': signature ?? sign(SECRET, raw),
    },
  });
}

/** Checkout and complete payment through the (fake) Paystack, then deliver the webhook. */
async function payNow(c: C) {
  const co = await c.post('/v1/billing/checkout', { email: 'billing@example.test' });
  expect(co.statusCode, co.body).toBe(200);
  const { reference, amountCents } = co.json();
  api.paystack.complete(reference);
  const hook = await webhook('charge.success', {
    reference,
    status: 'success',
    amount: amountCents,
    currency: 'KES',
  });
  expect(hook.statusCode, hook.body).toBe(200);
  return co.json();
}

async function newLandlord() {
  clock.set('2026-10-25');
  const o = await ownerWithOrg(api);
  return { o, c: client(api, o.token) };
}

describe('no free use', () => {
  it('a new org can set up but not operate until the first month is paid', async () => {
    const { c } = await newLandlord();
    const billing = (await c.get('/v1/billing')).json();
    expect(billing).toMatchObject({
      status: 'incomplete',
      nextAmountCents: 50_000,
      usage: { units: 0, listings: 0 },
    });
    expect(billing.plan).toMatchObject({
      code: 'landlord',
      unitPriceCents: 10_000,
      minimumCents: 50_000,
    });

    // Setup is allowed …
    const p = await c.post('/v1/properties', { name: 'Kilimani', county: 'Nairobi' });
    expect(p.statusCode).toBe(201);
    expect(
      (
        await c.post(`/v1/properties/${p.json().id}/units`, {
          code: 'K1',
          mode: 'long_term',
          rentCents: 2_000_000,
        })
      ).statusCode,
    ).toBe(201);
    // … running the business is not.
    const blocked = await c.post('/v1/tenants', { fullName: 'Jane' });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe('subscription_required');
    expect((await c.get('/v1/tenants')).statusCode).toBe(200);

    const co = await payNow(c);
    expect(co).toMatchObject({
      amountCents: 50_000,
      authorizationUrl: expect.stringContaining('checkout.paystack.test'),
    });
    expect(api.paystack.initialized.at(-1)).toMatchObject({
      email: 'billing@example.test',
      amountCents: 50_000n,
    });
    const after = (await c.get('/v1/billing')).json();
    expect(after).toMatchObject({
      status: 'active',
      currentPeriodStart: '2026-10-25',
      currentPeriodEnd: '2026-11-24',
      card: { brand: 'visa', last4: '4081' },
      billingEmail: 'billing@example.test',
    });
    expect((await c.post('/v1/tenants', { fullName: 'Jane' })).statusCode).toBe(201);
    expect((await c.post('/v1/billing/checkout', {})).json().code).toBe('nothing_due');
  });

  it('webhooks are verified, stored, re-checked with Paystack and applied once', async () => {
    const { o, c } = await newLandlord();
    const co = (await c.post('/v1/billing/checkout', { email: 'pay@example.test' })).json();
    api.paystack.complete(co.reference);
    const body = {
      reference: co.reference,
      status: 'success',
      amount: co.amountCents,
      currency: 'KES',
    };
    expect((await webhook('charge.success', body, 'f'.repeat(128))).statusCode).toBe(401);
    for (let i = 0; i < 3; i++)
      expect((await webhook('charge.success', body)).statusCode).toBe(200);
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT count(*)::int AS n FROM subscription_payment WHERE org_id = $1',
      [o.org.id],
    );
    expect(rows[0].n).toBe(1);
    const events = await api.deps.db.pools.owner.query(
      'SELECT signature_ok, outcome FROM paystack_event WHERE reference = $1 ORDER BY received_at',
      [co.reference],
    );
    expect(events.rows.map((r) => [r.signature_ok, r.outcome])).toEqual([
      [false, null],
      [true, 'applied'],
      [true, 'duplicate'],
      [true, 'duplicate'],
    ]);
    // A forged "success" for an unpaid reference is ignored: Paystack's own record says pending.
    const other = await newLandlord();
    const co2 = (await other.c.post('/v1/billing/checkout', { email: 'x@example.test' })).json();
    expect(
      (
        await webhook('charge.success', {
          reference: co2.reference,
          status: 'success',
          amount: co2.amountCents,
          currency: 'KES',
        })
      ).statusCode,
    ).toBe(200);
    expect((await other.c.get('/v1/billing')).json().status).toBe('incomplete');
  });

  it('renews with the saved card; an unpaid renewal goes past due, then read-only, then back', async () => {
    const { c } = await newLandlord();
    await payNow(c);

    // Period ends 2026-11-24: on the 25th the saved card is charged for the next month.
    clock.set('2026-11-25');
    await runBilling();
    let b = (await c.get('/v1/billing')).json();
    expect(b).toMatchObject({
      status: 'active',
      currentPeriodStart: '2026-11-25',
      currentPeriodEnd: '2026-12-24',
    });

    // Next renewal fails: past due (everything still works) …
    api.paystack.nextCharge = 'failed';
    clock.set('2026-12-25');
    await runBilling();
    b = (await c.get('/v1/billing')).json();
    expect(b).toMatchObject({ status: 'past_due', pastDueSince: '2026-12-25' });
    expect(b.openInvoice).toMatchObject({ periodStart: '2026-12-25', attempts: 1 });
    expect((await c.post('/v1/tenants', { fullName: 'Still works' })).statusCode).toBe(201);

    // … retried on day 1 and 3, then suspended after the 7-day grace.
    for (const d of ['2026-12-26', '2026-12-28', '2027-01-01']) {
      clock.set(d);
      await runBilling();
    }
    expect((await c.get('/v1/billing')).json()).toMatchObject({
      status: 'past_due',
      openInvoice: { attempts: 4 },
    });
    clock.set('2027-01-02');
    await runBilling();
    expect((await c.get('/v1/billing')).json().status).toBe('suspended');
    const blocked = await c.post('/v1/tenants', { fullName: 'Blocked' });
    expect(blocked.statusCode).toBe(402);
    expect(blocked.json().code).toBe('subscription_suspended');
    expect((await c.get('/v1/tenants')).statusCode).toBe(200); // reads always work

    // Paying restores everything at once.
    await payNow(c);
    expect((await c.get('/v1/billing')).json().status).toBe('active');
    expect((await c.post('/v1/tenants', { fullName: 'Back' })).statusCode).toBe(201);
  });
});

describe('operator console', () => {
  it('only operators get in; every request is logged; actions land in the org audit', async () => {
    const { o, c } = await newLandlord();
    const staff = await signUp(api, 'Kejasha Support');
    const op = client(api, staff.token);
    expect((await op.get('/v1/operator/orgs')).statusCode).toBe(403);
    expect((await c.get('/v1/operator/orgs')).statusCode).toBe(403);
    await api.deps.db.pools.owner.query('INSERT INTO platform_operator (user_id) VALUES ($1)', [
      staff.userId,
    ]);

    const list = (await op.get(`/v1/operator/orgs?status=incomplete&limit=100`)).json();
    expect(list.items.map((x: { id: string }) => x.id)).toContain(o.org.id);
    const trial = await op.post(`/v1/operator/orgs/${o.org.id}/subscription`, {
      action: 'grant_trial',
      days: 14,
      note: 'Large agency evaluating',
    });
    expect(trial.statusCode, trial.body).toBe(200);
    expect(trial.json()).toMatchObject({ status: 'trialing', trialEndsOn: '2026-11-08' });
    expect((await c.post('/v1/tenants', { fullName: 'During trial' })).statusCode).toBe(201);

    // The trial lapses without payment → back to setup-only.
    clock.set('2026-11-09');
    await runBilling();
    expect((await c.get('/v1/billing')).json().status).toBe('incomplete');

    const audit = (await op.get(`/v1/operator/orgs/${o.org.id}/audit`)).json().items;
    expect(
      audit.find((a: { action: string }) => a.action === 'subscription.grant_trial'),
    ).toMatchObject({ actorKind: 'operator', actorUserId: staff.userId });
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT method, route, target_org FROM operator_access_log WHERE user_id = $1 ORDER BY id',
      [staff.userId],
    );
    expect(rows.map((r) => `${r.method} ${r.route}`)).toEqual([
      'GET /v1/operator/orgs',
      'POST /v1/operator/orgs/:orgId/subscription',
      'GET /v1/operator/orgs/:orgId/audit',
    ]);
    expect(rows[1].target_org).toBe(o.org.id);

    // Plan prices are data.
    const plans = (await op.get('/v1/operator/plans')).json().items;
    expect(
      plans.map((p: { code: string; unitPriceCents: number }) => [p.code, p.unitPriceCents]),
    ).toEqual([
      ['agency', 7_000],
      ['host', 10_000],
      ['landlord', 10_000],
    ]);
  });
});

describe('gate ordering', () => {
  it('a malformed request to an unpaid org is still a 400, not a 402', async () => {
    const { c } = await newLandlord();
    const bad = await c.patch('/v1/bookings/not-a-uuid', {});
    expect(bad.statusCode).toBe(400);
    expect((await c.post('/v1/tenants', { fullName: 'Valid' })).statusCode).toBe(402);
  });
});

describe('webhook robustness', () => {
  it('an unsigned body with NUL characters is stored cleaned and refused with 401', async () => {
    const res = await webhook(
      'charge.success\u0000',
      { reference: 'KJ-\u0000X', note: 'a\u0000b' },
      'f'.repeat(128),
    );
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_signature');
  });
});
