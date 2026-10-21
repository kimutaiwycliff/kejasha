import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  addPhoneMember,
  client,
  createOrg,
  ownerWithOrg,
  signInByOtp,
  signUp,
  uniqueEmail,
  uniquePhone,
} from './actors';
import { buildTestApi, type TestApi } from './helpers';

let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi();
});
afterAll(() => api.close());

describe('email sign-up and sign-in', () => {
  it('signs up, returns a bearer token and sets a session cookie', async () => {
    const email = uniqueEmail();
    const res = await client(api).post('/v1/identity/sign-up/email', {
      name: 'Amina',
      email,
      password: 'correct-horse-battery',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      token: expect.any(String),
      user: { email, name: 'Amina', phone: null },
    });
    expect(String(res.headers['set-cookie'])).toMatch(/kj\.session_token=/);

    const me = await client(api, res.json().token).get('/v1/identity/me');
    expect(me.json()).toMatchObject({ user: { email }, activeOrg: null, memberships: [] });
  });

  it('rejects a duplicate email and a wrong password', async () => {
    const s = await signUp(api, 'Dup');
    const dup = await client(api).post('/v1/identity/sign-up/email', {
      name: 'Dup',
      email: s.email,
      password: 'correct-horse-battery',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().code).toBe('email_taken');
    const bad = await client(api).post('/v1/identity/sign-in/email', {
      email: s.email,
      password: 'wrong-password-123',
    });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().code).toBe('invalid_credentials');
    expect(bad.headers['content-type']).toMatch(/problem\+json/);
    const ok = await client(api).post('/v1/identity/sign-in/email', {
      email: s.email.toUpperCase(),
      password: 'correct-horse-battery',
    });
    expect(ok.statusCode, ok.body).toBe(200);
  });

  it('validates input as problem+json', async () => {
    const res = await client(api).post('/v1/identity/sign-up/email', {
      name: '',
      email: 'nope',
      password: 'short',
    });
    expect(res.statusCode).toBe(400);
    const fields = new Set(res.json().errors.map((e: { path: string }) => e.path));
    expect([...fields].sort()).toEqual(['body.email', 'body.name', 'body.password']);
  });

  it('protects routes: 401 without a session, 403 without an org', async () => {
    expect((await client(api).get('/v1/identity/me')).statusCode).toBe(401);
    expect((await client(api, 'garbage').get('/v1/identity/me')).statusCode).toBe(401);
    const s = await signUp(api);
    const res = await client(api, s.token).get('/v1/properties');
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('no_active_org');
  });

  it('signs out (token stops working)', async () => {
    const s = await signUp(api);
    expect((await client(api, s.token).post('/v1/identity/sign-out')).statusCode).toBe(204);
    expect((await client(api, s.token).get('/v1/identity/me')).statusCode).toBe(401);
  });
});

