import { randomUUID } from 'node:crypto';
import { inject } from 'vitest';
import { createDb, type Db } from './client';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseOwnerUrl: string;
    databaseAuthenticatedUrl: string;
    redisUrl: string;
    s3Endpoint: string;
  }
}

/** A Db wired to the Testcontainers Postgres started by test/global-setup.ts. */
export function createTestDb(): Db {
  return createDb({
    ownerUrl: inject('databaseOwnerUrl'),
    authenticatedUrl: inject('databaseAuthenticatedUrl'),
    max: 4,
    applicationName: 'kejasha-test',
  });
}

export function testEnv(): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    APP_DOMAIN: 'localhost',
    DATABASE_URL: inject('databaseOwnerUrl'),
    DATABASE_AUTHENTICATED_URL: inject('databaseAuthenticatedUrl'),
    REDIS_URL: inject('redisUrl'),
    BETTER_AUTH_SECRET: 'test-secret-test-secret-test-secret-0123',
    // Tests simulate distinct client IPs via X-Forwarded-For.
    TRUST_PROXY: 'true',
    S3_ENDPOINT: inject('s3Endpoint'),
    S3_ACCESS_KEY: 'kejasha-dev',
    S3_SECRET_KEY: 'kejasha-dev-secret',
    S3_BUCKET_FILES: 'kejasha-files',
    CREDENTIALS_MASTER_KEY: Buffer.alloc(32, 7).toString('base64'),
  };
}

export const newOrgId = (): string => randomUUID();
