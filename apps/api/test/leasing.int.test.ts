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

async function setup(opts: { unitCode?: string } = {}) {
  const o = await ownerWithOrg(api);
  const c = client(api, o.token);
  const prop = (await c.post('/v1/properties', { name: 'Riverside', county: 'Nairobi' })).json();
  const unit = (
    await c.post(`/v1/properties/${prop.id}/units`, {
      code: opts.unitCode ?? 'A1',
      mode: 'long_term',
      rentCents: 3_000_000,
    })
  ).json();
  const tenant = (
    await c.post('/v1/tenants', {
      fullName: 'Jane Wanjiru',
      phone: '0712 000 111',
      nationalId: '12345678',
    })
  ).json();
  return { o, c, prop, unit, tenant };
}

const trialBalance = async (orgId: string) =>
  (
    await api.deps.db.pools.owner.query(
      'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
      [orgId],
    )
  ).rows[0].t;

const invoices = async (c: C, leaseId: string) =>
  (await c.get(`/v1/invoices?leaseId=${leaseId}&limit=100`)).json().items as {
    id: string;
    number: string;
    kind: string;
    period: string | null;
    dueOn: string;
    totalCents: number;
    outstandingCents: number;
    paymentStatus: string;
  }[];

describe('tenants', () => {
  it('creates, validates and searches tenants', async () => {
    const { c } = await setup();
    expect((await c.post('/v1/tenants', { fullName: '   ' })).statusCode).toBe(400);
    expect(
      (await c.post('/v1/tenants', { fullName: 'X', nationalId: 'no spaces!' })).statusCode,
    ).toBe(400);
    const t = (
      await c.post('/v1/tenants', {
        fullName: 'Otieno Brian',
        kraPin: 'a000000000b',
        nextOfKinPhone: '0722000000',
      })
    ).json();
    expect(t).toMatchObject({
      kraPin: 'A000000000B',
      nextOfKinPhone: '+254722000000',
      activeLeaseCount: 0,
      balanceCents: 0,
    });
    const found = (await c.get('/v1/tenants?q=otieno')).json().items;
    expect(found.map((x: { fullName: string }) => x.fullName)).toEqual(['Otieno Brian']);
  });
});

