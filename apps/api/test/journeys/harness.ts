import type { AddressInfo } from 'node:net';
import { createApiClient, type ApiClient } from '@kejasha/api-client';
import { buildTestApi, type TestApi } from '../helpers';

export interface Journey {
  /** Generated client — journeys may ONLY talk to the API through this (ADR-018). */
  client: ApiClient;
  baseUrl: string;
  api: TestApi;
  close(): Promise<void>;
}

/** Boots the real API on a random port against Testcontainers. */
export async function startJourney(): Promise<Journey> {
  const api = await buildTestApi();
  await api.app.listen({ host: '127.0.0.1', port: 0 });
  const { port } = api.app.server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { client: createApiClient(baseUrl), baseUrl, api, close: () => api.close() };
}
