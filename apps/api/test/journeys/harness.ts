import type { AddressInfo } from 'node:net';
import { createApiClient, type ApiClient } from '@kejasha/api-client';
import type { Clock } from '../../src/deps';
import { buildTestApi, type TestApi } from '../helpers';

export interface Journey {
  /** Generated client — journeys may ONLY talk to the API through this (ADR-018). */
  client: ApiClient;
  /** A generated client that sends `Authorization: Bearer <token>` (how Android authenticates). */
  as(token: string): ApiClient;
  /** Reads the last SMS sent to a number (OTP codes) — stands in for the user's phone. */
  lastSms(e164: string): string | undefined;
  baseUrl: string;
  api: TestApi;
  close(): Promise<void>;
}

/** Boots the real API on a random port against Testcontainers. */
export async function startJourney(
  opts: { clock?: Clock; env?: Record<string, string> } = {},
): Promise<Journey> {
  const api = await buildTestApi(opts.env ?? {}, opts.clock ? { clock: opts.clock } : {});
  await api.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = api.app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return {
    client: createApiClient(baseUrl),
    as: (token) => createApiClient(baseUrl, { headers: { authorization: `Bearer ${token}` } }),
    lastSms: (e164) => api.sms.lastTo(e164)?.message,
    baseUrl,
    api,
    close: () => api.close(),
  };
}
