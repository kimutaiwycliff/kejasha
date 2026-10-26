import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPhoneMember, client, ownerWithOrg } from './actors';
import { buildTestApi, type TestApi } from './helpers';

let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({ LOG_LEVEL: 'error' });
});
afterAll(() => api.close());

const newProperty = (c: ReturnType<typeof client>, body: Record<string, unknown> = {}) =>
  c.post('/v1/properties', {
    name: 'Riverside Court',
    county: 'Nairobi',
    area: 'Kilimani',
    ...body,
  });

describe('client landlords', () => {
  it('creates, validates fees, updates and archives', async () => {
    const o = await ownerWithOrg(api, 'agency');
    const c = client(api, o.token);

    const bad = await c.post('/v1/client-landlords', { name: 'Otieno', mgmtFeeKind: 'percent' });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().code).toBe('invalid_management_fee');
    const partial = await c.post('/v1/client-landlords', { name: 'Otieno', mgmtFeeBps: 500 });
    expect(partial.json().code).toBe('invalid_management_fee');

    const created = await c.post('/v1/client-landlords', {
      name: 'Otieno Holdings',
      phone: '0722 000 111',
      kraPin: 'p051234567q',
      mgmtFeeKind: 'percent',
      mgmtFeeBps: 1000,
    });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      phone: '+254722000111',
      kraPin: 'P051234567Q',
      mgmtFeeBps: 1000,
      isSelf: false,
      propertyCount: 0,
    });

    const flat = await c.patch(`/v1/client-landlords/${created.json().id}`, {
      mgmtFeeKind: 'flat',
      mgmtFeeFlatCents: 500_000,
    });
    expect(flat.json()).toMatchObject({
      mgmtFeeKind: 'flat',
      mgmtFeeBps: null,
      mgmtFeeFlatCents: 500_000,
    });

    const prop = await newProperty(c, { clientLandlordId: created.json().id });
    expect(prop.statusCode, prop.body).toBe(201);
    const blocked = await c.post(`/v1/client-landlords/${created.json().id}/archive`);
    expect(blocked.json().code, blocked.body).toBe('has_active_properties');

    await c.post(`/v1/properties/${prop.json().id}/archive`);
    const archived = await c.post(`/v1/client-landlords/${created.json().id}/archive`);
    expect(archived.json().archivedAt).not.toBeNull();

    const self = (await c.get('/v1/client-landlords'))
      .json()
      .items.find((l: { isSelf: boolean }) => l.isSelf);
    expect((await c.post(`/v1/client-landlords/${self.id}/archive`)).json().code).toBe(
      'cannot_archive_self',
    );
    expect(
      (
        await c.post('/v1/properties', {
          name: 'X',
          county: 'Nairobi',
          clientLandlordId: created.json().id,
        })
      ).json().code,
    ).toBe('client_landlord_archived');
  });

  it('paginates by name with an opaque cursor', async () => {
    const o = await ownerWithOrg(api, 'agency', 'Zeta Agency');
    const c = client(api, o.token);
    for (const name of ['Alpha', 'Bravo', 'Charlie', 'Delta'])
      await c.post('/v1/client-landlords', { name });
    const first = (await c.get('/v1/client-landlords?limit=2')).json();
    expect(first.items.map((l: { name: string }) => l.name)).toEqual(['Alpha', 'Bravo']);
    const second = (await c.get(`/v1/client-landlords?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second.items.map((l: { name: string }) => l.name)).toEqual(['Charlie', 'Delta']);
    const third = (await c.get(`/v1/client-landlords?limit=2&cursor=${second.nextCursor}`)).json();
    expect(third).toEqual({
      items: [expect.objectContaining({ name: 'Zeta Agency', isSelf: true })],
      nextCursor: null,
    });
    const garbage = await c.get('/v1/client-landlords?cursor=garbage');
    expect(garbage.statusCode).toBe(422);
    expect(garbage.json().code).toBe('invalid_cursor');
  });
});

describe('properties and units', () => {
  it('defaults properties to the self landlord and counts active units by mode', async () => {
    const o = await ownerWithOrg(api);
    const c = client(api, o.token);
    const prop = (await newProperty(c)).json();
    expect(prop).toMatchObject({
      clientLandlordName: 'Test Org',
      unitCounts: { total: 0, longTerm: 0, shortStay: 0 },
    });

    await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'a1',
      mode: 'long_term',
      rentCents: 2_500_000,
    });
    await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'BNB-1',
      mode: 'short_stay',
      baseNightlyCents: 450_000,
    });
    const listed = (await c.get('/v1/properties')).json().items[0];
    expect(listed.unitCounts).toEqual({ total: 2, longTerm: 1, shortStay: 1 });
  });

  it('normalises unit codes, keeps them unique per org (incl. archived) and validates price by mode', async () => {
    const o = await ownerWithOrg(api);
    const c = client(api, o.token);
    const prop = (await newProperty(c)).json();

    const unit = await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'a101',
      mode: 'long_term',
      rentCents: 3_000_000,
      bedrooms: 2,
    });
    expect(unit.statusCode, unit.body).toBe(201);
    expect(unit.json()).toMatchObject({
      code: 'A101',
      rentCents: 3_000_000,
      propertyName: 'Riverside Court',
    });

    const dup = await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'A101',
      mode: 'long_term',
      rentCents: 1,
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('unit_code_taken');

    const noRent = await c.post(`/v1/properties/${prop.id}/units`, {
      code: 'A102',
      mode: 'long_term',
    });
    expect(noRent.statusCode).toBe(422);
    expect(noRent.json().code).toBe('unit_price_required');
    expect(
      (
        await c.post(`/v1/properties/${prop.id}/units`, {
          code: 'a 102',
          mode: 'long_term',
          rentCents: 1,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await c.post(`/v1/properties/${prop.id}/units`, {
          code: 'WAY-TOO-LONG-CODE',
          mode: 'long_term',
          rentCents: 1,
        })
      ).statusCode,
    ).toBe(400);

    const toShort = await c.patch(`/v1/units/${unit.json().id}`, { mode: 'short_stay' });
    expect(toShort.statusCode).toBe(422);
    expect(toShort.json().code).toBe('unit_price_required');

    await c.post(`/v1/units/${unit.json().id}/archive`);
    expect((await c.get('/v1/unit-code-availability?code=a101')).json()).toEqual({
      code: 'A101',
      valid: true,
      available: false,
    });
    expect((await c.get('/v1/unit-code-availability?code=b202')).json()).toEqual({
      code: 'B202',
      valid: true,
      available: true,
    });
    expect((await c.get('/v1/unit-code-availability?code=%24%24')).json().valid).toBe(false);
  });

  it('bulk-creates numbered units all-or-nothing', async () => {
    const o = await ownerWithOrg(api);
    const c = client(api, o.token);
    const prop = (await newProperty(c)).json();

    const bulk = await c.post(`/v1/properties/${prop.id}/units/bulk`, {
      prefix: 'a',
      start: 1,
      count: 10,
      padding: 2,
      mode: 'long_term',
      rentCents: 1_800_000,
      bedrooms: 1,
    });
    expect(bulk.statusCode, bulk.body).toBe(201);
    expect(bulk.json().items.map((u: { code: string }) => u.code)).toEqual([
      'A01',
      'A02',
      'A03',
      'A04',
      'A05',
      'A06',
      'A07',
      'A08',
      'A09',
      'A10',
    ]);

    const clash = await c.post(`/v1/properties/${prop.id}/units/bulk`, {
      prefix: 'A',
      start: 9,
      count: 5,
      padding: 2,
      mode: 'long_term',
      rentCents: 1,
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().detail).toContain('A09, A10');
    expect((await c.get(`/v1/units?propertyId=${prop.id}&limit=100`)).json().items).toHaveLength(
      10,
    );

    const page1 = (await c.get('/v1/units?limit=4')).json();
    const page2 = (await c.get(`/v1/units?limit=4&cursor=${page1.nextCursor}`)).json();
    expect([...page1.items, ...page2.items].map((u: { code: string }) => u.code)).toEqual([
      'A01',
      'A02',
      'A03',
      'A04',
      'A05',
      'A06',
      'A07',
      'A08',
    ]);
  });

  it('archives properties only when they have no active units', async () => {
    const o = await ownerWithOrg(api);
    const c = client(api, o.token);
    const prop = (await newProperty(c)).json();
    const unit = (
      await c.post(`/v1/properties/${prop.id}/units`, {
        code: 'Z1',
        mode: 'long_term',
        rentCents: 1,
      })
    ).json();
    expect((await c.post(`/v1/properties/${prop.id}/archive`)).json().code).toBe(
      'has_active_units',
    );
    await c.post(`/v1/units/${unit.id}/archive`);
    expect((await c.post(`/v1/properties/${prop.id}/archive`)).json().archivedAt).not.toBeNull();
    expect(
      (
        await c.post(`/v1/properties/${prop.id}/units`, {
          code: 'Z2',
          mode: 'long_term',
          rentCents: 1,
        })
      ).json().code,
    ).toBe('property_archived');
  });
});

describe('roles and caretaker scoping', () => {
  it('agents read, only managers+ write; caretakers see only assigned properties', async () => {
    const o = await ownerWithOrg(api);
    const owner = client(api, o.token);
    const agent = await addPhoneMember(api, o, 'agent');
    const caretaker = await addPhoneMember(api, o, 'caretaker');

    const assigned = (await newProperty(owner, { name: 'Assigned Block' })).json();
    const other = (await newProperty(owner, { name: 'Other Block' })).json();
    await owner.post(`/v1/properties/${assigned.id}/units/bulk`, {
      prefix: 'S',
      start: 1,
      count: 3,
      mode: 'long_term',
      rentCents: 1_000_000,
    });
    await owner.post(`/v1/properties/${other.id}/units/bulk`, {
      prefix: 'O',
      start: 1,
      count: 2,
      mode: 'long_term',
      rentCents: 1_000_000,
    });

    const agentC = client(api, agent.token);
    expect((await agentC.get('/v1/properties')).json().items).toHaveLength(2);
    expect((await agentC.get('/v1/client-landlords')).statusCode).toBe(200);
    expect((await newProperty(agentC)).statusCode).toBe(403);

    const staff = await owner.put(`/v1/properties/${assigned.id}/staff`, {
      userIds: [caretaker.userId],
    });
    expect(staff.statusCode, staff.body).toBe(200);
    expect(staff.json().items).toEqual([
      expect.objectContaining({ userId: caretaker.userId, role: 'caretaker' }),
    ]);

    const care = client(api, caretaker.token);
    expect(
      (await care.get('/v1/properties')).json().items.map((p: { name: string }) => p.name),
    ).toEqual(['Assigned Block']);
    expect(
      (await care.get('/v1/units?limit=100')).json().items.map((u: { code: string }) => u.code),
    ).toEqual(['S1', 'S2', 'S3']);
    expect((await care.get(`/v1/properties/${other.id}`)).statusCode).toBe(404);
    expect((await care.get('/v1/client-landlords')).statusCode).toBe(403);

    const stranger = await ownerWithOrg(api);
    const notMember = await owner.put(`/v1/properties/${assigned.id}/staff`, {
      userIds: [stranger.userId],
    });
    expect(notMember.json().code).toBe('not_a_member');

    const detail = (await owner.get(`/v1/properties/${assigned.id}`)).json();
    expect(detail.staff).toHaveLength(1);
  });
});

describe('text safety', () => {
  it('rejects NUL characters in search and text fields with 400, never 500', async () => {
    const o = await ownerWithOrg(api);
    const c = client(api, o.token);
    const search = await c.get('/v1/properties?q=a%00b');
    expect(search.statusCode).toBe(400);
    expect(search.json().code).toBe('validation_error');
    // Rejected by the contract (validation_error), not by Postgres (invalid_text): required text
    // once let a single NUL through because `\S` matched it.
    const nul = await c.post('/v1/properties', { name: 'Bad\u0000Name', county: 'Nairobi' });
    expect(nul.statusCode).toBe(400);
    expect(nul.json().code).toBe('validation_error');
    const org = await c.post('/v1/orgs', { name: 'ab\u0000cd', kind: 'landlord' });
    expect(org.statusCode).toBe(400);
    expect(org.json().code).toBe('validation_error');
    expect((await c.get('/v1/unit-code-availability?code=A%00B')).statusCode).toBe(400);
  });
});

describe('isolation between orgs', () => {
  it('org B cannot see or touch org A records, even by id', async () => {
    const a = await ownerWithOrg(api, 'landlord', 'Org A');
    const b = await ownerWithOrg(api, 'landlord', 'Org B');
    const ca = client(api, a.token);
    const cb = client(api, b.token);
    const prop = (await newProperty(ca)).json();
    const unit = (
      await ca.post(`/v1/properties/${prop.id}/units`, {
        code: 'A1',
        mode: 'long_term',
        rentCents: 1,
      })
    ).json();

    expect((await cb.get('/v1/properties')).json().items).toEqual([]);
    expect((await cb.get(`/v1/properties/${prop.id}`)).statusCode).toBe(404);
    expect((await cb.get(`/v1/units/${unit.id}`)).statusCode).toBe(404);
    expect((await cb.patch(`/v1/units/${unit.id}`, { label: 'pwned' })).statusCode).toBe(404);
    expect(
      (
        await cb.post(`/v1/properties/${prop.id}/units`, {
          code: 'B1',
          mode: 'long_term',
          rentCents: 1,
        })
      ).statusCode,
    ).toBe(404);
    // The same unit code is free in another org.
    const bProp = (await newProperty(cb)).json();
    expect(
      (
        await cb.post(`/v1/properties/${bProp.id}/units`, {
          code: 'A1',
          mode: 'long_term',
          rentCents: 1,
        })
      ).statusCode,
    ).toBe(201);
  });
});

describe('idempotent writes with auth', () => {
  it('replays a unit create with the same key, scoped to the org', async () => {
    const o = await ownerWithOrg(api);
    const prop = (await newProperty(client(api, o.token))).json();
    const send = () =>
      api.app.inject({
        method: 'POST',
        url: `/v1/properties/${prop.id}/units`,
        payload: { code: 'K1', mode: 'long_term', rentCents: 100 },
        headers: { authorization: `Bearer ${o.token}`, 'idempotency-key': 'unit-create-k1-key' },
      });
    const first = await send();
    const second = await send();
    expect(first.statusCode).toBe(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.json().id).toBe(first.json().id);
  });
});
