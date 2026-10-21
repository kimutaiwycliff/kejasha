import { inject, it, expect } from 'vitest';
import { createStorage } from '../src/index';

/** Guards ADR-019's checksum setting: presigned URLs must accept a real upload, not just exist. */
it('round-trips a file through presigned PUT and GET, and refuses a bad signature', async () => {
  const cfg = {
    endpoint: inject('s3Endpoint'),
    region: 'us-east-1',
    accessKey: 'kejasha-dev',
    secretKey: 'kejasha-dev-secret',
    bucketFiles: 'kejasha-files',
  };
  const storage = createStorage(cfg);
  await storage.ping();
  const key = `org/test/inspection_photo/${Date.now()}.jpg`;
  const body = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);

  const put = await fetch(await storage.presignPut(key, 'image/jpeg'), {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body,
  });
  expect(put.status).toBe(200);
  const get = await fetch(await storage.presignGet(key));
  expect(get.status).toBe(200);
  expect(new Uint8Array(await get.arrayBuffer())).toEqual(body);

  const forged = createStorage({ ...cfg, secretKey: 'not-the-secret' });
  const denied = await fetch(await forged.presignPut(`${key}.x`, 'image/jpeg'), {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg' },
    body,
  });
  expect(denied.status).toBe(403);
  storage.close();
  forged.close();
});