describe('lease lifecycle and billing (hand-computed fixture)', () => {
  it('bills deposit + prorated rent, runs idempotently, charges late fees and ages arrears', async () => {
    clock.set('2026-10-21');
    const { o, c, unit, tenant } = await setup();
    const created = await c.post('/v1/leases', {
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: '2026-10-21',
      rentCents: 3_000_000,
      depositCents: 3_000_000,
      billingDay: 1,
      lateFeeKind: 'flat',
      lateFeeFlatCents: 100_000,
      lateFeeGraceDays: 5,
    });
    expect(created.statusCode, created.body).toBe(201);
    const lease = created.json();
    expect(lease).toMatchObject({
      balanceCents: 4_064_516,
      depositHeldCents: 3_000_000,
      currentRentCents: 3_000_000,
      unitCode: 'A1',
      tenantName: 'Jane Wanjiru',
    });

    let list = await invoices(c, lease.id);
    expect(list.map((i) => [i.kind, i.period, i.totalCents, i.dueOn])).toEqual([
      ['periodic', '2026-10', 1_064_516, '2026-10-21'],
      ['deposit', null, 3_000_000, '2026-10-21'],
    ]);
    const detail = (await c.get(`/v1/invoices/${list[0]!.id}`)).json();
    expect(detail.lines).toEqual([
      expect.objectContaining({
        kind: 'rent',
        description: 'Rent Oct 2026 (11 of 31 days)',
        amountCents: 1_064_516,
      }),
    ]);

    // Nov invoice is issued 5 days before Nov 1; running twice must not duplicate it.
    clock.set('2026-10-27');
    const run1 = (await c.post('/v1/billing/run')).json();
    const run2 = (await c.post('/v1/billing/run')).json();
    expect(run1.invoicesCreated).toBe(1);
    expect(run2.invoicesCreated).toBe(0);
    // October (due Oct 21) is now 6 days late, past the 5-day grace → its late fee today, once.
    expect([run1.lateFeesCreated, run2.lateFeesCreated]).toEqual([1, 0]);
    list = await invoices(c, lease.id);
    expect(list.filter((i) => i.kind === 'periodic').map((i) => i.period)).toEqual([
      '2026-11',
      '2026-10',
    ]);

    // Nov 7: November (due Nov 1) is past grace → its late fee; October's is not charged twice.
    clock.set('2026-11-07');
    expect((await c.post('/v1/billing/run')).json().lateFeesCreated).toBe(1);
    expect((await c.post('/v1/billing/run')).json().lateFeesCreated).toBe(0);
    expect((await c.get(`/v1/leases/${lease.id}`)).json().balanceCents).toBe(7_264_516);

    // A credit of 40,645.16 clears the two oldest invoices (deposit INV-1, Oct INV-2) first.
    const credit = await c.post(`/v1/leases/${lease.id}/credit-notes`, {
      amountCents: 4_064_516,
      reason: 'Goodwill',
    });
    expect(credit.statusCode, credit.body).toBe(201);
    list = await invoices(c, lease.id);
    const byKind = (k: string, p?: string) =>
      list.find((i) => i.kind === k && (p === undefined || i.period === p))!;
    expect(byKind('deposit').paymentStatus).toBe('paid');
    expect(byKind('periodic', '2026-10').paymentStatus).toBe('paid');
    expect(byKind('periodic', '2026-11')).toMatchObject({
      outstandingCents: 3_000_000,
      paymentStatus: 'unpaid',
    });

    const arrears = (await c.get('/v1/arrears')).json();
    // Left: Oct late fee (due Oct 27) + Nov rent (due Nov 1) → 1–30 days; Nov late fee (due today) → current.
    expect(arrears.totals).toEqual({
      current: 100_000,
      d1_30: 3_100_000,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
      total: 3_200_000,
    });
    expect(arrears.items).toEqual([
      expect.objectContaining({ leaseId: lease.id, oldestDueOn: '2026-10-27', unitCode: 'A1' }),
    ]);

    const statement = (await c.get(`/v1/leases/${lease.id}/statement`)).json();
    expect(statement.openingBalanceCents).toBe(0);
    expect(statement.closingBalanceCents).toBe(3_200_000);
    expect(statement.items.at(-1)).toMatchObject({
      source: 'credit_note',
      creditCents: 4_064_516,
      balanceCents: 3_200_000,
    });

    expect(await trialBalance(o.org.id)).toBe('0');

    // Reminders: Nov invoice is 6 days overdue → no stage today; on Nov 8 (7 days) one SMS, deduped.
    clock.set('2026-11-08');
    expect((await c.post('/v1/billing/run')).json().remindersQueued).toBeGreaterThanOrEqual(1);
    await c.post('/v1/billing/run');
    const { rows } = await api.deps.db.pools.owner.query(
      "SELECT payload FROM outbox WHERE org_id = $1 AND topic = 'notifications.sms' AND dedupe_key LIKE 'reminder:%overdue_7'",
      [o.org.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].payload).toMatchObject({
      to: '+254712000111',
      message: expect.stringContaining('account number A1'),
    });
  });

  it('refuses overlapping leases at the database and leases on short-stay units', async () => {
    clock.set('2026-10-21');
    const { c, prop, unit, tenant } = await setup();
    const base = { unitId: unit.id, tenantId: tenant.id, rentCents: 1_000_000 };
    expect(
      (await c.post('/v1/leases', { ...base, startDate: '2026-11-01', endDate: '2027-10-31' }))
        .statusCode,
    ).toBe(201);
    const overlap = await c.post('/v1/leases', { ...base, startDate: '2027-10-31' });
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().code).toBe('lease_overlap');
    expect((await c.post('/v1/leases', { ...base, startDate: '2027-11-01' })).statusCode).toBe(201);

    const bnb = (
      await c.post(`/v1/properties/${prop.id}/units`, {
        code: 'BNB1',
        mode: 'short_stay',
        baseNightlyCents: 500_000,
      })
    ).json();
    const wrong = await c.post('/v1/leases', { ...base, unitId: bnb.id, startDate: '2026-11-01' });
    expect(wrong.json().code).toBe('unit_not_long_term');
    expect(
      (await c.post('/v1/leases', { ...base, startDate: '2028-01-01', lateFeeKind: 'flat' })).json()
        .code,
    ).toBe('invalid_lease_terms');
  });

  it('escalates rent and honours rent changes from un-invoiced months', async () => {
    clock.set('2026-01-01');
    const { c, unit, tenant } = await setup();
    const lease = (
      await c.post('/v1/leases', {
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: '2026-01-01',
        rentCents: 2_000_000,
        escalationBps: 500,
        escalationEveryMonths: 12,
      })
    ).json();
    expect(lease.nextEscalationPeriod).toBe('2027-01');
    const early = await c.post(`/v1/leases/${lease.id}/rent-change`, {
      effectivePeriod: '2026-01',
      rentCents: 1,
    });
    expect(early.json().code).toBe('period_already_invoiced');

    clock.set('2027-01-15');
    await c.post('/v1/billing/run');
    const jan27 = (await invoices(c, lease.id)).find((i) => i.period === '2027-01')!;
    expect(jan27.totalCents).toBe(2_100_000);

    const changeRes = await c.post(`/v1/leases/${lease.id}/rent-change`, {
      effectivePeriod: '2027-03',
      rentCents: 2_500_000,
    });
    expect(changeRes.statusCode, changeRes.body).toBe(200);
    const changed = changeRes.json();
    expect(changed.rentSteps).toEqual([{ effectivePeriod: '2027-03', rentCents: 2_500_000 }]);
    clock.set('2027-03-01');
    await c.post('/v1/billing/run');
    expect((await invoices(c, lease.id)).find((i) => i.period === '2027-03')!.totalCents).toBe(
      2_500_000,
    );

    // The March 2027 step restarts the 12-month cycle → next escalation March 2028 (not Jan 2028).
    const cal = (await c.get('/v1/lease-calendar?from=2027-02-01&to=2028-03-01')).json();
    expect(
      cal.items.map((e: { kind: string; date: string; rentCents: number }) => [
        e.kind,
        e.date,
        e.rentCents,
      ]),
    ).toEqual([['escalation', '2028-03-01', 2_625_000]]);
  });
});

