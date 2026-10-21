import { sql, type SQL } from 'drizzle-orm';

/**
 * Every tenant table (has `org_id`, RLS on) MUST register a fixture here — the meta-test fails
 * otherwise. The isolation suite then proves cross-tenant denial for it generically.
 * New module tables add an entry in the same PR as their migration (CLAUDE.md §12.3).
 */
export interface TenantTableFixture {
  table: string;
  /** Owner-role SQL creating FK parents for `orgId` (must be idempotent: ON CONFLICT DO NOTHING). */
  prepare?(orgId: string): SQL[];
  /** INSERT one row for `orgId` with org_id set explicitly. No RETURNING (may lack SELECT). */
  insert(orgId: string): SQL;
  /** Which operations app_authenticated is granted; ungranted ones must fail with 42501. */
  grants: { select: boolean; update: boolean; delete: boolean };
  /** Column assignment used by the UPDATE probe. */
  updateSet?: SQL;
}

// Parents are keyed by the org id itself (org, self landlord, property, user) to stay idempotent.
const org = (orgId: string) =>
  sql`INSERT INTO organization (id, name, slug, kind) VALUES (${orgId}, 'Org', ${orgId}, 'landlord') ON CONFLICT DO NOTHING`;
const landlord = (orgId: string) =>
  sql`INSERT INTO client_landlord (id, org_id, is_self, name) VALUES (${orgId}, ${orgId}, true, 'Self') ON CONFLICT DO NOTHING`;
const property = (orgId: string) =>
  sql`INSERT INTO property (id, org_id, client_landlord_id, name, kind, county) VALUES (${orgId}, ${orgId}, ${orgId}, 'Block', 'residential', 'Nairobi') ON CONFLICT DO NOTHING`;
const user = (orgId: string) =>
  sql`INSERT INTO "user" (id, name, email) VALUES (${orgId}, 'Staff', ${`${orgId}@fixture.test`}) ON CONFLICT DO NOTHING`;
const all =
  (...parts: ((orgId: string) => SQL)[]) =>
  (orgId: string) =>
    parts.map((p) => p(orgId));

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
  {
    table: 'org_profile',
    prepare: all(org),
    insert: (orgId) => sql`INSERT INTO org_profile (org_id, county) VALUES (${orgId}, 'Nairobi')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`county = 'Mombasa'`,
  },
  {
    table: 'client_landlord',
    prepare: all(org),
    insert: (orgId) =>
      sql`INSERT INTO client_landlord (id, org_id, name) VALUES (gen_random_uuid(), ${orgId}, 'Owner')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`name = 'hijacked'`,
  },
  {
    table: 'property',
    prepare: all(org, landlord),
    insert: (orgId) =>
      sql`INSERT INTO property (id, org_id, client_landlord_id, name, kind, county) VALUES (gen_random_uuid(), ${orgId}, ${orgId}, 'P', 'residential', 'Nairobi')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`name = 'hijacked'`,
  },
  {
    table: 'unit',
    prepare: all(org, landlord, property),
    insert: (orgId) =>
      sql`INSERT INTO unit (id, org_id, property_id, code, mode, rent_cents) VALUES (gen_random_uuid(), ${orgId}, ${orgId}, upper(substr(md5(random()::text), 1, 8)), 'long_term', 1000000)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`label = 'hijacked'`,
  },
  {
    table: 'property_staff',
    prepare: all(org, landlord, property, user),
    insert: (orgId) =>
      sql`INSERT INTO property_staff (org_id, property_id, user_id) VALUES (${orgId}, ${orgId}, ${orgId})`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`created_at = now()`,
  },
];
