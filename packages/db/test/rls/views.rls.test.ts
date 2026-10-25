import { sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '../../src/client';
import { createTestDb, newOrgId } from '../../src/testing';

const db = createTestDb();
afterAll(() => db.close());

/** One org with a unit and a balanced payment entry (100 to collections). */
async function orgWithCollection(orgId: string) {
  const id = (tag: string) => sql`md5(${orgId} || ${tag})::uuid`;
  for (const stmt of [
    sql`INSERT INTO organization (id, name, slug, kind) VALUES (${orgId}, 'Org', ${orgId}, 'landlord')`,
    sql`INSERT INTO client_landlord (id, org_id, is_self, name) VALUES (${orgId}, ${orgId}, true, 'Self')`,
    sql`INSERT INTO property (id, org_id, client_landlord_id, name, kind, county) VALUES (${orgId}, ${orgId}, ${orgId}, 'Block', 'residential', 'Nairobi')`,
    sql`INSERT INTO unit (id, org_id, property_id, code, mode, rent_cents) VALUES (${orgId}, ${orgId}, ${orgId}, 'U1', 'long_term', 100)`,
    sql`INSERT INTO ledger_account (id, org_id, kind) VALUES (${id('col')}, ${orgId}, 'collections'), (${id('inc')}, ${orgId}, 'income_other')`,
  ])
    await db.owner.execute(stmt);
  await db.owner.transaction(async (tx) => {
    await tx.execute(
      sql`INSERT INTO ledger_entry (id, org_id, occurred_on, source, unit_id, idempotency_key) VALUES (${id('e')}, ${orgId}, '2026-10-05', 'payment', ${orgId}, ${orgId})`,
    );
    await tx.execute(
      sql`INSERT INTO ledger_posting (org_id, entry_id, account_id, amount_cents) VALUES (${orgId}, ${id('e')}, ${id('col')}, 100), (${orgId}, ${id('e')}, ${id('inc')}, -100)`,
    );
  });
}

describe('RLS: reporting views (security_invoker)', () => {
  it('report_collection_entry shows only the current org and is read-only', async () => {
    const [a, b] = [newOrgId(), newOrgId()];
    await orgWithCollection(a);
    await orgWithCollection(b);
    const seen = await withTenant(db, { orgId: a }, (tx) =>
      tx.execute(sql`SELECT org_id, amount_cents::int AS amount FROM report_collection_entry`),
    );
    expect(seen.rows).toEqual([{ org_id: a, amount: 100 }]);
    const none = await db.authenticated.execute(
      sql`SELECT count(*)::int AS n FROM report_collection_entry`,
    );
    expect(none.rows[0]).toEqual({ n: 0 });
    // Writes through the view are refused: it is not updatable (55000) and has no write grant.
    const write = await withTenant(db, { orgId: a }, (tx) =>
      tx.execute(sql.raw(`UPDATE report_collection_entry SET amount_cents = 0`)),
    ).then(
      () => null,
      (err: { cause?: { code?: string }; code?: string }) => err.cause?.code ?? err.code,
    );
    expect(['55000', '42501']).toContain(write);
  });
});

const SYNC_VIEWS = [
  'sync_property',
  'sync_unit',
  'sync_meter',
  'sync_meter_reading',
  'sync_ticket',
  'sync_ticket_update',
  'sync_cash_collection',
  'sync_tenant',
  'sync_lease',
];

describe.each(SYNC_VIEWS)('RLS: %s (security_invoker)', (view) => {
  it('shows nothing without an org and only the current org with one', async () => {
    const [a, b] = [newOrgId(), newOrgId()];
    await orgWithCollection(a);
    await orgWithCollection(b);
    const none = await db.authenticated.execute(
      sql`SELECT count(*)::int AS n FROM ${sql.identifier(view)}`,
    );
    expect(none.rows[0]).toEqual({ n: 0 });
    const seen = await withTenant(db, { orgId: a }, (tx) =>
      tx.execute(sql`SELECT DISTINCT org_id FROM ${sql.identifier(view)}`),
    );
    expect(seen.rows.every((r) => r.org_id === a)).toBe(true);
  });
});