describe('phone OTP', () => {
  it('creates a phone-only user on first verify and signs in again later', async () => {
    const phone = uniquePhone();
    const first = await signInByOtp(api, phone);
    const me = await client(api, first.token).get('/v1/identity/me');
    expect(me.json().user).toMatchObject({
      email: null,
      phone: `+254${phone.slice(1)}`,
      phoneVerified: true,
    });
    const again = await signInByOtp(api, `+254 ${phone.slice(1)}`.replace(' ', ''));
    expect(again.userId).toBe(first.userId);
  });

  it('rejects a wrong code and non-Kenyan numbers', async () => {
    const phone = uniquePhone();
    await client(api).post('/v1/identity/otp/request', { phone });
    const wrong = await client(api).post('/v1/identity/otp/verify', { phone, code: '000000' });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().code).toBe('invalid_otp');
    const foreign = await client(api).post('/v1/identity/otp/request', { phone: '+255712345678' });
    expect(foreign.statusCode).toBe(400);
  });

  it('rejects reset with an invalid token as 401', async () => {
    const res = await client(api).post('/v1/identity/password/reset', {
      token: 'not-a-real-token',
      newPassword: 'whatever-long-enough',
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe('invalid_token');
  });

  it('rate-limits OTP requests per phone', async () => {
    const phone = uniquePhone();
    const codes = [];
    for (let i = 0; i < 6; i++)
      codes.push((await client(api).post('/v1/identity/otp/request', { phone })).statusCode);
    expect(codes.slice(0, 5)).toEqual([202, 202, 202, 202, 202]);
    expect(codes[5]).toBe(429);
  });
});

describe('organizations', () => {
  it('creates an org, makes the creator owner and activates it', async () => {
    const s = await signUp(api, 'Wanjiru');
    const org = await createOrg(api, s, 'agency', 'Wanjiru Estates');
    expect(org).toMatchObject({ name: 'Wanjiru Estates', kind: 'agency', county: 'Nairobi' });
    const me = await client(api, s.token).get('/v1/identity/me');
    expect(me.json().activeOrg).toMatchObject({ orgId: org.id, role: 'owner', kind: 'agency' });

    // ADR-005: the org's own (self) client landlord exists from the start.
    const landlords = await client(api, s.token).get('/v1/client-landlords');
    expect(landlords.json().items).toEqual([
      expect.objectContaining({ isSelf: true, name: 'Wanjiru Estates' }),
    ]);
  });

  it('updates the org profile (manager+) and audits it', async () => {
    const o = await ownerWithOrg(api);
    const res = await client(api, o.token).patch('/v1/org', {
      kraPin: 'a123456789z',
      phone: '0712345678',
      name: 'Renamed',
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'Renamed',
      kraPin: 'A123456789Z',
      phone: '+254712345678',
    });
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT action FROM audit_log WHERE org_id = $1 ORDER BY id',
      [o.org.id],
    );
    expect(rows.map((r) => r.action)).toEqual(['org.created', 'org.updated']);
  });

  it('switches the active org only to orgs the user belongs to', async () => {
    const o = await ownerWithOrg(api);
    const second = await createOrg(api, o, 'host', 'Second');
    const back = await client(api, o.token).post('/v1/identity/active-org', { orgId: o.org.id });
    expect(back.json().activeOrg.orgId).toBe(o.org.id);
    expect(back.json().memberships).toHaveLength(2);
    const stranger = await ownerWithOrg(api);
    const denied = await client(api, stranger.token).post('/v1/identity/active-org', {
      orgId: second.id,
    });
    expect(denied.statusCode).toBe(403);
  });
});

