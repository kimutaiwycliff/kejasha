import { afterAll, beforeAll, expect, it } from 'vitest';
import { startJourney, type Journey } from './harness';

/** Journey: a freshly installed client checks the API is healthy and discovers its config. */
let j: Journey;
beforeAll(async () => {
  j = await startJourney();
});
afterAll(() => j.close());

it('client boot: health then canonical config', async () => {
  const health = await j.client.GET('/v1/health');
  expect(health.response.status).toBe(200);
  expect(health.data?.status).toBe('ok');

  const config = await j.client.GET('/v1/meta/config');
  expect(config.data).toMatchObject({
    contractVersion: expect.any(String),
    minAndroidVersionCode: 0,
  });
  expect(config.response.headers.get('x-request-id')).toBeTruthy();
});
