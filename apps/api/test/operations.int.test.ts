import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPhoneMember, client, ownerWithOrg } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-21');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
});
afterAll(() => api.close());

/** Org with two properties (caretaker assigned to the first), a let unit A1 and a short-stay unit. */
async function setup() {
  clock.set('2026-10-21');
  const o = await ownerWithOrg(api);
  const c = client(api, o.token);
  const prop = (await c.post('/v1/properties', { name: 'Riverside', county: 'Nairobi' })).json();
  const other = (await c.post('/v1/properties', { name: 'Hillview', county: 'Nairobi' })).json();
  const unit = (
    await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'A1',
      mode: 'long_term',
      rentCents: 2_000_000,
    })
  ).json();
  const ss = (
    await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'S1',
      mode: 'short_stay',
      baseNightlyCents: 500_000,
    })
  ).json();
  const otherUnit = (
    await c.post(`/v1/properties/${other.id}/units`, {
      code: 'H1',
      mode: 'long_term',
      rentCents: 1_000_000,
    })
  ).json();
  const tenant = (
    await c.post('/v1/tenants', { fullName: 'Jane Wanjiru', phone: '0712000111' })
  ).json();
  const lease = (
    await c.post('/v1/leases', {
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: '2026-10-01',
      rentCents: 2_000_000,
    })
  ).json();
  const caretaker = await addPhoneMember(api, o, 'caretaker');
  await c.put(`/v1/properties/${prop.id}/staff`, { userIds: [caretaker.userId] });
  return {
    o,
    c,
    care: client(api, caretaker.token),
    caretaker,
    prop,
    other,
    unit,
    ss,
    otherUnit,
    tenant,
    lease,
  };
}

const trialBalance = async (orgId: string) =>
  (
    await api.deps.db.pools.owner.query(
      'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
      [orgId],
    )
  ).rows[0].t;

async function upload(c: ReturnType<typeof client>, purpose: string) {
  const res = await c.post('/v1/uploads', { purpose, contentType: 'image/jpeg', sizeBytes: 1000 });
  expect(res.statusCode, res.body).toBe(201);
  return res.json().key as string;
}

