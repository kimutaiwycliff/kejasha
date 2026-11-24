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

async function owner() {
  const { token } = await call('POST', '/v1/identity/sign-in/email', {
    email: 'landlord@demo.test',
    password: 'demo-password-123',
  });
  // A new bearer session has no active organization yet (the app does the same on sign-in).
  const me = await call('GET', '/v1/identity/me', undefined, token);
  await call('POST', '/v1/identity/active-org', { orgId: me.memberships[0].orgId }, token);
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

const scenarios = { owner };
const out = await scenarios[process.argv[2]]();
for (const [k, v] of Object.entries(out)) console.log(`${k}=${v}`);
