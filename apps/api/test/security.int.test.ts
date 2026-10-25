import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addPhoneMember, client, ownerWithOrg, signUp } from './actors';
import { buildTestApi, type TestApi } from './helpers';

/** Hardening from the B7 security review (docs/security/review-2026-10.md). */
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi();
});
afterAll(() => api.close());

describe('B7 security review fixes', () => {
  it('refuses cookie-authenticated writes from untrusted origins (M5); bearer clients unaffected', async () => {
    const o = await ownerWithOrg(api);
    const cookie = `kj.session_token=${o.token}`;
    const evil = await api.app.inject({
      method: 'POST',
      url: '/v1/properties',
      payload: { name: 'X', county: 'Nairobi' },
      headers: { cookie, origin: 'https://evil.example' },
    });
    expect(evil.statusCode).toBe(403);
    expect(evil.json().code).toBe('origin_not_allowed');
    const bearer = await client(api, o.token).post('/v1/properties', {
      name: 'Fine',
      county: 'Nairobi',
    });
    expect(bearer.statusCode).toBe(201);
  });

  it('sends a strict CSP on API responses but not on the Scalar docs (L4)', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    const docs = await api.app.inject({ method: 'GET', url: '/docs' });
    expect(docs.headers['content-security-policy']).toBeUndefined();
  });

  it('keeps the staff directory from caretakers (L1) and logs denied operator attempts (L2)', async () => {
    const o = await ownerWithOrg(api);
    const care = await addPhoneMember(api, o, 'caretaker');
    expect((await client(api, care.token).get('/v1/members')).statusCode).toBe(403);
    expect((await client(api, o.token).get('/v1/members')).statusCode).toBe(200);
    const outsider = await signUp(api, 'Curious');
    expect((await client(api, outsider.token).get('/v1/operator/orgs')).statusCode).toBe(403);
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT method FROM operator_access_log WHERE user_id = $1',
      [outsider.userId],
    );
    expect(rows.map((r) => r.method)).toEqual(['DENIED GET']);
  });

  it('never stores identity responses (tokens) in the idempotency table (M4)', async () => {
    const email = `idem-${Date.now()}@example.test`;
    await api.app.inject({
      method: 'POST',
      url: '/v1/identity/sign-up/email',
      payload: { name: 'Idem', email, password: 'correct-horse-battery' },
      headers: { 'idempotency-key': `k-${email}` },
    });
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT count(*)::int AS n FROM idempotency_key WHERE key = $1',
      [`k-${email}`],
    );
    expect(rows[0].n).toBe(0);
  });
});