describe('maintenance', () => {
  it('caretaker reports with photos on assigned properties only; cost on resolve becomes one expense', async () => {
    const { c, care, prop, other, unit, otherUnit } = await setup();
    const photo = await upload(care, 'maintenance_photo');
    const created = await care.post('/v1/tickets', {
      unitId: unit.id,
      title: 'Kitchen sink leaking',
      category: 'plumbing',
      priority: 'high',
      photoKeys: [photo],
    });
    expect(created.statusCode, created.body).toBe(201);
    const t = created.json();
    expect(t).toMatchObject({
      number: 'MT-000001',
      reporterKind: 'caretaker',
      propertyId: prop.id,
      unitCode: 'A1',
      status: 'open',
    });
    expect(t.updates[0].photos[0]).toMatchObject({ key: photo });
    expect(t.updates[0].photos[0].url).toContain('X-Amz-Signature');

    // Not assigned to Hillview: cannot report there or see its tickets.
    expect(
      (await care.post('/v1/tickets', { unitId: otherUnit.id, title: 'x', category: 'other' }))
        .statusCode,
    ).toBe(404);
    const hill = (
      await c.post('/v1/tickets', {
        propertyId: other.id,
        title: 'Gate motor',
        category: 'security',
      })
    ).json();
    expect((await care.get(`/v1/tickets/${hill.id}`)).statusCode).toBe(404);
    expect((await care.get('/v1/tickets')).json().items.map((x: { id: string }) => x.id)).toEqual([
      t.id,
    ]);
    // Someone else's upload key is refused.
    expect(
      (
        await care.post('/v1/tickets', {
          unitId: unit.id,
          title: 'x',
          category: 'other',
          photoKeys: ['org/other/maintenance_photo/x.jpg'],
        })
      ).json().code,
    ).toBe('invalid_upload_key');

    // Caretaker works it and resolves with the cost; cannot close or edit fields.
    expect(
      (
        await care.post(`/v1/tickets/${t.id}/updates`, {
          status: 'in_progress',
          note: 'Fundi called',
        })
      ).statusCode,
    ).toBe(201);
    expect((await care.patch(`/v1/tickets/${t.id}`, { priority: 'low' })).statusCode).toBe(403);
    const resolved = (
      await care.post(`/v1/tickets/${t.id}/updates`, { status: 'resolved', costCents: 350_000 })
    ).json();
    expect(resolved).toMatchObject({ status: 'resolved', costCents: 350_000 });
    expect(resolved.expenseId).toBeTruthy();
    expect((await care.post(`/v1/tickets/${t.id}/updates`, { status: 'closed' })).statusCode).toBe(
      403,
    );

    const expenses = (
      await c.get(`/v1/unit-expenses?propertyId=${prop.id}&from=2026-10-01&to=2026-10-31`)
    ).json().items;
    expect(expenses).toEqual([
      expect.objectContaining({
        unitId: unit.id,
        category: 'repair',
        amountCents: 350_000,
        maintenanceTicketId: t.id,
      }),
    ]);
    expect((await c.delete(`/v1/unit-expenses/${expenses[0].id}`)).json().code).toBe(
      'managed_by_ticket',
    );

    // Cost corrected by the manager → same single expense, new amount; reopen removes it.
    await c.patch(`/v1/tickets/${t.id}`, { costCents: 400_000 });
    const after = (
      await c.get(`/v1/unit-expenses?propertyId=${prop.id}&from=2026-10-01&to=2026-10-31`)
    ).json().items;
    expect(after.map((e: { amountCents: number }) => e.amountCents)).toEqual([400_000]);
    const reopened = (
      await c.post(`/v1/tickets/${t.id}/updates`, { status: 'in_progress', note: 'Still dripping' })
    ).json();
    expect(reopened.expenseId).toBeNull();
    await c.post(`/v1/tickets/${t.id}/updates`, { status: 'resolved' });
    const closed = (await c.post(`/v1/tickets/${t.id}/updates`, { status: 'closed' })).json();
    expect(closed).toMatchObject({ status: 'closed', costCents: 400_000 });
    expect(closed.expenseId).toBeTruthy();
    expect(closed.updates.map((u: { statusTo: string | null }) => u.statusTo)).toEqual([
      'open',
      'in_progress',
      'resolved',
      'in_progress',
      'resolved',
      'closed',
    ]);
    expect((await c.post(`/v1/tickets/${t.id}/updates`, { note: 'late note' })).json().code).toBe(
      'ticket_finished',
    );
    expect((await c.post(`/v1/tickets/${hill.id}/updates`, { status: 'closed' })).json().code).toBe(
      'invalid_ticket_transition',
    );
  });

  it('a property-wide repair counts for the property; a resolved short-stay repair reaches the P&L', async () => {
    const { c, prop, ss } = await setup();
    const gate = (
      await c.post('/v1/tickets', {
        propertyId: prop.id,
        title: 'Gate hinge',
        category: 'security',
      })
    ).json();
    expect(gate.unitId).toBeNull();
    await c.post(`/v1/tickets/${gate.id}/updates`, { status: 'resolved', costCents: 150_000 });
    const tv = (
      await c.post('/v1/tickets', { unitId: ss.id, title: 'TV remote', category: 'appliance' })
    ).json();
    await c.post(`/v1/tickets/${tv.id}/updates`, { status: 'resolved', costCents: 80_000 });
    const pl = (await c.get('/v1/reports/short-stay?period=2026-10')).json();
    expect(pl.units[0]).toMatchObject({ unitCode: 'S1', expensesCents: 80_000 });
    const all = (
      await c.get(`/v1/unit-expenses?propertyId=${prop.id}&from=2026-10-01&to=2026-10-31`)
    ).json().items;
    expect(all.map((e: { amountCents: number }) => e.amountCents).sort()).toEqual([
      150_000, 80_000,
    ]);
    // The assignee must be a member.
    expect(
      (
        await c.patch(`/v1/tickets/${tv.id}`, {
          assigneeUserId: '00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(422);
  });
});

describe('cash collections', () => {
  it('reaches the ledger only on confirmation; caretakers see their own; reject books nothing', async () => {
    const { o, c, care, lease, otherUnit } = await setup();
    const receipt = await upload(care, 'cash_receipt');
    const sub = await care.post('/v1/cash-collections', {
      leaseId: lease.id,
      amountCents: 1_500_000,
      receivedOn: '2026-10-20',
      note: 'Paid at the gate',
      receiptKey: receipt,
    });
    expect(sub.statusCode, sub.body).toBe(201);
    const cash = sub.json();
    expect(cash).toMatchObject({
      status: 'pending',
      unitCode: 'A1',
      payerName: 'Jane Wanjiru',
      paymentId: null,
    });
    expect(cash.receipt.key).toBe(receipt);
    const balanceBefore = (await c.get(`/v1/leases/${lease.id}`)).json().balanceCents;
    const { rows } = await api.deps.db.pools.owner.query(
      `SELECT count(*)::int AS n FROM ledger_entry WHERE org_id = $1 AND source = 'payment'`,
      [o.org.id],
    );
    expect(rows[0].n).toBe(0);

    // Caretakers cannot confirm, nor log cash for leases on unassigned properties, nor future dates.
    expect((await care.post(`/v1/cash-collections/${cash.id}/confirm`)).statusCode).toBe(403);
    expect(
      (
        await care.post('/v1/cash-collections', {
          leaseId: lease.id,
          amountCents: 100,
          receivedOn: '2026-10-22',
        })
      ).json().code,
    ).toBe('future_date');
    expect(
      (
        await care.post('/v1/cash-collections', { amountCents: 100, receivedOn: '2026-10-20' })
      ).json().code,
    ).toBe('target_required');

    const confirmed = await c.post(`/v1/cash-collections/${cash.id}/confirm`);
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json()).toMatchObject({ status: 'confirmed' });
    const payment = (await c.get(`/v1/payments/${confirmed.json().paymentId}`)).json();
    expect(payment).toMatchObject({
      method: 'cash',
      source: 'manual',
      matchStatus: 'matched',
      leaseId: lease.id,
      amountCents: 1_500_000,
    });
    expect(payment.receiptNumber).toMatch(/^RCT-/);
    expect((await c.get(`/v1/leases/${lease.id}`)).json().balanceCents).toBe(
      balanceBefore - 1_500_000,
    );
    expect((await c.post(`/v1/cash-collections/${cash.id}/confirm`)).json().code).toBe(
      'cash_already_decided',
    );

    const second = (
      await care.post('/v1/cash-collections', {
        leaseId: lease.id,
        amountCents: 50_000,
        receivedOn: '2026-10-21',
      })
    ).json();
    const rejected = (
      await c.post(`/v1/cash-collections/${second.id}/reject`, { reason: 'Not received' })
    ).json();
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectReason: 'Not received',
      paymentId: null,
    });
    expect((await c.get('/v1/cash-collections?status=pending')).json().items).toHaveLength(0);
    expect(await trialBalance(o.org.id)).toBe('0');

    // A second caretaker sees none of these.
    const other = client(api, (await addPhoneMember(api, o, 'caretaker')).token);
    expect((await other.get('/v1/cash-collections')).json().items).toHaveLength(0);
    expect((await other.get(`/v1/cash-collections/${cash.id}`)).statusCode).toBe(404);
    expect(otherUnit.id).toBeTruthy();
  });

  it('cash for a short-stay booking settles the booking', async () => {
    const { c, care, ss } = await setup();
    const b = (
      await c.post('/v1/bookings', {
        unitId: ss.id,
        checkIn: '2026-10-24',
        checkOut: '2026-10-26',
        source: 'walk_in',
        grossCents: 1_000_000,
      })
    ).json();
    const cash = (
      await care.post('/v1/cash-collections', {
        bookingId: b.id,
        amountCents: 1_000_000,
        receivedOn: '2026-10-21',
      })
    ).json();
    await c.post(`/v1/cash-collections/${cash.id}/confirm`);
    expect((await c.get(`/v1/bookings/${b.id}`)).json()).toMatchObject({
      paidCents: 1_000_000,
      balanceCents: 0,
    });
  });
});
