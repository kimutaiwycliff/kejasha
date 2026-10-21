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
  /** Rows one `insert` creates (ledger postings come in balanced pairs). Default 1. */
  rowsPerInsert?: number;
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
const uid = (orgId: string, tag: string) => sql`md5(${orgId} || ${tag})::uuid`;
const unit = (orgId: string) =>
  sql`INSERT INTO unit (id, org_id, property_id, code, mode, rent_cents) VALUES (${orgId}, ${orgId}, ${orgId}, 'FX1', 'long_term', 100) ON CONFLICT DO NOTHING`;
const tenant = (orgId: string) =>
  sql`INSERT INTO tenant (id, org_id, full_name) VALUES (${orgId}, ${orgId}, 'Fixture Tenant') ON CONFLICT DO NOTHING`;
const lease = (orgId: string) =>
  sql`INSERT INTO lease (id, org_id, unit_id, tenant_id, start_date, rent_cents, billing_day) VALUES (${orgId}, ${orgId}, ${orgId}, ${orgId}, '2026-01-01', 100, 1) ON CONFLICT DO NOTHING`;
const meter = (orgId: string) =>
  sql`INSERT INTO meter (id, org_id, unit_id, kind) VALUES (${orgId}, ${orgId}, ${orgId}, 'water') ON CONFLICT DO NOTHING`;
const entry = (orgId: string) =>
  sql`INSERT INTO ledger_entry (id, org_id, occurred_on, source, idempotency_key) VALUES (${uid(orgId, 'entry')}, ${orgId}, '2026-01-01', 'adjustment', ${orgId}) ON CONFLICT DO NOTHING`;
const accounts = (orgId: string) =>
  sql`INSERT INTO ledger_account (id, org_id, kind) VALUES (${uid(orgId, 'a1')}, ${orgId}, 'income_rent'), (${uid(orgId, 'a2')}, ${orgId}, 'income_other') ON CONFLICT DO NOTHING`;
const invoice = (orgId: string) =>
  sql`INSERT INTO invoice (id, org_id, lease_id, number, kind, issued_on, due_on, total_cents, ledger_entry_id) VALUES (${uid(orgId, 'inv')}, ${orgId}, ${orgId}, 'FX-1', 'manual', '2026-01-01', '2026-01-01', 100, ${uid(orgId, 'entry')}) ON CONFLICT DO NOTHING`;
const channel = (orgId: string) =>
  sql`INSERT INTO payment_channel (id, org_id, kind, shortcode, display_name, channel_token) VALUES (${uid(orgId, 'ch')}, ${orgId}, 'paybill', '600000', 'Fixture', ${`tok-${orgId}`}) ON CONFLICT DO NOTHING`;
const ssUnit = (orgId: string) =>
  sql`INSERT INTO unit (id, org_id, property_id, code, mode, base_nightly_cents) VALUES (${uid(orgId, 'ss')}, ${orgId}, ${orgId}, 'SS1', 'short_stay', 100) ON CONFLICT DO NOTHING`;
