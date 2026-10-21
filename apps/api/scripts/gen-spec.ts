/**
 * Writes apps/api/openapi.json from the live route schemas (ADR-002). No services are contacted.
 *   tsx scripts/gen-spec.ts          → write
 *   tsx scripts/gen-spec.ts --check  → exit 1 if the committed spec is stale
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig } from '@kejasha/config';
import { buildApp } from '../src/app';
import { closeDeps, createDeps } from '../src/runtime';

const SPEC_PATH = new URL('../openapi.json', import.meta.url);

const config = loadConfig({
  NODE_ENV: 'development',
  LOG_LEVEL: 'silent',
  APP_DOMAIN: 'localhost',
  DATABASE_URL: 'postgresql://spec@127.0.0.1:1/spec',
  DATABASE_AUTHENTICATED_URL: 'postgresql://spec@127.0.0.1:1/spec',
  REDIS_URL: 'redis://127.0.0.1:1',
  BETTER_AUTH_SECRET: 'spec-generation-only-secret-0123456789abcdef',
});
const deps = createDeps(config);
const app = await buildApp(deps);
await app.ready();
const spec = `${JSON.stringify(app.swagger(), null, 2)}\n`;
await app.close();
await closeDeps(deps);

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(SPEC_PATH, 'utf8');
  } catch {
    // missing spec counts as stale
  }
  if (current !== spec) {
    console.error('openapi.json is stale — run `make api-spec` and commit the result.');
    process.exit(1);
  }
  console.log('openapi.json is up to date.');
} else {
  writeFileSync(SPEC_PATH, spec);
  console.log(`wrote ${SPEC_PATH.pathname}`);
}
