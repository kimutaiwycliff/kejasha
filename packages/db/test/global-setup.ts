import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer } from '@testcontainers/redis';
import pg from 'pg';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseOwnerUrl: string;
    databaseAuthenticatedUrl: string;
    redisUrl: string;
  }
}

const ROOT = resolve(import.meta.dirname, '../../..');
const AUTH_PASSWORD = 'test-authenticated';

/** One Postgres 17 + Redis per test run; migrations applied with the real dbmate files. */
export default async function setup(project: TestProject) {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer('postgres:17-alpine')
      .withUsername('app_owner')
      .withPassword('test-owner')
      .withDatabase('kejasha')
      .start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);

  const ownerUrl = `${postgres.getConnectionUri()}?sslmode=disable`;
  execFileSync(
    'pnpm',
    ['exec', 'dbmate', '--no-dump-schema', '--migrations-dir', 'infra/migrations', 'up'],
    { cwd: ROOT, env: { ...process.env, DATABASE_URL: ownerUrl }, stdio: 'pipe' },
  );

  const client = new pg.Client({ connectionString: ownerUrl });
  await client.connect();
  await client.query(`ALTER ROLE app_authenticated LOGIN PASSWORD '${AUTH_PASSWORD}'`);
  await client.end();

  const authUrl = new URL(ownerUrl);
  authUrl.username = 'app_authenticated';
  authUrl.password = AUTH_PASSWORD;

  project.provide('databaseOwnerUrl', ownerUrl);
  project.provide('databaseAuthenticatedUrl', authUrl.toString());
  project.provide('redisUrl', redis.getConnectionUrl());

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}