const portfolio = [org, landlord, property, unit, tenant];

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
  {
    table: 'tenant',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO tenant (id, org_id, full_name) VALUES (gen_random_uuid(), ${o}, 'T')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`full_name = 'hijacked'`,
  },
  {
    table: 'lease',
    prepare: all(...portfolio),
    insert: (o) =>
      sql`INSERT INTO lease (id, org_id, unit_id, tenant_id, start_date, rent_cents, billing_day) VALUES (gen_random_uuid(), ${o}, ${o}, ${o}, '2026-01-01', 100, 1)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`notes = 'hijacked'`,
  },
  {
    table: 'lease_rent_step',
    prepare: all(...portfolio, lease),
    insert: (o) =>
      sql`INSERT INTO lease_rent_step (org_id, lease_id, effective_period, rent_cents) VALUES (${o}, ${o}, make_date(2027, 1 + floor(random() * 11)::int, 1), 1)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`rent_cents = 0`,
  },
  {
    table: 'meter',
    prepare: all(...portfolio),
    insert: (o) =>
      sql`INSERT INTO meter (id, org_id, unit_id, kind, archived_at) VALUES (gen_random_uuid(), ${o}, ${o}, 'water', now())`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`serial = 'hijacked'`,
  },
  {
    table: 'meter_reading',
    prepare: all(...portfolio, meter),
    insert: (o) =>
      sql`INSERT INTO meter_reading (id, org_id, meter_id, read_on, reading) VALUES (gen_random_uuid(), ${o}, ${o}, current_date - (random() * 3000)::int, 1)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`reading = 0`,
  },
  {
    table: 'charge_rule',
    prepare: all(...portfolio, lease),
    insert: (o) =>
      sql`INSERT INTO charge_rule (id, org_id, lease_id, kind, label, method, amount_cents, starts_on) VALUES (gen_random_uuid(), ${o}, ${o}, 'garbage', 'Garbage', 'flat', 1, '2026-01-01')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`label = 'hijacked'`,
  },
  {
    table: 'org_counter',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO org_counter (org_id, name) VALUES (${o}, gen_random_uuid()::text)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`value = 99`,
  },
  {
    table: 'ledger_account',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO ledger_account (id, org_id, kind) VALUES (gen_random_uuid(), ${o}, 'income_water')`,
    grants: { select: true, update: false, delete: false },
    updateSet: sql`kind = 'income_rent'`,
  },
  {
    table: 'ledger_entry',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO ledger_entry (id, org_id, occurred_on, source, idempotency_key) VALUES (gen_random_uuid(), ${o}, '2026-01-01', 'adjustment', gen_random_uuid()::text)`,
    grants: { select: true, update: false, delete: false },
    updateSet: sql`memo = 'tampered'`,
  },
  {
    table: 'ledger_posting',
    prepare: all(org, accounts, entry),
    insert: (o) =>
      sql`INSERT INTO ledger_posting (org_id, entry_id, account_id, amount_cents) VALUES (${o}, ${uid(o, 'entry')}, ${uid(o, 'a1')}, -100), (${o}, ${uid(o, 'entry')}, ${uid(o, 'a2')}, 100)`,
    grants: { select: true, update: false, delete: false },
    updateSet: sql`amount_cents = 1`,
    rowsPerInsert: 2,
  },
  {
    table: 'invoice',
    prepare: all(...portfolio, lease, entry),
    insert: (o) =>
      sql`INSERT INTO invoice (id, org_id, lease_id, number, kind, issued_on, due_on, total_cents, ledger_entry_id) VALUES (gen_random_uuid(), ${o}, ${o}, gen_random_uuid()::text, 'manual', '2026-01-01', '2026-01-01', 100, ${uid(o, 'entry')})`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`total_cents = 1`,
  },
  {
    table: 'invoice_line',
    prepare: all(...portfolio, lease, entry, invoice),
    insert: (o) =>
      sql`INSERT INTO invoice_line (id, org_id, invoice_id, kind, description, amount_cents) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'inv')}, 'rent', 'Rent', 100)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`amount_cents = 1`,
  },
  {
    table: 'credit_note',
    prepare: all(...portfolio, lease, entry),
    insert: (o) =>
      sql`INSERT INTO credit_note (id, org_id, lease_id, number, amount_cents, reason, issued_on, ledger_entry_id) VALUES (gen_random_uuid(), ${o}, ${o}, gen_random_uuid()::text, 1, 'r', '2026-01-01', ${uid(o, 'entry')})`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`reason = 'hijacked'`,
  },
  {
    table: 'deposit_settlement',
    prepare: all(...portfolio, lease, entry),
    insert: (o) =>
      sql`INSERT INTO deposit_settlement (id, org_id, lease_id, settled_on, deposit_held_cents, deductions_cents, applied_to_arrears_cents, refund_due_cents, ledger_entry_id) VALUES (gen_random_uuid(), ${o}, ${o}, '2026-01-01', 0, 0, 0, 0, ${uid(o, 'entry')})`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`settled_on = '2026-02-01'`,
  },
  {
    table: 'lease_inspection',
    prepare: all(...portfolio, lease),
    insert: (o) =>
      sql`INSERT INTO lease_inspection (id, org_id, lease_id, kind, inspected_on) VALUES (gen_random_uuid(), ${o}, ${o}, 'move_in', '2026-01-01')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`notes = 'hijacked'`,
  },
  {
    table: 'payment_channel',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO payment_channel (id, org_id, kind, shortcode, display_name, channel_token) VALUES (gen_random_uuid(), ${o}, 'till', (100000 + floor(random() * 899999))::text, 'Till', gen_random_uuid()::text)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`display_name = 'hijacked'`,
  },
  {
    table: 'payment',
    prepare: all(org, channel),
    insert: (o) =>
      sql`INSERT INTO payment (id, org_id, channel_id, source, provider_ref, amount_cents, paid_at) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ch')}, 'c2b', gen_random_uuid()::text, 100, now())`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`notes = 'hijacked'`,
  },
  {
    table: 'payment_callback',
    prepare: all(org, channel),
    insert: (o) =>
      sql`INSERT INTO payment_callback (id, org_id, channel_id, kind, body) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ch')}, 'c2b_confirmation', '{}'::jsonb)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`outcome = 'hijacked'`,
  },
  {
    table: 'stk_request',
    prepare: all(org, channel),
    insert: (o) =>
      sql`INSERT INTO stk_request (id, org_id, channel_id, msisdn, amount_cents, account_ref) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ch')}, '+254712345678', 100, 'A1')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`result_desc = 'hijacked'`,
  },
  {
    table: 'statement_import',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO statement_import (id, org_id, file_key, format, status) VALUES (gen_random_uuid(), ${o}, 'k', 'mpesa_business_csv', 'parsed')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`error = 'hijacked'`,
  },
  {
    table: 'rate_plan',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO rate_plan (org_id, unit_id, base_nightly_cents) VALUES (${o}, ${uid(o, 'ss')}, 100)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`min_stay_nights = 9`,
  },
  {
    table: 'rate_override',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO rate_override (id, org_id, unit_id, label, starts_on, ends_on, nightly_cents) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ss')}, 'Season', '2026-12-01', '2026-12-31', 100)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`label = 'hijacked'`,
  },
  {
    table: 'guest',
    prepare: all(org),
    insert: (o) =>
      sql`INSERT INTO guest (id, org_id, full_name) VALUES (gen_random_uuid(), ${o}, 'G')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`full_name = 'hijacked'`,
  },
  {
    table: 'ical_feed',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO ical_feed (id, org_id, unit_id, source, url) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ss')}, 'airbnb', 'https://example.test/x.ics')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`url = 'https://evil.test'`,
  },
  {
    table: 'booking',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO booking (id, org_id, unit_id, check_in, check_out, source) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ss')}, '2026-11-01', '2026-11-03', 'direct')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`notes = 'hijacked'`,
  },
  {
    table: 'calendar_block',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO calendar_block (id, org_id, unit_id, starts_on, ends_on, reason) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ss')}, '2026-12-01', '2026-12-05', 'owner_use')`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`note = 'hijacked'`,
  },
  {
    // Occupancy is written only by booking/block triggers: inserting a block creates the row.
    table: 'unit_occupancy',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO calendar_block (id, org_id, unit_id, starts_on, ends_on, reason) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ss')}, '2027-01-01', '2027-01-03', 'maintenance')`,
    grants: { select: true, update: false, delete: false },
    updateSet: sql`unit_id = unit_id`,
  },
  {
    table: 'unit_expense',
    prepare: all(org, landlord, property, ssUnit),
    insert: (o) =>
      sql`INSERT INTO unit_expense (id, org_id, unit_id, incurred_on, category, amount_cents) VALUES (gen_random_uuid(), ${o}, ${uid(o, 'ss')}, '2026-10-01', 'wifi', 100)`,
    grants: { select: true, update: true, delete: true },
    updateSet: sql`description = 'hijacked'`,
  },
];