describe('metered and flat charges', () => {
  it('bills water in arrears from readings and prorates flat charges', async () => {
    clock.set('2026-10-01');
    const { o, c, unit, tenant } = await setup();
    const meters = (
      await c.post(`/v1/units/${unit.id}/meters`, {
        kind: 'water',
        initialReading: { readOn: '2026-09-30', reading: '100' },
      })
    ).json();
    const meterId = meters.items[0].id;
    const lease = (
      await c.post('/v1/leases', {
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: '2026-10-01',
        rentCents: 2_000_000,
        charges: [
          { kind: 'garbage', method: 'flat', amountCents: 50_000 },
          { kind: 'water', method: 'metered', unitPriceCents: 15_000, meterId },
        ],
      })
    ).json();
    expect(lease.charges).toHaveLength(2);

    // Readings can't go backwards; one per day.
    expect(
      (
        await c.post(`/v1/meters/${meterId}/readings`, { readOn: '2026-10-31', reading: '99' })
      ).json().code,
    ).toBe('reading_decreased');
    expect(
      (await c.post(`/v1/meters/${meterId}/readings`, { readOn: '2026-10-31', reading: '112.5' }))
        .statusCode,
    ).toBe(201);
    expect(
      (
        await c.post(`/v1/meters/${meterId}/readings`, { readOn: '2026-10-31', reading: '113' })
      ).json().code,
    ).toBe('reading_exists');

    clock.set('2026-10-27');
    await c.post('/v1/billing/run');
    const nov = (await invoices(c, lease.id)).find((i) => i.period === '2026-11')!;
    const lines = (await c.get(`/v1/invoices/${nov.id}`)).json().lines;
    expect(
      lines.map((l: { kind: string; amountCents: number; quantity: string }) => [
        l.kind,
        l.amountCents,
        l.quantity,
      ]),
    ).toEqual([
      ['rent', 2_000_000, '1'],
      ['garbage', 50_000, '1'],
      ['water', 187_500, '12.5'], // 12.5 m³ × KES 150
    ]);
    expect(await trialBalance(o.org.id)).toBe('0');
  });
});

