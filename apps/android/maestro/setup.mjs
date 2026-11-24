// Test data for the Maestro flows, created through the API as the seeded demo landlord
// (`make db-seed`). Prints KEY=value lines for maestro -e. Usage: node setup.mjs owner
const API = process.env.API_URL ?? 'http://localhost:4000';
const tag = String(Math.floor(100000 + Math.random() * 900000));
// Letters only: the API matches payer names on letter tokens, so digits would not make a name unique.
const word = [...tag].map((d) => 'abcdefghij'[Number(d)]).join('');

async function call(method, path, body, token) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(method === 'GET' ? {} : { 'Idempotency-Key': crypto.randomUUID() }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const ksh = (cents) =>
  `Ksh ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());

async function landlord() {
  const { token } = await call('POST', '/v1/identity/sign-in/email', {
    email: 'landlord@demo.test',
    password: 'demo-password-123',
  });
  // A new bearer session has no active organization yet (the app does the same on sign-in).
  const me = await call('GET', '/v1/identity/me', undefined, token);
  await call('POST', '/v1/identity/active-org', { orgId: me.memberships[0].orgId }, token);
  return token;
}

async function owner() {
  const token = await landlord();
  const property = await call(
    'POST',
    '/v1/properties',
    { name: `Maestro Court ${tag}`, county: 'Nairobi' },
    token,
  );
  const unit = await call(
    'POST',
    `/v1/properties/${property.id}/units`,
    { code: `MA${tag}`, mode: 'long_term', rentCents: 2_000_000 },
    token,
  );
  const tenant = await call('POST', '/v1/tenants', { fullName: `Wa${word} Ke${word}` }, token);
  const lease = await call(
    'POST',
    '/v1/leases',
    { unitId: unit.id, tenantId: tenant.id, startDate: today, rentCents: 2_000_000 },
    token,
  );
  // Unique amounts so the flow finds its own rows among older test data.
  const cashCents = 400_000 + Number(tag.slice(-4));
  const payCents = 700_000 + Number(tag.slice(-4));
  await call(
    'POST',
    '/v1/cash-collections',
    { unitId: unit.id, amountCents: cashCents, receivedOn: today, payerName: tenant.fullName },
    token,
  );
  await call(
    'POST',
    '/v1/payments',
    { method: 'mpesa', amountCents: payCents, paidOn: today, payerName: tenant.fullName },
    token,
  );
  return {
    CASH: ksh(cashCents),
    PAYMENT: ksh(payCents),
    TENANT: tenant.fullName,
    UNIT: `MA${tag}`,
    LEASE_ID: lease.id,
  };
}

/** A property with a water meter, and an SMS invitation for a new caretaker's phone. */
async function caretakerInvite() {
  const token = await landlord();
  const property = await call(
    'POST',
    '/v1/properties',
    { name: `Caretaker Court ${tag}`, county: 'Kiambu' },
    token,
  );
  const unit = await call(
    'POST',
    `/v1/properties/${property.id}/units`,
    { code: `CT${tag}`, mode: 'long_term', rentCents: 1_500_000 },
    token,
  );
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Answers with the unit's meters.
  const { items: meters } = await call(
    'POST',
    `/v1/units/${unit.id}/meters`,
    { kind: 'water', unitLabel: 'm³', initialReading: { readOn: yesterday, reading: '100' } },
    token,
  );
  const meter = meters.find((m) => m.kind === 'water');
  // Cash is recorded against the lease covering the day, so the unit is let.
  const tenant = await call('POST', '/v1/tenants', { fullName: `Ca${word} Re${word}` }, token);
  await call(
    'POST',
    '/v1/leases',
    { unitId: unit.id, tenantId: tenant.id, startDate: yesterday, rentCents: 1_500_000 },
    token,
  );
  const local = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  await call('POST', '/v1/invitations', { phone: local, role: 'caretaker' }, token);
  return {
    PHONE: local,
    E164: `+254${local.slice(1)}`,
    PROPERTY_ID: property.id,
    PROPERTY: property.name,
    UNIT: unit.code,
    METER_ID: meter.id,
  };
}

/** After the caretaker joined in the app: give them the property. */
async function caretakerAssign(e164, propertyId) {
  const token = await landlord();
  const { items } = await call('GET', '/v1/members', undefined, token);
  const member = items.find((m) => m.phone === e164);
  if (!member) throw new Error(`No member with phone ${e164}`);
  await call('PUT', `/v1/properties/${propertyId}/staff`, { userIds: [member.userId] }, token);
  return { CARETAKER_USER_ID: member.userId };
}

/** The offline shift arrived exactly once: one reading today, one repair, one cash entry. */
async function caretakerVerify(propertyId, meterId, amountCents) {
  const token = await landlord();
  const readings = (
    await call('GET', `/v1/meters/${meterId}/readings`, undefined, token)
  ).items.filter((r) => r.readOn === today);
  const tickets = (
    await call('GET', `/v1/tickets?propertyId=${propertyId}&limit=100`, undefined, token)
  ).items;
  const cash = (
    await call('GET', '/v1/cash-collections?status=pending&limit=100', undefined, token)
  ).items.filter((c) => c.amountCents === Number(amountCents));
  const ok = readings.length === 1 && tickets.length === 1 && cash.length === 1;
  if (!ok)
    throw new Error(
      `Expected 1/1/1, got readings ${readings.length}, tickets ${tickets.length}, cash ${cash.length}`,
    );
  return { VERIFIED: 'readings=1 tickets=1 cash=1' };
}

/** A tenant whose phone is on their lease, owing a manual service-charge invoice. */
async function tenant() {
  const token = await landlord();
  const local = `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const property = await call(
    'POST',
    '/v1/properties',
    { name: `Tenant Court ${tag}`, county: 'Mombasa' },
    token,
  );
  const unit = await call(
    'POST',
    `/v1/properties/${property.id}/units`,
    { code: `TN${tag}`, mode: 'long_term', rentCents: 1_800_000 },
    token,
  );
  const tenant = await call(
    'POST',
    '/v1/tenants',
    { fullName: `Tenant Wa${word}`, phone: local },
    token,
  );
  const lease = await call(
    'POST',
    '/v1/leases',
    { unitId: unit.id, tenantId: tenant.id, startDate: today, rentCents: 1_800_000 },
    token,
  );
  const owed = 250_050; // Ksh 2,500.50: the prompt rounds up to Ksh 2,501
  await call(
    'POST',
    `/v1/leases/${lease.id}/invoices`,
    {
      dueOn: today,
      lines: [{ kind: 'service_charge', description: 'Service charge', amountCents: owed }],
    },
    token,
  );
  const { balanceCents } = await call('GET', `/v1/leases/${lease.id}`, undefined, token);
  return {
    PHONE: local,
    E164: `+254${local.slice(1)}`,
    UNIT: unit.code,
    OWES: ksh(balanceCents),
    PROMPT: String(Math.ceil(balanceCents / 100)),
  };
}

