import { randomUUID } from 'node:crypto';
import { uuidv7 } from '@kejasha/core';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testClock } from '../helpers';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B6a): a caretaker's offline shift — the app pulls a snapshot, records a meter round and
 * a repair with no signal, then pushes the batch twice (flaky network): everything applies once.
 * A note on a ticket the office closed meanwhile is rejected and shown to the caretaker. The
 * tenant then signs in by phone, sees the bill and pays by STK.
 */
const clock = testClock('2026-10-21');
let j: Journey;
beforeAll(async () => {
  j = await startJourney({ clock });
});
afterAll(() => j.close());

async function otpSession(phone: string) {
  await j.client.POST('/v1/identity/otp/request', { body: { phone } });
  const code = /(\d{6})/.exec(j.lastSms(`+254${phone.slice(1)}`) ?? '')![1]!;
  const v = await j.client.POST('/v1/identity/otp/verify', { body: { phone, code } });
  return { api: j.as(v.data!.token), userId: v.data!.user.id };
}

it('offline caretaker shift syncs once; tenant pays from the portal', async () => {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Owner',
      email: `o-${randomUUID().slice(0, 6)}@example.test`,
      password: 'a-strong-password',
    },
  });
  const owner = j.as(s.data!.token);
  await owner.POST('/v1/orgs', {
    body: { name: 'Lakeview Homes', kind: 'landlord', county: 'Kisumu' },
  });
  const prop = await owner.POST('/v1/properties', { body: { name: 'Lakeview', county: 'Kisumu' } });
  await owner.POST('/v1/properties/{propertyId}/units/bulk', {
    params: { path: { propertyId: prop.data!.id } },
    body: { prefix: 'L', start: 1, count: 10, padding: 2, mode: 'long_term', rentCents: 1_200_000 },
  });
  const units = (
    await owner.GET('/v1/units', { params: { query: { propertyId: prop.data!.id, limit: 25 } } })
  ).data!.items;
  for (const u of units)
    await owner.POST('/v1/units/{unitId}/meters', {
      params: { path: { unitId: u.id } },
      body: { kind: 'water' },
    });
  await owner.PUT('/v1/payment-channels/{id}/credentials', {
    params: {
      path: {
        id: (
          await owner.POST('/v1/payment-channels', {
            body: { kind: 'paybill', shortcode: '880011', displayName: 'Lakeview' },
          })
        ).data!.id,
      },
    },
    body: { consumerKey: 'k', consumerSecret: 's', passkey: 'p' },
  });
  const tenantPhone = `07${String(Date.now()).slice(-8)}`;
  const tenant = await owner.POST('/v1/tenants', {
    body: { fullName: 'Akinyi', phone: tenantPhone },
  });
  const lease = await owner.POST('/v1/leases', {
    body: {
      unitId: units[0]!.id,
      tenantId: tenant.data!.id,
      startDate: '2026-10-01',
      rentCents: 1_200_000,
    },
  });

  // Caretaker joins by phone and is assigned to Lakeview.
  const carePhone = `07${String(Date.now() + 7).slice(-8)}`;
  await owner.POST('/v1/invitations', { body: { phone: carePhone, role: 'caretaker' } });
  const care = await otpSession(carePhone);
  const inv = await care.api.GET('/v1/identity/me/invitations');
  await care.api.POST('/v1/invitations/{id}/accept', {
    params: { path: { id: inv.data!.items[0]!.id } },
  });
  await owner.PUT('/v1/properties/{id}/staff', {
    params: { path: { id: prop.data!.id } },
    body: { userIds: [care.userId] },
  });

  // Snapshot for the device.
  const snap = await care.api.GET('/v1/sync/pull');
  expect(snap.data!.reset).toBe(true);
  expect(snap.data!.changes.meters.upserted).toHaveLength(10);
  expect(snap.data!.changes.tenants.upserted).toEqual([]);

  // Offline: a reading per meter plus a repair with a note.
  const ticketId = uuidv7();
  const batch = {
    meterReadings: snap.data!.changes.meters.upserted.map((m) => ({
      id: uuidv7(),
      meterId: m.id,
      readOn: '2026-10-21',
      reading: '42.5',
    })),
    tickets: [
      {
        id: ticketId,
        unitId: units[3]!.id,
        title: 'Broken window',
        category: 'structural' as const,
      },
    ],
    ticketUpdates: [{ id: uuidv7(), ticketId, note: 'Glass ordered' }],
  };
  const first = await care.api.POST('/v1/sync/push', { body: batch });
  const second = await care.api.POST('/v1/sync/push', { body: batch });
  expect(first.data!.results.every((r) => r.status === 'applied')).toBe(true);
  expect(second.data!.results.every((r) => r.status === 'duplicate')).toBe(true);
  expect(first.data!.results).toHaveLength(12);

  // The office closes the ticket; a late offline note is rejected.
  await owner.POST('/v1/tickets/{id}/updates', {
    params: { path: { id: ticketId } },
    body: { status: 'resolved' },
  });
  await owner.POST('/v1/tickets/{id}/updates', {
    params: { path: { id: ticketId } },
    body: { status: 'closed' },
  });
  const late = await care.api.POST('/v1/sync/push', {
    body: { ticketUpdates: [{ id: uuidv7(), ticketId, note: 'Fitted' }] },
  });
  expect(late.data!.results[0]).toMatchObject({ status: 'rejected', code: 'ticket_finished' });

  const next = await care.api.GET('/v1/sync/pull', {
    params: { query: { cursor: snap.data!.cursor } },
  });
  expect(next.data!.changes.meterReadings.upserted).toHaveLength(10);
  expect(next.data!.changes.tickets.deleted).toEqual([ticketId]); // closed → off the device

  // The tenant signs in by phone and pays.
  const t = await otpSession(tenantPhone);
  const me = await t.api.GET('/v1/portal/me');
  expect(me.data!.tenancies[0]).toMatchObject({ landlordName: 'Lakeview Homes' });
  expect(me.data!.tenancies[0]!.leases[0]).toMatchObject({
    unitCode: 'L01',
    balanceCents: 1_200_000,
  });
  const pay = await t.api.POST('/v1/portal/leases/{leaseId}/pay', {
    params: { path: { leaseId: lease.data!.id } },
    body: {},
  });
  expect(pay.data).toMatchObject({ amountCents: 1_200_000, accountRef: 'L01', status: 'pending' });
});
