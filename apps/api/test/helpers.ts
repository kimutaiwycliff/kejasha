import { loadConfig } from '@kejasha/config';
import { MemorySmsSender } from '@kejasha/integrations-africastalking';
import { testEnv } from '@kejasha/db/testing';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app';
import type { AppDeps } from '../src/deps';
import { closeDeps, createDeps } from '../src/runtime';

export interface TestApi {
  app: FastifyInstance;
  deps: AppDeps;
  sms: MemorySmsSender;
  close(): Promise<void>;
}

/** API wired to the Testcontainers Postgres/Redis. Routes may still be added before inject(). */
export async function buildTestApi(env: Record<string, string> = {}): Promise<TestApi> {
  const sms = new MemorySmsSender();
  const deps = createDeps(loadConfig({ ...testEnv(), ...env }), { sms });
  const app = await buildApp(deps);
  return {
    app,
    deps,
    sms,
    async close() {
      await app.close();
      await closeDeps(deps);
    },
  };
}
