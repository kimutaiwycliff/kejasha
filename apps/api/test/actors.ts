import { randomUUID } from 'node:crypto';
import { phone as phoneLib } from '@kejasha/core';
import { expect } from 'vitest';
import type { TestApi } from './helpers';

/** Test-side helpers that drive the API like a client would (bearer tokens, inject). */
export interface Session {
  token: string;
  userId: string;
}

export const uniqueEmail = (tag = 'user') => `${tag}-${randomUUID().slice(0, 8)}@example.test`;
export const uniquePhone = () => `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

const randomIp = () => `10.${[0, 0, 0].map(() => Math.floor(Math.random() * 250) + 1).join('.')}`;

/** Each client gets its own IP (via X-Forwarded-For) so per-IP limits don't bleed across tests. */
export function client(api: TestApi, token?: string, ip = randomIp()) {
  const headers = (extra?: Record<string, string>) => ({
    'x-forwarded-for': ip,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...extra,
  });
  return {
    get: (url: string) => api.app.inject({ method: 'GET', url, headers: headers() }),
    post: (url: string, payload?: object) =>
      api.app.inject({ method: 'POST', url, payload: payload ?? {}, headers: headers() }),
    patch: (url: string, payload: object) =>
      api.app.inject({ method: 'PATCH', url, payload, headers: headers() }),
    put: (url: string, payload: object) =>
      api.app.inject({ method: 'PUT', url, payload, headers: headers() }),
    delete: (url: string) => api.app.inject({ method: 'DELETE', url, headers: headers() }),
  };
}

export async function signUp(
  api: TestApi,
  name = 'Test User',
  email = uniqueEmail(),
): Promise<Session & { email: string }> {
  const res = await client(api).post('/v1/identity/sign-up/email', {
    name,
    email,
    password: 'correct-horse-battery',
  });
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json();
  return { token: body.token, userId: body.user.id, email };
}

export async function signInByOtp(api: TestApi, phone: string): Promise<Session> {
  const req = await client(api).post('/v1/identity/otp/request', { phone });
  expect(req.statusCode, req.body).toBe(202);
  const e164 = phoneLib.normalizeKenyanPhone(phone)!;
  const code = /\b(\d{6})\b/.exec(api.sms.lastTo(e164)?.message ?? '')?.[1];
  expect(code, 'OTP SMS not captured').toBeTruthy();
  const res = await client(api).post('/v1/identity/otp/verify', { phone, code });
  expect(res.statusCode, res.body).toBe(200);
  return { token: res.json().token, userId: res.json().user.id };
}

export async function createOrg(
  api: TestApi,
  s: Session,
  kind: 'landlord' | 'agency' | 'host' = 'landlord',
  name = 'Test Org',
) {
  const res = await client(api, s.token).post('/v1/orgs', { name, kind, county: 'Nairobi' });
  expect(res.statusCode, res.body).toBe(201);
  return res.json() as { id: string; name: string; kind: string };
}

/** Owner with a fresh org — the starting point of most tests. */
export async function ownerWithOrg(
  api: TestApi,
  kind: 'landlord' | 'agency' | 'host' = 'landlord',
  name = 'Test Org',
) {
  const s = await signUp(api, 'Owner');
  const org = await createOrg(api, s, kind, name);
  return { ...s, org };
}

/** Invite by phone and accept via OTP sign-in; returns the new member's session. */
export async function addPhoneMember(
  api: TestApi,
  inviter: Session,
  role: 'manager' | 'agent' | 'caretaker' | 'viewer',
) {
  const phone = uniquePhone();
  const inv = await client(api, inviter.token).post('/v1/invitations', { phone, role });
  expect(inv.statusCode, inv.body).toBe(201);
  const member = await signInByOtp(api, phone);
  const accepted = await client(api, member.token).post(`/v1/invitations/${inv.json().id}/accept`);
  expect(accepted.statusCode, accepted.body).toBe(200);
  return { ...member, phone };
}
