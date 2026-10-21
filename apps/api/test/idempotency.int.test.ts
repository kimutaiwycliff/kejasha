import { randomUUID } from 'node:crypto';
import { Cents, problemResponses } from '@kejasha/contracts';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AppError } from '../src/errors';
import { buildTestApi, type TestApi } from './helpers';

// Test-only write routes: B0 has no business writes yet, but the plugin must be proven now.
let api: TestApi;
let counter = 0;
let flakyCalls = 0;
let release: () => void = () => {};

const Body = z
  .object({ amountCents: Cents, note: z.string().optional() })
  .meta({ id: 'TestCounterBody' });
const Result = z.object({ n: z.int(), amountCents: Cents }).meta({ id: 'TestCounterResult' });

beforeAll(async () => {
  api = await buildTestApi();
  const app = api.app.withTypeProvider<ZodTypeProvider>();
  app.post(
    '/__test/counter',
    { schema: { body: Body, response: { 201: Result, ...problemResponses(409, 422) } } },
    async (req, reply) =>
      reply.status(201).send({ n: ++counter, amountCents: req.body.amountCents }),
  );
  app.post('/__test/flaky', { schema: { body: Body } }, async () => {
    if (++flakyCalls === 1) throw new Error('transient failure');
    return { ok: true };
  });
  app.post('/__test/slow', { schema: { body: Body } }, async () => {
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return { ok: true };
  });
  app.post('/__test/rejects', { schema: { body: Body } }, async () => {
    throw AppError.unprocessable('lease_overlaps', 'The unit already has a lease for these dates.');
  });
  app.post(
    '/__test/required',
    { schema: { body: Body }, config: { idempotency: 'required' } },
    async () => ({ ok: true }),
  );
});
afterAll(() => api.close());
beforeEach(() => {
  counter = 0;
  flakyCalls = 0;
});

const post = (url: string, body: unknown, key?: string) =>
  api.app.inject({
    method: 'POST',
    url,
    payload: body as object,
    headers: key ? { 'idempotency-key': key } : {},
  });

describe('Idempotency-Key', () => {
  it('without a key every request executes', async () => {
    await post('/__test/counter', { amountCents: 100 });
    const res = await post('/__test/counter', { amountCents: 100 });
    expect(res.json().n).toBe(2);
  });

  it('replays the stored response for the same key and body', async () => {
    const key = randomUUID();
    const first = await post('/__test/counter', { amountCents: 2500 }, key);
    const second = await post('/__test/counter', { amountCents: 2500 }, key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.headers['content-type']).toBe(first.headers['content-type']);
    expect(counter).toBe(1);
  });

  it('rejects reuse of a key with a different body (422)', async () => {
    const key = randomUUID();
    await post('/__test/counter', { amountCents: 1 }, key);
    const res = await post('/__test/counter', { amountCents: 2 }, key);
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe('idempotency_key_reused');
    expect(counter).toBe(1);
  });

  it('rejects malformed keys (400)', async () => {
    const res = await post('/__test/counter', { amountCents: 1 }, 'short');
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('idempotency_key_invalid');
  });

  it('does not store 5xx, so the client can retry with the same key', async () => {
    const key = randomUUID();
    expect((await post('/__test/flaky', { amountCents: 1 }, key)).statusCode).toBe(500);
    const retry = await post('/__test/flaky', { amountCents: 1 }, key);
    expect(retry.statusCode).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
    expect(flakyCalls).toBe(2);
  });

  it('stores and replays 4xx domain errors', async () => {
    const key = randomUUID();
    const first = await post('/__test/rejects', { amountCents: 1 }, key);
    const second = await post('/__test/rejects', { amountCents: 1 }, key);
    expect(first.statusCode).toBe(422);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('answers 409 while the first request with that key is still running', async () => {
    const key = randomUUID();
    const first = post('/__test/slow', { amountCents: 1 }, key);
    await new Promise((r) => setTimeout(r, 100));
    const concurrent = await post('/__test/slow', { amountCents: 1 }, key);
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().code).toBe('idempotency_request_in_progress');
    release();
    expect((await first).statusCode).toBe(200);
  });

  it('enforces the key on routes that require it', async () => {
    const res = await post('/__test/required', { amountCents: 1 });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('idempotency_key_required');
  });
});

describe('validation errors', () => {
  it('are problem+json with field paths', async () => {
    const res = await post('/__test/counter', { amountCents: 1.5 });
    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.json()).toMatchObject({
      code: 'validation_error',
      errors: [{ path: 'body.amountCents' }],
    });
  });
});
