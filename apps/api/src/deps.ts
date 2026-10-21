import type { Config } from '@kejasha/config';
import type { Db } from '@kejasha/db';
import type { Storage } from '@kejasha/integrations-storage';
import type { Redis } from 'ioredis';

/** Everything the API needs from the outside world, injected so tests can swap pieces. */
export interface AppDeps {
  config: Config;
  db: Db;
  redis: Redis;
  storage: Storage;
  version: string;
}
