import { afterAll, beforeAll, expect, it } from 'vitest';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B1): an owner invites a caretaker by SMS; the caretaker signs in with an OTP on the
 * Android app, accepts, and sees only the property they were assigned to.
 */
let j: Journey;
beforeAll(async () => {
  j = await startJourney();
});
afterAll(() => j.close());

it('caretaker: SMS invite → OTP sign-in → sees only the assigned property', async () => {
  const signUp = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Mwangi',
      email: `mwangi-${Date.now()}@example.test`,
      password: 'a-strong-password',
    },
  });
  const owner = j.as(signUp.data!.token);
  await owner.POST('/v1/orgs', {
    body: { name: 'Mwangi Rentals', kind: 'landlord', county: 'Nakuru' },
  });
  const blockA = await owner.POST('/v1/properties', {
    body: { name: 'Block A', county: 'Nakuru' },
  });
  await owner.POST('/v1/properties', { body: { name: 'Block B', county: 'Nakuru' } });
  await owner.POST('/v1/properties/{propertyId}/units/bulk', {
    params: { path: { propertyId: blockA.data!.id } },
    body: { prefix: 'A', start: 1, count: 3, mode: 'long_term', rentCents: 900_000 },
  });

  const phone = `07${String(Date.now()).slice(-8)}`;
  const e164 = `+254${phone.slice(1)}`;
  const invite = await owner.POST('/v1/invitations', { body: { phone, role: 'caretaker' } });
  expect(invite.data).toMatchObject({ phone: e164, email: null, role: 'caretaker' });

  // On the phone: request a code, read it from the SMS, verify.
  const otp = await j.client.POST('/v1/identity/otp/request', { body: { phone } });
  expect(otp.response.status).toBe(202);
  const code = /(\d{6})/.exec(j.lastSms(e164) ?? '')![1]!;
  const verified = await j.client.POST('/v1/identity/otp/verify', { body: { phone, code } });
  const caretaker = j.as(verified.data!.token);

  const pending = await caretaker.GET('/v1/identity/me/invitations');
  await caretaker.POST('/v1/invitations/{id}/accept', {
    params: { path: { id: pending.data!.items[0]!.id } },
  });

  const before = await caretaker.GET('/v1/properties');
  expect(before.data!.items).toEqual([]);

  await owner.PUT('/v1/properties/{id}/staff', {
    params: { path: { id: blockA.data!.id } },
    body: { userIds: [verified.data!.user.id] },
  });

  const after = await caretaker.GET('/v1/properties');
  expect(after.data!.items.map((p) => p.name)).toEqual(['Block A']);
  const units = await caretaker.GET('/v1/units');
  expect(units.data!.items.map((u) => u.code)).toEqual(['A1', 'A2', 'A3']);

  const write = await caretaker.POST('/v1/properties', {
    body: { name: 'Sneaky', county: 'Nakuru' },
  });
  expect(write.response.status).toBe(403);
  expect(write.error).toMatchObject({ code: 'insufficient_role' });
});
