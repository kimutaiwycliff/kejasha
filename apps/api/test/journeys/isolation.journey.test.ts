import { afterAll, beforeAll, expect, it } from 'vitest';
import { startJourney, type Journey } from './harness';

/** Journey (B1): two independent landlords on the same platform never see each other's data. */
let j: Journey;
beforeAll(async () => {
  j = await startJourney();
});
afterAll(() => j.close());

async function landlord(name: string) {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name,
      email: `${name.toLowerCase()}-${Date.now()}@example.test`,
      password: 'a-strong-password',
    },
  });
  const c = j.as(s.data!.token);
  await c.POST('/v1/orgs', {
    body: { name: `${name} Homes`, kind: 'landlord', county: 'Mombasa' },
  });
  return c;
}

it('org A cannot see org B', async () => {
  const a = await landlord('Alice');
  const b = await landlord('Baraka');
  const prop = await a.POST('/v1/properties', {
    body: { name: 'Nyali Villas', county: 'Mombasa' },
  });
  const unit = await a.POST('/v1/properties/{propertyId}/units', {
    params: { path: { propertyId: prop.data!.id } },
    body: { code: 'NV1', mode: 'short_stay', baseNightlyCents: 800_000, maxGuests: 4 },
  });

  expect((await b.GET('/v1/properties')).data!.items).toEqual([]);
  expect((await b.GET('/v1/units')).data!.items).toEqual([]);
  expect(
    (await b.GET('/v1/properties/{id}', { params: { path: { id: prop.data!.id } } })).response
      .status,
  ).toBe(404);
  expect(
    (await b.GET('/v1/units/{id}', { params: { path: { id: unit.data!.id } } })).response.status,
  ).toBe(404);
  expect((await b.GET('/v1/client-landlords')).data!.items.map((l) => l.name)).toEqual([
    'Baraka Homes',
  ]);
});
