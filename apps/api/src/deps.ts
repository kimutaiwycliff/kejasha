import type { Auth } from '@kejasha/auth';
import type { Config } from '@kejasha/config';
import type { Db } from '@kejasha/db';
import type { SmsSender } from '@kejasha/integrations-africastalking';
import type { DarajaClient } from '@kejasha/integrations-daraja';
import type { PaystackClient } from '@kejasha/integrations-paystack';
import type { Storage } from '@kejasha/integrations-storage';
import type { Redis } from 'ioredis';

/** Business time. Injected so billing, late fees and reminders can be tested on fixed dates. */
export interface Clock {
  /** Today's Africa/Nairobi business date (YYYY-MM-DD). */
  today(): string;
  now(): Date;
}

/** Everything the API needs from the outside world, injected so tests can swap pieces. */
export interface AppDeps {
  clock: Clock;
  config: Config;
  db: Db;
  redis: Redis;
  storage: Storage;
  auth: Auth;
  sms: SmsSender;
  daraja: DarajaClient;
  /** Kejasha's own subscription billing (never rent). */
  paystack: PaystackClient;
  version: string;
}
