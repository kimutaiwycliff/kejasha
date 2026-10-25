import { loadConfig } from '@kejasha/config';
import { MemorySmsSender } from '@kejasha/integrations-africastalking';
import { FakeDarajaClient } from '@kejasha/integrations-daraja';
import { FakePaystackClient } from '@kejasha/integrations-paystack';
import { testEnv } from '@kejasha/db/testing';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { AppDeps, Clock } from '../src/deps';
import { closeDeps, createDeps } from '../src/runtime';

export interface TestApi {
  app: FastifyInstance;
  deps: AppDeps;
  sms: MemorySmsSender;
  daraja: FakeDarajaClient;
  paystack: FakePaystackClient;
  close(): Promise<void>;
}

/** API wired to the Testcontainers Postgres/Redis. Routes may still be added before inject(). */
/** A clock tests can move: business date in Nairobi, `now` at 09:00 that day. */
export function testClock(start: string): Clock & { set(day: string): void } {
  let today = start;
  return {
    today: () => today,
    now: () => new Date(`${today}T09:00:00+03:00`),
    set(day: string) {
      today = day;
    },
  };
}

export async function buildTestApi(
  env: Record<string, string> = {},
  opts: { clock?: Clock } = {},
): Promise<TestApi> {
  const sms = new MemorySmsSender();
  const daraja = new FakeDarajaClient();
  const paystack = new FakePaystackClient();
  const deps = createDeps(loadConfig({ ...testEnv(), ...env }), {
    sms,
    daraja,
    paystack,
    ...(opts.clock ? { clock: opts.clock } : {}),
  });
  const app = await buildApp(deps);
  return {
    app,
    deps,
    sms,
    daraja,
    paystack,
    async close() {
      await app.close();
      await closeDeps(deps);
    },
  };
}
