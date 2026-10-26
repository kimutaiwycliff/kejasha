import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B1): an agency owner invites a manager by email; the manager joins and onboards two
 * client landlords (with management fees), each with a property.
 */
let j: Journey;
beforeAll(async () => {
  j = await startJourney();
});
afterAll(() => j.close());

const email = (tag: string) => `${tag}-${randomUUID().slice(0, 6)}@example.test`;

it('agency: invite manager → two client landlords with portfolios', async () => {
  const ownerSignUp = await j.client.POST('/v1/identity/sign-up/email', {
    body: { name: 'Achieng', email: email('owner'), password: 'a-strong-password' },
  });
  const owner = j.as(ownerSignUp.data!.token);
  await owner.POST('/v1/orgs', {
    body: { name: 'Lakeside Agency', kind: 'agency', county: 'Kisumu' },
  });

  const managerEmail = email('manager');
  const invitation = await owner.POST('/v1/invitations', {
    body: { email: managerEmail, role: 'manager' },
  });
  expect(invitation.response.status).toBe(201);

  const managerSignUp = await j.client.POST('/v1/identity/sign-up/email', {
    body: { name: 'Brian', email: managerEmail, password: 'a-strong-password' },
  });
  const manager = j.as(managerSignUp.data!.token);
  // The manager confirms their email from the link (invitations need a verified address).
  const mail = await j.api.deps.db.pools.owner.query(
    `SELECT payload FROM outbox WHERE payload->>'to' = $1 AND payload->>'subject' LIKE 'Confirm your email%'`,
    [managerEmail],
  );
  const token = decodeURIComponent(/token=([^\s]+)/.exec(mail.rows[0].payload.text)![1]!);
  await j.client.POST('/v1/identity/email/verify', { body: { token } });
  const mine = await manager.GET('/v1/identity/me/invitations');
  expect(mine.data!.items).toHaveLength(1);
  const joined = await manager.POST('/v1/invitations/{id}/accept', {
    params: { path: { id: mine.data!.items[0]!.id } },
  });
  expect(joined.data!.activeOrg).toMatchObject({ orgName: 'Lakeside Agency', role: 'manager' });

  const landlords = [];
  for (const [name, fee] of [
    ['Mama Otieno', { mgmtFeeKind: 'percent' as const, mgmtFeeBps: 800 }],
    ['Kisumu Holdings Ltd', { mgmtFeeKind: 'flat' as const, mgmtFeeFlatCents: 1_000_000 }],
  ] as const) {
    const created = await manager.POST('/v1/client-landlords', {
      body: { name, phone: '0722111222', ...fee },
    });
    expect(created.response.status).toBe(201);
    landlords.push(created.data!);
    const prop = await manager.POST('/v1/properties', {
      body: { name: `${name} Court`, county: 'Kisumu', clientLandlordId: created.data!.id },
    });
    await manager.POST('/v1/properties/{propertyId}/units/bulk', {
      params: { path: { propertyId: prop.data!.id } },
      body: {
        prefix: name.slice(0, 2).toUpperCase(),
        start: 1,
        count: 4,
        mode: 'long_term',
        rentCents: 2_000_000,
      },
    });
  }

  const list = await owner.GET('/v1/client-landlords', { params: { query: { limit: 25 } } });
  expect(list.data!.items.map((l) => [l.name, l.propertyCount])).toEqual([
    ['Kisumu Holdings Ltd', 1],
    ['Lakeside Agency', 0],
    ['Mama Otieno', 1],
  ]);

  const forOne = await owner.GET('/v1/properties', {
    params: { query: { clientLandlordId: landlords[0]!.id, limit: 25 } },
  });
  expect(forOne.data!.items).toEqual([
    expect.objectContaining({
      name: 'Mama Otieno Court',
      unitCounts: { total: 4, longTerm: 4, shortStay: 0 },
    }),
  ]);

  const team = await owner.GET('/v1/members');
  expect(team.data!.items.map((m) => m.role).sort()).toEqual(['manager', 'owner']);
});
