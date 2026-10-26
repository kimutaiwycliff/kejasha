import { createBackupStore } from '@kejasha/integrations-storage';
import { spawn } from 'node:child_process';
import type { Readable, Writable } from 'node:stream';
import pg from 'pg';
import type { AppDeps } from '../deps';

/**
 * Database backups (B7, ADR-013/019): `pg_dump -Fc` streamed to the backups bucket (R2 in
 * production — off the VM), pruned after the retention period, and a restore drill that proves a
 * dump actually restores and that the restored data keeps its invariants.
 */
const PREFIX = 'postgres/';

function tool(prefix: string | undefined, args: string[]) {
  // A prefix (dev) runs the tool inside the compose Postgres container: same version as the server.
  // It goes through `sh -c` so it may quote paths; the tool's own arguments are passed as "$@".
  if (prefix)
    return spawn('sh', ['-c', `${prefix} "$@"`, 'sh', ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  return spawn(args[0]!, args.slice(1), { stdio: ['pipe', 'pipe', 'pipe'] });
}

function waitFor(child: ReturnType<typeof spawn>, name: string): Promise<void> {
  let stderr = '';
  child.stderr?.on('data', (d: Buffer) => (stderr = (stderr + d.toString()).slice(-4000)));
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`${name} exited with ${code}: ${stderr.trim()}`)),
    );
  });
}

function store(deps: AppDeps) {
  return createBackupStore({ ...deps.config.s3, bucketBackups: deps.config.s3.bucketBackups });
}

function withDatabase(url: string, name: string) {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export async function runBackup(deps: AppDeps, now = new Date()) {
  const s = store(deps);
  if (!s.configured) throw new Error('Object storage is not configured; cannot back up.');
  const key = `${PREFIX}kejasha-${now.toISOString().replace(/[:.]/g, '-')}.dump`;
  const dump = tool(deps.config.backups.pgToolsPrefix, [
    'pg_dump',
    '--format=custom',
    '--compress=6',
    `--dbname=${deps.config.db.ownerUrl}`,
  ]);
  const done = waitFor(dump, 'pg_dump');
  try {
    await Promise.all([s.upload(key, dump.stdout as Readable, 'application/octet-stream'), done]);
  } catch (err) {
    await s.remove(key).catch(() => undefined);
    throw err;
  }
  const all = await s.list(PREFIX);
  const size = all.find((o) => o.key === key)?.size ?? 0;
  if (size === 0) throw new Error(`Backup ${key} is empty`);
  // Retention: keep the newest dumps within the window, never the one just written.
  const cutoff = now.getTime() - deps.config.backups.retentionDays * 86_400_000;
  const pruned = all.filter((o) => o.key !== key && o.lastModified.getTime() < cutoff);
  for (const o of pruned) await s.remove(o.key);
  return { key, bytes: size, pruned: pruned.length };
}

export interface DrillReport {
  key: string;
  bytes: number;
  migrations: { restored: number; source: number };
  rls: { tenantTables: number; unprotected: string[] };
  ledger: { trialBalanceCents: string; unbalancedEntries: number };
  rows: Record<string, number>;
  ok: boolean;
}

/** Restore the newest dump into a scratch database, check invariants, drop the scratch DB. */
export async function restoreDrill(deps: AppDeps): Promise<DrillReport> {
  const s = store(deps);
  const latest = (await s.list(PREFIX)).at(-1);
  if (!latest) throw new Error('No backups found to restore.');
  const scratch = `kejasha_drill_${Date.now()}`;
  const ownerUrl = deps.config.db.ownerUrl;
  const admin = new pg.Client({ connectionString: ownerUrl });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE ${scratch}`);
    const restore = tool(deps.config.backups.pgToolsPrefix, [
      'pg_restore',
      '--exit-on-error',
      `--dbname=${withDatabase(ownerUrl, scratch)}`,
    ]);
    const done = waitFor(restore, 'pg_restore');
    (await s.download(latest.key)).pipe(restore.stdin as Writable);
    await done;

    const check = new pg.Client({ connectionString: withDatabase(ownerUrl, scratch) });
    await check.connect();
    try {
      const q = async <T>(sql: string) => (await check.query(sql)).rows as T[];
      const [restored] = await q<{ n: number }>('SELECT count(*)::int AS n FROM schema_migrations');
      const [source] = (await admin.query('SELECT count(*)::int AS n FROM schema_migrations'))
        .rows as { n: number }[];
      const tables = await q<{ table: string; ok: boolean }>(`
        SELECT c.relname AS table, (c.relrowsecurity AND c.relforcerowsecurity) AS ok
          FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relkind = 'r'
           AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)`);
      const [tb] = await q<{ t: string }>(
        'SELECT coalesce(sum(amount_cents), 0)::text AS t FROM ledger_posting',
      );
      const [ub] = await q<{ n: number }>(
        'SELECT count(*)::int AS n FROM (SELECT entry_id FROM ledger_posting GROUP BY entry_id HAVING sum(amount_cents) <> 0) x',
      );
      const rows: Record<string, number> = {};
      for (const t of [
        'organization',
        'property',
        'unit',
        'tenant',
        'lease',
        'invoice',
        'payment',
        'ledger_entry',
        'booking',
        'audit_log',
      ]) {
        const [r] = await q<{ n: number }>(`SELECT count(*)::int AS n FROM ${t}`);
        rows[t] = r!.n;
      }
      const unprotected = tables.filter((t) => !t.ok).map((t) => t.table);
      const report: DrillReport = {
        key: latest.key,
        bytes: latest.size,
        migrations: { restored: restored!.n, source: source!.n },
        rls: { tenantTables: tables.length, unprotected },
        ledger: { trialBalanceCents: tb!.t, unbalancedEntries: ub!.n },
        rows,
        ok: restored!.n === source!.n && unprotected.length === 0 && tb!.t === '0' && ub!.n === 0,
      };
      return report;
    } finally {
      await check.end();
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`).catch(() => undefined);
    await admin.end();
  }
}
