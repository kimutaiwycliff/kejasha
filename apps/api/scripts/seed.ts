/**
 * Demo data for local development, created through the real API (validation, RLS, audit all apply).
 * Idempotent: re-running signs in to the existing demo accounts and skips what exists.
 *   make db-seed   → prints the demo logins and a bearer token (used by `make test-contract`)
 */
import { writeFileSync } from 'node:fs';
import { eq, schema } from '@kejasha/db';
import { buildApp } from '../src/app';
import { closeDeps, createDeps } from '../src/runtime';

const PASSWORD = 'demo-password-123';
const deps = createDeps();
if (deps.config.isProduction) throw new Error('Refusing to seed a production database');
const app = await buildApp(deps);

async function call<T>(
  method: 'GET' | 'POST',
  url: string,
  token?: string,
  payload?: object,
): Promise<{ status: number; body: T }> {
  const res = await app.inject({
    method,
    url,
    payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, body: res.json() as T };
}

async function account(name: string, email: string): Promise<string> {
  const up = await call<{ token: string }>('POST', '/v1/identity/sign-up/email', undefined, {
    name,
    email,
    password: PASSWORD,
  });
  if (up.status === 200) return up.body.token;
  const inn = await call<{ token: string }>('POST', '/v1/identity/sign-in/email', undefined, {
    email,
    password: PASSWORD,
  });
  if (inn.status !== 200) throw new Error(`cannot sign in ${email}: ${JSON.stringify(inn.body)}`);
  return inn.body.token;
}

async function ensureOrg(
  token: string,
  name: string,
  kind: 'landlord' | 'agency' | 'host',
  county: string,
) {
  const me = await call<{ memberships: { orgId: string; orgName: string }[] }>(
    'GET',
    '/v1/identity/me',
    token,
  );
  const existing = me.body.memberships.find((m) => m.orgName === name);
  if (existing) {
    await call('POST', '/v1/identity/active-org', token, { orgId: existing.orgId });
    await activate(existing.orgId);
    return false;
  }
  const created = await call<{ id: string }>('POST', '/v1/orgs', token, { name, kind, county });
  await activate(created.body.id);
  return true;
}

/** Demo orgs are paid up for a year so local writes are not blocked by billing (B6b). */
async function activate(orgId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + 365 * 86_400_000).toISOString().slice(0, 10);
  await deps.db.owner
    .update(schema.subscription)
    .set({ status: 'active', currentPeriodStart: today, currentPeriodEnd: end })
    .where(eq(schema.subscription.orgId, orgId));
}

async function property(token: string, body: object, units: object) {
  const p = await call<{ id: string }>('POST', '/v1/properties', token, body);
  await call('POST', `/v1/properties/${p.body.id}/units/bulk`, token, units);
}

const landlordToken = await account('Wanjiku Demo', 'landlord@demo.test');
if (await ensureOrg(landlordToken, 'Wanjiku Homes', 'landlord', 'Nairobi')) {
  await property(
    landlordToken,
    { name: 'Kilimani Heights', county: 'Nairobi', area: 'Kilimani' },
    {
      prefix: 'KH',
      start: 1,
      count: 12,
      padding: 2,
      mode: 'long_term',
      rentCents: 3_500_000,
      depositCents: 3_500_000,
      bedrooms: 2,
    },
  );
  await property(
    landlordToken,
    { name: 'Diani Beach Studio', county: 'Kwale', area: 'Diani' },
    {
      prefix: 'DB',
      start: 1,
      count: 2,
      mode: 'short_stay',
      baseNightlyCents: 650_000,
      maxGuests: 2,
    },
  );
}

const agencyToken = await account('Otieno Demo', 'agency@demo.test');
if (await ensureOrg(agencyToken, 'Lakeside Property Managers', 'agency', 'Kisumu')) {
  for (const [name, prefix] of [
    ['Mama Akinyi', 'MA'],
    ['Kisumu Holdings Ltd', 'KS'],
  ] as const) {
    const l = await call<{ id: string }>('POST', '/v1/client-landlords', agencyToken, {
      name,
      mgmtFeeKind: 'percent',
      mgmtFeeBps: 1000,
    });
    await property(
      agencyToken,
      { name: `${name} Court`, county: 'Kisumu', clientLandlordId: l.body.id },
      { prefix, start: 1, count: 6, mode: 'long_term', rentCents: 1_800_000 },
    );
  }
}

writeFileSync(new URL('../.seed-token', import.meta.url), landlordToken);
console.log(`Seeded. Logins (password "${PASSWORD}"): landlord@demo.test, agency@demo.test`);
console.log('Bearer token for the landlord written to apps/api/.seed-token');
await app.close();
await closeDeps(deps);
