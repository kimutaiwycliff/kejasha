import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApi, type TestApi } from './helpers';

let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi();
});
afterAll(() => api.close());

describe('GET /v1/health', () => {
  it('reports db, redis and storage up', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(body.checks.db.status).toBe('up');
    expect(body.checks.redis.status).toBe('up');
    expect(body.checks.storage.status).toBe('up');
  });

  it('echoes a safe incoming x-request-id and generates one otherwise', async () => {
    const echoed = await api.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'abc-123' },
    });
    expect(echoed.headers['x-request-id']).toBe('abc-123');
    const unsafe = await api.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { 'x-request-id': 'a b<script>' },
    });
    expect(unsafe.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns 503 degraded when a dependency is down', async () => {
    const broken = await buildTestApi({ REDIS_URL: 'redis://127.0.0.1:1' });
    try {
      const res = await broken.app.inject({ method: 'GET', url: '/v1/health' });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({
        status: 'degraded',
        checks: { redis: { status: 'down' }, db: { status: 'up' } },
      });
    } finally {
      await broken.close();
    }
  });
});

describe('meta, docs and errors', () => {
  it('serves meta config derived from APP_DOMAIN', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/meta/config' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      apiUrl: 'http://localhost:4000',
      webUrl: 'http://localhost:3000',
    });
  });

  it('serves the OpenAPI 3.1 spec and the Scalar UI', async () => {
    const spec = await api.app.inject({ method: 'GET', url: '/openapi.json' });
    expect(spec.json()).toMatchObject({
      openapi: '3.1.0',
      paths: { '/v1/health': { get: { operationId: 'getHealth' } } },
    });
    const docs = await api.app.inject({ method: 'GET', url: '/docs/' });
    expect(docs.statusCode).toBe(200);
    expect(docs.headers['content-type']).toMatch(/text\/html/);
  });

  it('renders unknown routes as problem+json', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({
      status: 404,
      code: 'route_not_found',
      requestId: expect.any(String),
    });
  });

  it('answers 405 with Allow for a wrong method on a real path', async () => {
    const res = await api.app.inject({ method: 'POST', url: '/v1/health?x=1' });
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe('GET, HEAD');
    expect(res.json()).toMatchObject({ code: 'method_not_allowed' });
    const query = await api.app.inject({ method: 'QUERY' as 'GET', url: '/v1/health' });
    expect(query.statusCode).toBe(405);
  });

  it('allows CORS only for trusted origins', async () => {
    const ok = await api.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    const evil = await api.app.inject({
      method: 'GET',
      url: '/v1/health',
      headers: { origin: 'https://evil.test' },
    });
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('transport hardening', () => {
  it('strips __proto__ keys instead of rejecting the request', async () => {
    const res = await api.app.inject({
      method: 'POST',
      url: '/v1/identity/otp/request',
      headers: { 'content-type': 'application/json' },
      payload: '{"__proto__": {"polluted": true}, "phone": "0712000001"}',
    });
    expect(res.statusCode).toBe(202);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});

describe('business date range', () => {
  it('refuses dates outside 1900–2199 with 422 before any handler runs', async () => {
    const res = await api.app.inject({ method: 'GET', url: '/v1/health?asOf=0020-02-29' });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('date_out_of_range');
  });
});
