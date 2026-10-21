import { readFileSync } from 'node:fs';
import { createAuth } from '@kejasha/auth';
import { loadConfig, type Config } from '@kejasha/config';
import { phone } from '@kejasha/core';
import { createDb, withAdmin } from '@kejasha/db';
import { createSmsSender, type SmsSender } from '@kejasha/integrations-africastalking';
import { createStorage } from '@kejasha/integrations-storage';
import { enqueueInTx } from '@kejasha/jobs';
import { Redis } from 'ioredis';
import type { AppDeps } from './deps';
import { passwordResetEmail } from './modules/identity/messages';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version: string;
};

/** Real dependencies from config. Connections are lazy, so this is also safe for spec generation. */
export function createDeps(
  config: Config = loadConfig(),
  overrides: { sms?: SmsSender } = {},
): AppDeps {
  const db = createDb({
    ownerUrl: config.db.ownerUrl,
    authenticatedUrl: config.db.authenticatedUrl,
    applicationName: 'kejasha-api',
  });
  const sms =
    overrides.sms ??
    createSmsSender(config.africasTalking, (m) => {
      // Development without an SMS provider: surface messages (OTPs) in the console only.
      if (config.env === 'development')
        console.info(`[sms → ${phone.maskPhone(m.to)}] ${m.message}`);
    });
  const auth = createAuth({
    config,
    db,
    sms,
    onPasswordReset: async ({ email, name, token }) => {
      await withAdmin(db, (tx) =>
        enqueueInTx(tx, {
          orgId: null,
          topic: 'notifications.email',
          payload: passwordResetEmail(config, { email, name, token }),
        }),
      );
    },
  });
  return {
    config,
    version: process.env.GIT_SHA ?? pkg.version,
    db,
    redis: new Redis(config.redis.url, {
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      enableOfflineQueue: true,
    }),
    storage: createStorage(config.s3),
    auth,
    sms,
  };
}

export async function closeDeps(deps: AppDeps): Promise<void> {
  deps.storage.close();
  deps.redis.disconnect();
  await deps.db.close();
}
