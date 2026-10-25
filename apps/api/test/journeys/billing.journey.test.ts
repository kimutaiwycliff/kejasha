import { randomUUID } from 'node:crypto';
import { sign } from '@kejasha/integrations-paystack';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createJobHandlers } from '../../src/jobs';
import { testClock } from '../helpers';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B6b): a host signs up — setup works, operating needs the first payment. They pay by
 * Paystack; next month the saved card renews; the month after it fails, the account goes past due,
 * then read-only (reads still work), and paying again restores it.
 */
const SECRET = 'sk_test_journey';
const clock = testClock('2026-10-25');
let j: Journey;
beforeAll(async () => {
  j = await startJourney({ clock, env: { BILLING_REQUIRED: 'true', PAYSTACK_SECRET_KEY: SECRET } });
});
afterAll(() => j.close());

const run = () =>
  createJobHandlers(j.api.deps, { info: () => {}, error: () => {} }).billing['billing.daily_run']!(
    {} as never,
    {} as never,
  );

async function paystackWebhook(reference: string, amount: number) {
  const raw = JSON.stringify({
    event: 'charge.success',
    data: { reference, status: 'success', amount, currency: 'KES' },
  });
  const res = await fetch(`${j.baseUrl}/v1/billing/paystack/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-paystack-signature': sign(SECRET, raw) },
    body: raw,
  });
  expect(res.status).toBe(200);
}

it('host: setup → pay → renew → lapse → read-only → pay → active', async () => {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Halima',
      email: `h-${randomUUID().slice(0, 6)}@example.test`,
      password: 'a-strong-password',
    },
  });
  const me = j.as(s.data!.token);
  await me.POST('/v1/orgs', { body: { name: 'Halima Stays', kind: 'host', county: 'Mombasa' } });
  const prop = await me.POST('/v1/properties', { body: { name: 'Nyali', county: 'Mombasa' } });
  for (const code of ['NY1', 'NY2', 'NY3'])
    await me.POST('/v1/properties/{propertyId}/units', {
      params: { path: { propertyId: prop.data!.id } },
      body: { code, mode: 'short_stay', baseNightlyCents: 500_000 },
    });

  // Three listings at KES 500 = KES 1,500 a month. Bookings need a paid account.
  const billing = await me.GET('/v1/billing');
  expect(billing.data).toMatchObject({
    status: 'incomplete',
    usage: { listings: 3 },
    nextAmountCents: 150_000,
  });
  const units = (
    await me.GET('/v1/units', { params: { query: { propertyId: prop.data!.id, limit: 10 } } })
  ).data!.items;
  const booking = {
    unitId: units[0]!.id,
    checkIn: '2026-11-01',
    checkOut: '2026-11-03',
    source: 'direct' as const,
  };
  const refused = await me.POST('/v1/bookings', { body: booking });
  expect(refused.response.status).toBe(402);

  const co = await me.POST('/v1/billing/checkout', { body: { email: 'halima@example.test' } });
  j.api.paystack.complete(co.data!.reference);
  await paystackWebhook(co.data!.reference, co.data!.amountCents);
  expect((await me.POST('/v1/bookings', { body: booking })).response.status).toBe(201);

  clock.set('2026-11-25');
  await run();
  expect((await me.GET('/v1/billing')).data).toMatchObject({
    status: 'active',
    currentPeriodEnd: '2026-12-24',
  });

  j.api.paystack.nextCharge = 'failed';
  for (const d of ['2026-12-25', '2026-12-26', '2026-12-28', '2027-01-01', '2027-01-02']) {
    clock.set(d);
    await run();
  }
  expect((await me.GET('/v1/billing')).data!.status).toBe('suspended');
  const blocked = await me.POST('/v1/calendar-blocks', {
    body: {
      unitId: units[1]!.id,
      startsOn: '2027-01-10',
      endsOn: '2027-01-12',
      reason: 'owner_use',
    },
  });
  expect(blocked.response.status).toBe(402);
  expect((await me.GET('/v1/bookings', { params: { query: { limit: 10 } } })).response.status).toBe(
    200,
  );

  const again = await me.POST('/v1/billing/checkout', { body: {} });
  j.api.paystack.complete(again.data!.reference);
  const verified = await me.POST('/v1/billing/verify', {
    body: { reference: again.data!.reference },
  });
  expect(verified.data!.status).toBe('active');
});
