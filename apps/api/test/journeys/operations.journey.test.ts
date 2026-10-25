import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testClock } from '../helpers';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B5): an agency manages Mama Njeri's block (8% fee). The caretaker logs a repair and
 * the cash a tenant handed over; the manager confirms the cash (only then does it reach the
 * ledger) and closes the repair (its cost lands in expenses). The month's MRI matches the hand
 * calculation, the owner statement reconciles to the ledger, and Mama Njeri — a read-only member
 * abroad — sees her statement but cannot change anything.
 */
const clock = testClock('2026-10-01');
let j: Journey;
beforeAll(async () => {
  j = await startJourney({ clock });
});
afterAll(() => j.close());

async function phoneMember(owner: ReturnType<Journey['as']>, role: 'caretaker' | 'viewer') {
  const phone = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const e164 = `+254${phone.slice(1)}`;
  await owner.POST('/v1/invitations', { body: { phone, role } });
  await j.client.POST('/v1/identity/otp/request', { body: { phone } });
  const code = /(\d{6})/.exec(j.lastSms(e164) ?? '')![1]!;
  const verified = await j.client.POST('/v1/identity/otp/verify', { body: { phone, code } });
  const me = j.as(verified.data!.token);
  const pending = await me.GET('/v1/identity/me/invitations');
  await me.POST('/v1/invitations/{id}/accept', {
    params: { path: { id: pending.data!.items[0]!.id } },
  });
  return { me, userId: verified.data!.user.id };
}

