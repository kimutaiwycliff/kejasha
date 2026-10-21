import type { FastifyReply, FastifyRequest } from 'fastify';

/** Node request headers → Fetch Headers, for Better Auth's server API. */
export function toFetchHeaders(req: FastifyRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else headers.set(key, value);
  }
  return headers;
}

/** Copy session cookies and the bearer token header from a Better Auth response onto the reply. */
export function forwardAuthHeaders(from: Headers, reply: FastifyReply): void {
  const cookies = from.getSetCookie();
  if (cookies.length) reply.header('set-cookie', cookies);
  const token = from.get('set-auth-token');
  if (token) reply.header('set-auth-token', token);
}