describe('voids, termination and deposits', () => {
  it('voids only untouched invoices, terminates with proration and settles the deposit', async () => {
    clock.set('2026-10-01');
    const { o, c, unit, tenant } = await setup();
    const lease = (
      await c.post('/v1/leases', {
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: '2026-10-01',
        rentCents: 3_100_000,
        depositCents: 3_100_000,
      })
    ).json();
    clock.set('2026-10-27');
    await c.post('/v1/billing/run'); // Nov invoiced in advance
    let list = await invoices(c, lease.id);
    const oct = list.find((i) => i.period === '2026-10')!;

    // Deposit and October settled (credit stands in for payments until B3) → no longer voidable.
    await c.post(`/v1/leases/${lease.id}/credit-notes`, {
      amountCents: 6_200_000,
      reason: 'Paid in cash (pre-B3)',
    });
    const deposit = list.find((i) => i.kind === 'deposit')!;
    expect((await c.post(`/v1/invoices/${deposit.id}/void`, { reason: 'x' })).json().code).toBe(
      'invoice_has_credits',
    );

    // Terminate mid-November: Nov is credited down to 15/30 days; deposit settles against arrears.
    clock.set('2026-11-15');
    const ended = await c.post(`/v1/leases/${lease.id}/terminate`, {
      endDate: '2026-11-15',
      reason: 'Relocating',
    });
    expect(ended.statusCode, ended.body).toBe(200);
    expect(ended.json().status).toBe('terminated');
    list = await invoices(c, lease.id);
    expect(list.map((i) => i.period).filter(Boolean)).toEqual(['2026-11', '2026-10']);
    // Owed: deposit + Oct (settled) + Nov prorated to 15/30 days = 1,550,000 outstanding.
    expect((await c.get(`/v1/leases/${lease.id}`)).json().balanceCents).toBe(1_550_000);
    expect(oct.totalCents).toBe(3_100_000);

    const settled = await c.post(`/v1/leases/${lease.id}/deposit-settlement`, {
      deductions: [{ description: 'Broken window', amountCents: 500_000 }],
    });
    expect(settled.statusCode, settled.body).toBe(201);
    expect(settled.json()).toMatchObject({
      depositHeldCents: 3_100_000,
      deductionsCents: 500_000,
      appliedToArrearsCents: 1_550_000,
      refundDueCents: 1_050_000,
    });
    expect((await c.post(`/v1/leases/${lease.id}/deposit-settlement`, {})).json().code).toBe(
      'deposit_already_settled',
    );
    const after = (await c.get(`/v1/leases/${lease.id}`)).json();
    expect(after).toMatchObject({ balanceCents: 0, depositHeldCents: 0 });
    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it('cancels a mistaken lease and frees the unit', async () => {
    clock.set('2026-10-01');
    const { c, unit, tenant } = await setup();
    const lease = (
      await c.post('/v1/leases', {
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: '2026-10-01',
        rentCents: 100,
      })
    ).json();
    const cancelled = (
      await c.post(`/v1/leases/${lease.id}/cancel`, { reason: 'Wrong unit' })
    ).json();
    expect(cancelled).toMatchObject({ status: 'cancelled', balanceCents: 0 });
    expect(
      (
        await c.post('/v1/leases', {
          unitId: unit.id,
          tenantId: tenant.id,
          startDate: '2026-10-01',
          rentCents: 100,
        })
      ).statusCode,
    ).toBe(201);
  });
});

describe('roles', () => {
  it('caretakers record readings on assigned properties but cannot see leases', async () => {
    clock.set('2026-10-01');
    const { o, c, prop, unit } = await setup();
    const meter = (await c.post(`/v1/units/${unit.id}/meters`, { kind: 'electricity' })).json()
      .items[0];
    const caretaker = await addPhoneMember(api, o, 'caretaker');
    const care = client(api, caretaker.token);
    expect(
      (await care.post(`/v1/meters/${meter.id}/readings`, { readOn: '2026-10-01', reading: '5' }))
        .statusCode,
    ).toBe(404);
    await c.put(`/v1/properties/${prop.id}/staff`, { userIds: [caretaker.userId] });
    const bulk = await care.post('/v1/meter-readings/bulk', {
      items: [
        { meterId: meter.id, readOn: '2026-10-01', reading: '5' },
        { meterId: meter.id, readOn: '2026-10-02', reading: '4' },
      ],
    });
    expect(
      bulk
        .json()
        .items.map((i: { status: string; errorCode: string | null }) => [i.status, i.errorCode]),
    ).toEqual([
      ['applied', null],
      ['rejected', 'reading_decreased'],
    ]);
    expect((await care.get('/v1/leases')).statusCode).toBe(403);
    expect((await care.get('/v1/tenants')).statusCode).toBe(403);
  });
});