it('caretaker cash + repair → confirmed → MRI, statement and read-only owner', async () => {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Achieng',
      email: `achieng-${randomUUID().slice(0, 6)}@example.test`,
      password: 'a-strong-password',
    },
  });
  const mgr = j.as(s.data!.token);
  const org = await mgr.POST('/v1/orgs', {
    body: { name: 'Jirani Agency', kind: 'agency', county: 'Kisumu' },
  });
  const njeri = await mgr.POST('/v1/client-landlords', {
    body: { name: 'Mama Njeri', mgmtFeeKind: 'percent', mgmtFeeBps: 800 },
  });
  const block = await mgr.POST('/v1/properties', {
    body: { name: 'Milimani Flats', county: 'Kisumu', clientLandlordId: njeri.data!.id },
  });
  const unit = await mgr.POST('/v1/properties/{propertyId}/units', {
    params: { path: { propertyId: block.data!.id } },
    body: { code: 'M1', mode: 'long_term', rentCents: 1_500_000 },
  });
  const tenant = await mgr.POST('/v1/tenants', {
    body: { fullName: 'Otieno Ouma', kraPin: 'A009876543K' },
  });
  const lease = await mgr.POST('/v1/leases', {
    body: {
      unitId: unit.data!.id,
      tenantId: tenant.data!.id,
      startDate: '2026-10-01',
      rentCents: 1_500_000,
      charges: [{ kind: 'garbage', method: 'flat', amountCents: 50_000 }],
    },
  });
  expect(lease.response.status, JSON.stringify(lease.error)).toBe(201);

  const caretaker = await phoneMember(mgr, 'caretaker');
  await mgr.PUT('/v1/properties/{id}/staff', {
    params: { path: { id: block.data!.id } },
    body: { userIds: [caretaker.userId] },
  });

  // The caretaker reports a repair and logs KES 15,500 cash (rent + garbage) from the tenant.
  const ticket = await caretaker.me.POST('/v1/tickets', {
    body: { unitId: unit.data!.id, title: 'Burst pipe', category: 'plumbing', priority: 'urgent' },
  });
  clock.set('2026-10-06');
  const cash = await caretaker.me.POST('/v1/cash-collections', {
    body: {
      leaseId: lease.data!.id,
      amountCents: 1_550_000,
      receivedOn: '2026-10-06',
      note: 'Paid in cash',
    },
  });
  expect(cash.data).toMatchObject({ status: 'pending', unitCode: 'M1' });
  const before = await mgr.GET('/v1/owner-statements/{clientLandlordId}', {
    params: { path: { clientLandlordId: njeri.data!.id }, query: { period: '2026-10' } },
  });
  expect(before.data!.incomeCents).toBe(0); // not in the ledger until confirmed

  await mgr.POST('/v1/cash-collections/{id}/confirm', { params: { path: { id: cash.data!.id } } });
  await caretaker.me.POST('/v1/tickets/{id}/updates', {
    params: { path: { id: ticket.data!.id } },
    body: { status: 'resolved', costCents: 250_000, note: 'Pipe replaced' },
  });
  await mgr.POST('/v1/tickets/{id}/updates', {
    params: { path: { id: ticket.data!.id } },
    body: { status: 'closed' },
  });

  // MRI: KES 15,500 received, rent share 15,000 / 15,500 of it = 15,000 → 7.5% = 1,125.
  const mri = await mgr.GET('/v1/compliance/mri/{clientLandlordId}', {
    params: { path: { clientLandlordId: njeri.data!.id }, query: { period: '2026-10' } },
  });
  expect(mri.data).toMatchObject({ rentCents: 1_500_000, taxCents: 112_500, dueOn: '2026-11-20' });
  expect(mri.data!.lines[0]).toMatchObject({
    receivedCents: 1_550_000,
    tenantKraPin: 'A009876543K',
  });

  // Statement: 15,500 − 2,500 repair − 8% fee (1,240) = 11,760; income equals the ledger.
  const st = await mgr.GET('/v1/owner-statements/{clientLandlordId}', {
    params: { path: { clientLandlordId: njeri.data!.id }, query: { period: '2026-10' } },
  });
  expect(st.data).toMatchObject({
    incomeCents: 1_550_000,
    expensesCents: 250_000,
    managementFeeCents: 124_000,
    netCents: 1_176_000,
    managedBy: 'Jirani Agency',
  });
  const { rows } = await j.api.deps.db.pools.owner.query(
    `SELECT coalesce(sum(p.amount_cents),0)::int AS collected, (SELECT coalesce(sum(amount_cents),0)::int FROM ledger_posting WHERE org_id = $1) AS trial
       FROM ledger_posting p JOIN ledger_account a ON a.id = p.account_id AND a.kind = 'collections' WHERE p.org_id = $1`,
    [org.data!.id],
  );
  expect(rows[0]).toEqual({ collected: 1_550_000, trial: 0 });

  // Mama Njeri, abroad, gets a read-only login scoped to her record.
  const viewer = await phoneMember(mgr, 'viewer');
  const members = await mgr.GET('/v1/members');
  const vm = members.data!.items.find((m) => m.userId === viewer.userId)!;
  await mgr.PUT('/v1/members/{id}/scope', {
    params: { path: { id: vm.id } },
    body: { clientLandlordId: njeri.data!.id },
  });
  const dash = await viewer.me.GET('/v1/reports/owner-dashboard', {
    params: { query: { period: '2026-10' } },
  });
  expect(dash.data).toMatchObject({
    landlordName: 'Mama Njeri',
    netCents: 1_176_000,
    longTermOccupancyBps: 10_000,
  });
  const pdf = await viewer.me.GET('/v1/owner-statements/{clientLandlordId}/pdf', {
    params: { path: { clientLandlordId: njeri.data!.id }, query: { period: '2026-10' } },
    parseAs: 'arrayBuffer',
  });
  expect(
    Buffer.from(pdf.data as ArrayBuffer)
      .subarray(0, 4)
      .toString(),
  ).toBe('%PDF');
  const write = await viewer.me.POST('/v1/tickets', {
    body: { unitId: unit.data!.id, title: 'x', category: 'other' },
  });
  expect(write.response.status).toBe(403);
  expect(write.error).toMatchObject({ code: 'viewer_read_only' });
});
