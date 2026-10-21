import { afterAll, expect, it } from 'vitest';
import { createTestDb } from '../../src/testing';
import { tenantTableFixtures } from './fixtures';

const db = createTestDb();
afterAll(() => db.close());

interface TableInfo {
  table: string;
  has_org_id: boolean;
  rls: boolean;
  forced: boolean;
  policies: number;
  granted: boolean;
}

async function publicTables(): Promise<TableInfo[]> {
  const { rows } = await db.pools.owner.query<TableInfo>(`
    SELECT c.relname AS table,
           EXISTS (SELECT 1 FROM pg_attribute a
                   WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped) AS has_org_id,
           c.relrowsecurity AS rls,
           c.relforcerowsecurity AS forced,
           (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
           has_table_privilege('app_authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') AS granted
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
     ORDER BY 1`);
  return rows;
}

it('every table with org_id has RLS enabled, forced and a policy', async () => {
  const bad = (await publicTables()).filter(
    (t) => t.has_org_id && !(t.rls && t.forced && t.policies > 0),
  );
  expect(bad.map((t) => t.table)).toEqual([]);
});

it('the tenant role is granted nothing on tables without RLS', async () => {
  const leaky = (await publicTables()).filter((t) => t.granted && !(t.rls && t.forced));
  expect(leaky.map((t) => t.table)).toEqual([]);
});

it('every tenant table has an isolation fixture', async () => {
  const tenantTables = (await publicTables()).filter((t) => t.has_org_id).map((t) => t.table);
  expect(tenantTableFixtures.map((f) => f.table).sort()).toEqual(tenantTables.sort());
});
