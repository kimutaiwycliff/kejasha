import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

// timestamptz → Date (default); bigint (int8) → BigInt so money never passes through a float.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => BigInt(v));

export type Schema = typeof schema;
export type Database = NodePgDatabase<Schema>;
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface Db {
  /** Owner role (BYPASSRLS): migrations, platform tables, audited admin paths only. */
  owner: Database;
  /** Tenant role (RLS enforced). Only reachable through withTenant(). */
  authenticated: Database;
  pools: { owner: pg.Pool; authenticated: pg.Pool };
  close(): Promise<void>;
}

export interface DbOptions {
  ownerUrl: string;
  authenticatedUrl: string;
  max?: number;
  applicationName?: string;
}

export function createDb(opts: DbOptions): Db {
  const common = { max: opts.max ?? 10, application_name: opts.applicationName ?? 'kejasha' };
  const ownerPool = new pg.Pool({ connectionString: opts.ownerUrl, ...common });
  const authPool = new pg.Pool({ connectionString: opts.authenticatedUrl, ...common });
  return {
    owner: drizzle(ownerPool, { schema }),
    authenticated: drizzle(authPool, { schema }),
    pools: { owner: ownerPool, authenticated: authPool },
    async close() {
      await Promise.all([ownerPool.end(), authPool.end()]);
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface TenantContext {
  orgId: string;
  userId?: string | undefined;
}

/**
 * The only way to touch tenant data (ADR-003): one transaction with `app.org_id` (and
 * `app.user_id`) set LOCAL and the role switched to `app_authenticated`, so RLS applies even if
 * the pool's login role were misconfigured.
 */
export async function withTenant<T>(
  db: Db,
  ctx: TenantContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(ctx.orgId)) throw new TypeError(`withTenant: invalid orgId ${ctx.orgId}`);
  return db.authenticated.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE app_authenticated`);
    await tx.execute(sql`SELECT set_config('app.org_id', ${ctx.orgId}, true)`);
    if (ctx.userId) await tx.execute(sql`SELECT set_config('app.user_id', ${ctx.userId}, true)`);
    return fn(tx);
  });
}

/** Owner-role transaction for platform work (outbox relay, idempotency, operator tooling). */
export async function withAdmin<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.owner.transaction(fn);
}

/** Lightweight connectivity probe for /v1/health. */
export async function pingDb(db: Db): Promise<void> {
  await db.authenticated.execute(sql`SELECT 1`);
}