// A property pinned on the map with one let unit, for the map callout flow.
async function mapPin() {
  const token = await landlord();
  // Earlier runs' pins would sit on top of this one: take them off the map first.
  const old = await call('GET', '/v1/properties?q=Pin%20Court&limit=100', undefined, token);
  for (const p of old.items.filter((p) => p.name.startsWith('Pin Court ') && p.latitude !== null)) {
    await call('PATCH', `/v1/properties/${p.id}`, { latitude: null, longitude: null }, token);
  }
  const property = await call(
    'POST',
    '/v1/properties',
    {
      name: `Pin Court ${tag}`,
      county: 'Lamu',
      area: 'Shela',
      // A spot of its own on the coast, so other test pins do not cover it.
      latitude: Number((-2.29 + Number(tag.slice(-3)) / 100000).toFixed(6)),
      longitude: 40.91,
    },
    token,
  );
  await call(
    'POST',
    `/v1/properties/${property.id}/units`,
    { code: `PC${tag}`, mode: 'long_term', rentCents: 2_500_000 },
    token,
  );
  return { NAME: property.name };
}

const scenarios = { owner, mapPin, caretakerInvite, caretakerAssign, caretakerVerify, tenant };
const out = await scenarios[process.argv[2]](...process.argv.slice(3));
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
