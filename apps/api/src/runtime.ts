import { readFileSync } from 'node:fs';
import { loadConfig, type Config } from '@kejasha/config';
import { createDb } from '@kejasha/db';
import { createStorage } from '@kejasha/integrations-storage';
import { Redis } from 'ioredis';
import type { AppDeps } from './deps';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Real dependencies from config. Connections are lazy, so this is also safe for spec generation. */
export function createDeps(config: Config = loadConfig()): AppDeps {
  return {
    config,
    version: process.env.GIT_SHA ?? pkg.version,
    db: createDb({
      ownerUrl: config.db.ownerUrl,
      authenticatedUrl: config.db.authenticatedUrl,
      applicationName: 'kejasha-api',
    }),
    redis: new Redis(config.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
    }),
    storage: createStorage(config.s3),
  };
}

export async function closeDeps(deps: AppDeps): Promise<void> {
  deps.storage.close();
  deps.redis.disconnect();
  await deps.db.close();
}
