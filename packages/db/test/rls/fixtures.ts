import { sql, type SQL } from 'drizzle-orm';

/**
 * Every tenant table (has `org_id`, RLS on) MUST register a fixture here — the meta-test fails
 * otherwise. The isolation suite then proves cross-tenant denial for it generically.
 * New module tables add an entry in the same PR as their migration (CLAUDE.md §12.3).
 */
export interface TenantTableFixture {
  table: string;
  /** INSERT one row for `orgId` with org_id set explicitly. No RETURNING (may lack SELECT). */
  insert(orgId: string): SQL;
  /** Which operations app_authenticated is granted; ungranted ones must fail with 42501. */
  grants: { select: boolean; update: boolean; delete: boolean };
  /** Column assignment used by the UPDATE probe. */
  updateSet?: SQL;
}

export const tenantTableFixtures: TenantTableFixture[] = [
  {
    table: '_rls_probe',
    insert: (orgId) => sql`INSERT INTO _rls_probe (org_id, label) VALUES (${orgId}, 'probe')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`label = 'hijacked'`,
  },
  {
    table: 'audit_log',
    insert: (orgId) =>
      sql`INSERT INTO audit_log (org_id, actor_kind, action, entity_type) VALUES (${orgId}, 'system', 'test.created', 'probe')`,
    grants: { select: true, update: false, delete: false },
    updateSet: sql`action = 'tampered'`,
  },
  {
    table: 'outbox',
    insert: (orgId) =>
      sql`INSERT INTO outbox (org_id, topic, payload) VALUES (${orgId}, 'test.event', '{}'::jsonb)`,
    grants: { select: false, update: false, delete: false },
    updateSet: sql`topic = 'tampered'`,
  },
];
