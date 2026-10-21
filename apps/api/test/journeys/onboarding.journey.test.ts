import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startJourney, type Journey } from './harness';

/**
 * Journey (B1): an independent landlord signs up on the web, creates their org, adds a property
 * and ten units in one go, then sees the unit list a screen would render.
 */
let j: Journey;
beforeAll(async () => {
  j = await startJourney();
});
afterAll(() => j.close());

it('landlord onboarding: sign-up → org → property → 10 units', async () => {
  const email = `kamau-${randomUUID().slice(0, 6)}@example.test`;
  const signUp = await j.client.POST('/v1/identity/sign-up/email', {
    body: { name: 'Kamau Njoroge', email, password: 'a-strong-password' },
  });
  expect(signUp.response.status).toBe(200);
  const me = j.as(signUp.data!.token);

  const org = await me.POST('/v1/orgs', {
    body: { name: 'Kamau Properties', kind: 'landlord', county: 'Kiambu', phone: '0712 345 678' },
  });
  expect(org.data).toMatchObject({ kind: 'landlord', phone: '+254712345678' });

  const property = await me.POST('/v1/properties', {
    body: { name: 'Thika Road Flats', county: 'Kiambu', area: 'Ruiru' },
  });
  expect(property.data).toMatchObject({
    clientLandlordName: 'Kamau Properties',
    unitCounts: { total: 0, longTerm: 0, shortStay: 0 },
  });

  const units = await me.POST('/v1/properties/{propertyId}/units/bulk', {
    params: { path: { propertyId: property.data!.id } },
    body: {
      prefix: 'TR',
      start: 1,
      count: 10,
      padding: 2,
      mode: 'long_term',
      rentCents: 1_500_000,
      depositCents: 1_500_000,
      bedrooms: 1,
    },
    headers: { 'idempotency-key': randomUUID() },
  });
  expect(units.response.status).toBe(201);
  expect(units.data!.items).toHaveLength(10);

  const list = await me.GET('/v1/units', {
    params: { query: { propertyId: property.data!.id, limit: 25 } },
  });
  expect(list.data!.items.map((u) => u.code)).toEqual([
    'TR01',
    'TR02',
    'TR03',
    'TR04',
    'TR05',
    'TR06',
    'TR07',
    'TR08',
    'TR09',
    'TR10',
  ]);
  expect(list.data!.items[0]).toMatchObject({
    rentCents: 1_500_000,
    propertyName: 'Thika Road Flats',
    status: 'active',
  });

  const detail = await me.GET('/v1/properties/{id}', {
    params: { path: { id: property.data!.id } },
  });
  expect(detail.data!.unitCounts).toEqual({ total: 10, longTerm: 10, shortStay: 0 });

  const session = await me.GET('/v1/identity/me');
  expect(session.data!.activeOrg).toMatchObject({ orgName: 'Kamau Properties', role: 'owner' });
});