describe('members and invitations', () => {
  it('invites by email; the invitee signs up and accepts', async () => {
    const o = await ownerWithOrg(api, 'agency');
    const email = uniqueEmail('manager');
    const inv = await client(api, o.token).post('/v1/invitations', { email, role: 'manager' });
    expect(inv.statusCode, inv.body).toBe(201);
    expect(inv.json()).toMatchObject({ email, phone: null, role: 'manager', status: 'pending' });

    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT topic, payload FROM outbox WHERE org_id = $1',
      [o.org.id],
    );
    expect(rows).toEqual([
      expect.objectContaining({
        topic: 'notifications.email',
        payload: expect.objectContaining({ to: email }),
      }),
    ]);

    const invitee = await signUp(api, 'Manager', email);
    const mine = await client(api, invitee.token).get('/v1/identity/me/invitations');
    expect(mine.json().items).toEqual([
      expect.objectContaining({ id: inv.json().id, orgName: 'Test Org' }),
    ]);
    const accepted = await client(api, invitee.token).post(
      `/v1/invitations/${inv.json().id}/accept`,
    );
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json().activeOrg).toMatchObject({ orgId: o.org.id, role: 'manager' });
  });

  it('invites a caretaker by phone (SMS) who accepts after OTP sign-in', async () => {
    const o = await ownerWithOrg(api);
    const caretaker = await addPhoneMember(api, o, 'caretaker');
    const members = await client(api, o.token).get('/v1/members');
    expect(
      members
        .json()
        .items.map((m: { role: string }) => m.role)
        .sort(),
    ).toEqual(['caretaker', 'owner']);
    const me = await client(api, caretaker.token).get('/v1/identity/me');
    expect(me.json().activeOrg.role).toBe('caretaker');
  });

  it('enforces who may invite whom', async () => {
    const o = await ownerWithOrg(api);
    const manager = await addPhoneMember(api, o, 'manager');
    const agent = await addPhoneMember(api, o, 'agent');
    expect(
      (
        await client(api, manager.token).post('/v1/invitations', {
          email: uniqueEmail(),
          role: 'owner',
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await client(api, manager.token).post('/v1/invitations', {
          email: uniqueEmail(),
          role: 'agent',
        })
      ).statusCode,
    ).toBe(201);
    const byAgent = await client(api, agent.token).post('/v1/invitations', {
      email: uniqueEmail(),
      role: 'caretaker',
    });
    expect(byAgent.statusCode).toBe(403);
    expect(byAgent.json().code).toBe('insufficient_role');
    const both = await client(api, o.token).post('/v1/invitations', {
      email: uniqueEmail(),
      phone: uniquePhone(),
      role: 'agent',
    });
    expect(both.statusCode).toBe(422);
    expect(both.json().code).toBe('email_or_phone');
  });

  it('protects the last owner and lets owners change roles', async () => {
    const o = await ownerWithOrg(api);
    const agent = await addPhoneMember(api, o, 'agent');
    const members = (await client(api, o.token).get('/v1/members')).json().items as {
      id: string;
      userId: string;
      role: string;
    }[];
    const ownerMember = members.find((m) => m.role === 'owner')!;
    const agentMember = members.find((m) => m.userId === agent.userId)!;

    const demote = await client(api, o.token).patch(`/v1/members/${ownerMember.id}`, {
      role: 'manager',
    });
    expect(demote.statusCode).toBe(409);
    expect(demote.json().code).toBe('last_owner');

    const promote = await client(api, o.token).patch(`/v1/members/${agentMember.id}`, {
      role: 'manager',
    });
    expect(promote.statusCode, promote.body).toBe(200);
    expect(promote.json().items.find((m: { id: string }) => m.id === agentMember.id).role).toBe(
      'manager',
    );

    expect(
      (await client(api, agent.token).patch(`/v1/members/${ownerMember.id}`, { role: 'agent' }))
        .statusCode,
    ).toBe(403);
    expect((await client(api, o.token).delete(`/v1/members/${ownerMember.id}`)).json().code).toBe(
      'cannot_remove_self',
    );
    expect((await client(api, o.token).delete(`/v1/members/${agentMember.id}`)).statusCode).toBe(
      204,
    );
    expect((await client(api, agent.token).get('/v1/properties')).statusCode).toBe(403);
  });

  it('cancels invitations', async () => {
    const o = await ownerWithOrg(api);
    const inv = await client(api, o.token).post('/v1/invitations', {
      email: uniqueEmail(),
      role: 'agent',
    });
    expect((await client(api, o.token).delete(`/v1/invitations/${inv.json().id}`)).statusCode).toBe(
      204,
    );
    expect((await client(api, o.token).get('/v1/invitations')).json().items).toEqual([]);
  });
});

describe('password reset', () => {
  it('always answers 202 and enqueues an email only for real accounts', async () => {
    const s = await signUp(api);
    expect(
      (await client(api).post('/v1/identity/password/forgot', { email: uniqueEmail('ghost') }))
        .statusCode,
    ).toBe(202);
    expect(
      (await client(api).post('/v1/identity/password/forgot', { email: s.email })).statusCode,
    ).toBe(202);
    const { rows } = await api.deps.db.pools.owner.query(
      "SELECT payload FROM outbox WHERE topic = 'notifications.email' AND payload->>'to' = $1",
      [s.email],
    );
    expect(rows).toHaveLength(1);
    const token = /token=([^\s&]+)/.exec(rows[0].payload.text)?.[1];
    const reset = await client(api).post('/v1/identity/password/reset', {
      token: decodeURIComponent(token!),
      newPassword: 'a-brand-new-password',
    });
    expect(reset.statusCode, reset.body).toBe(204);
    const signIn = await client(api).post('/v1/identity/sign-in/email', {
      email: s.email,
      password: 'a-brand-new-password',
    });
    expect(signIn.statusCode).toBe(200);
  });
});
