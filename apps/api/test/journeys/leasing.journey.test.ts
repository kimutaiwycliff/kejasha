import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testClock } from '../helpers';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B2): a landlord signs a mid-month lease, the monthly run bills it (twice — no
 * duplicates), a late fee lands, arrears age correctly, a double lease is refused by the database,
 * and the org's ledger balances to zero throughout.
 */
const clock = testClock('2026-10-21');
let j: Journey;
beforeAll(async () => {
  j = await startJourney({ clock });
});
afterAll(() => j.close());

it('lease → prorated invoice → idempotent monthly run → late fee → arrears; trial balance 0', async () => {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Muthoni',
      email: `muthoni-${randomUUID().slice(0, 6)}@example.test`,
      password: 'a-strong-password',
    },
  });
  const me = j.as(s.data!.token);
  const org = await me.POST('/v1/orgs', {
    body: { name: 'Muthoni Homes', kind: 'landlord', county: 'Nairobi' },
  });
  const prop = await me.POST('/v1/properties', {
    body: { name: 'Lavington Court', county: 'Nairobi' },
  });
  const unit = await me.POST('/v1/properties/{propertyId}/units', {
    params: { path: { propertyId: prop.data!.id } },
    body: { code: 'LC1', mode: 'long_term', rentCents: 4_500_000 },
  });
  const tenant = await me.POST('/v1/tenants', {
    body: { fullName: 'Kevin Otieno', phone: '0711 222 333' },
  });

  const lease = await me.POST('/v1/leases', {
    body: {
      unitId: unit.data!.id,
      tenantId: tenant.data!.id,
      startDate: '2026-10-21',
      rentCents: 4_500_000,
      depositCents: 4_500_000,
      billingDay: 5,
      lateFeeKind: 'percent',
      lateFeeBps: 1000,
      lateFeeGraceDays: 3,
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(lease.response.status).toBe(201);
  // Deposit 45,000 + October 11/31 days of 45,000 = 15,967.74
  expect(lease.data!.balanceCents).toBe(4_500_000 + 1_596_774);

  // The database refuses a second lease overlapping the first.
  const clash = await me.POST('/v1/leases', {
    body: {
      unitId: unit.data!.id,
      tenantId: tenant.data!.id,
      startDate: '2027-01-01',
      rentCents: 1,
    },
  });
  expect(clash.response.status).toBe(409);
  expect(clash.error).toMatchObject({ code: 'lease_overlap' });

  // Nov 5 due → issued Oct 31. Two runs, one invoice.
  clock.set('2026-10-31');
  const first = await me.POST('/v1/billing/run');
  const second = await me.POST('/v1/billing/run');
  expect([first.data!.invoicesCreated, second.data!.invoicesCreated]).toEqual([1, 0]);
  // October (due Oct 21, grace 3) is 10 days late → 10% of 15,967.74 = 1,596.77, charged once.
  expect([first.data!.lateFeesCreated, second.data!.lateFeesCreated]).toEqual([1, 0]);

  // Nov 9: November rent is 4 days late (grace 3) → 10% late fee on 45,000 = 4,500.
  clock.set('2026-11-09');
  const late = await me.POST('/v1/billing/run');
  expect(late.data!.lateFeesCreated).toBe(1);

  const arrears = await me.GET('/v1/arrears');
  expect(arrears.data!.items).toHaveLength(1);
  // deposit 45,000 + Oct 15,967.74 + Nov 45,000 + late fees 1,596.77 + 4,500 = 112,064.51
  expect(arrears.data!.totals.total).toBe(11_206_451);
  expect(arrears.data!.totals.current).toBe(450_000); // Nov late fee, due today

  const invoices = await me.GET('/v1/invoices', {
    params: { query: { leaseId: lease.data!.id, limit: 50 } },
  });
  const periods = invoices.data!.items.filter((i) => i.kind === 'periodic').map((i) => i.period);
  expect(periods).toEqual(['2026-11', '2026-10']);

  const statement = await me.GET('/v1/leases/{id}/statement', {
    params: { path: { id: lease.data!.id } },
  });
  expect(statement.data!.closingBalanceCents).toBe(arrears.data!.totals.total);

  // DoD: the org's ledger balances to zero.
  const { rows } = await j.api.deps.db.pools.owner.query(
    'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
    [org.data!.id],
  );
  expect(rows[0].t).toBe('0');
});
