import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/client';
import { createTestDb, newOrgId } from '../../src/testing';
import { tenantTableFixtures } from './fixtures';
import { expectPgError } from './pg-error';

const db = createTestDb();
afterAll(() => db.close());

const INSUFFICIENT_PRIVILEGE = '42501'; // also raised for RLS WITH CHECK violations

describe.each(tenantTableFixtures)('RLS isolation: $table', (f) => {
  const table = sql.identifier(f.table);
  const prepared = async (...orgIds: string[]) => {
    for (const orgId of orgIds)
      for (const stmt of f.prepare?.(orgId) ?? []) await db.owner.execute(stmt);
    return orgIds;
  };

  it('owner org can insert its own row', async () => {
    const [orgA] = (await prepared(newOrgId())) as [string];
    await withTenant(db, { orgId: orgA }, (tx) => tx.execute(f.insert(orgA)));
    const { rows } = await db.pools.owner.query(
      `SELECT count(*)::int AS n FROM ${f.table} WHERE org_id = $1`,
      [orgA],
    );
    expect(rows[0].n).toBe(f.rowsPerInsert ?? 1);
  });

  it('cannot insert a row for another org', async () => {
    const [orgA, orgB] = (await prepared(newOrgId(), newOrgId())) as [string, string];
    await expectPgError(
      withTenant(db, { orgId: orgB }, (tx) => tx.execute(f.insert(orgA))),
      INSUFFICIENT_PRIVILEGE,
    );
  });

  it('without org context: no inserts, no rows', async () => {
    const [orgA] = (await prepared(newOrgId())) as [string];
    await withTenant(db, { orgId: orgA }, (tx) => tx.execute(f.insert(orgA)));
    await expectPgError(
      db.authenticated.transaction((tx) => tx.execute(f.insert(orgA))),
      INSUFFICIENT_PRIVILEGE,
    );
    if (f.grants.select) {
      const res = await db.authenticated.execute(sql`SELECT count(*)::int AS n FROM ${table}`);
      expect(res.rows[0]).toEqual({ n: 0 });
    }
  });

  it('another org cannot read, update or delete the row', async () => {
    const [orgA, orgB] = (await prepared(newOrgId(), newOrgId())) as [string, string];
    await withTenant(db, { orgId: orgA }, (tx) => tx.execute(f.insert(orgA)));

    await withTenant(db, { orgId: orgB }, async (tx) => {
      if (f.grants.select) {
        const res = await tx.execute(
          sql`SELECT count(*)::int AS n FROM ${table} WHERE org_id = ${orgA}`,
        );
        expect(res.rows[0]).toEqual({ n: 0 });
      }
    });

    const update = withTenant(db, { orgId: orgB }, (tx) =>
      tx.execute(sql`UPDATE ${table} SET ${f.updateSet!} WHERE org_id = ${orgA}`),
    );
    if (f.grants.update) expect((await update).rowCount).toBe(0);
    else await expectPgError(update, INSUFFICIENT_PRIVILEGE);

    const del = withTenant(db, { orgId: orgB }, (tx) =>
      tx.execute(sql`DELETE FROM ${table} WHERE org_id = ${orgA}`),
    );
    if (f.grants.delete) expect((await del).rowCount).toBe(0);
    else await expectPgError(del, INSUFFICIENT_PRIVILEGE);

    const { rows } = await db.pools.owner.query(
      `SELECT count(*)::int AS n FROM ${f.table} WHERE org_id = $1`,
      [orgA],
    );
    expect(rows[0].n).toBe(f.rowsPerInsert ?? 1);
  });

  it.runIf(f.grants.select)('owner org sees only its own rows', async () => {
    const [orgA, orgB] = (await prepared(newOrgId(), newOrgId())) as [string, string];
    await withTenant(db, { orgId: orgA }, (tx) => tx.execute(f.insert(orgA)));
    await withTenant(db, { orgId: orgB }, (tx) => tx.execute(f.insert(orgB)));
    const res = await withTenant(db, { orgId: orgA }, (tx) =>
      tx.execute(sql`SELECT DISTINCT org_id FROM ${table}`),
    );
    expect(res.rows).toEqual([{ org_id: orgA }]);
  });
});

describe('withTenant guard', () => {
  it('rejects a non-uuid org id before touching the database', async () => {
    await expect(withTenant(db, { orgId: "x' OR 1=1 --" }, async () => 1)).rejects.toThrow(
      TypeError,
    );
  });
});
