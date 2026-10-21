import type { HealthResponse, MetaConfigResponse } from '@kejasha/contracts';
import { pingDb } from '@kejasha/db';
import type { AppDeps } from '../../deps';
import { CONTRACT_VERSION } from '../../plugins/openapi';

type Check = HealthResponse['checks']['db'];

const TIMEOUT_MS = 1500;

async function timed(probe: () => Promise<unknown>): Promise<Check> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
      }),
    ]);
    return { status: 'up', latencyMs: Math.round(performance.now() - started) };
  } catch (err) {
    return { status: 'down', error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth(deps: AppDeps): Promise<HealthResponse> {
  const [db, redis, storage] = await Promise.all([
    timed(() => pingDb(deps.db)),
    timed(() => deps.redis.ping()),
    deps.storage.configured
      ? timed(() => deps.storage.ping())
      : Promise.resolve<Check>({ status: 'skipped' }),
  ]);
  const checks = { db, redis, storage };
  const ok = Object.values(checks).every((c) => c.status !== 'down');
  return {
    status: ok ? 'ok' : 'degraded',
    version: deps.version,
    time: new Date().toISOString(),
    checks,
  };
}

export function metaConfig(deps: AppDeps): MetaConfigResponse {
  return {
    apiUrl: deps.config.domain.apiUrl,
    webUrl: deps.config.domain.webUrl,
    contractVersion: CONTRACT_VERSION,
    minAndroidVersionCode: 0,
  };
}
