import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Accounts module tables (infra/migrations/…_portfolio.sql). Tenant tables: use via withTenant().

const ts = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: 'bigint' });

export const orgProfile = pgTable('org_profile', {
  orgId: uuid('org_id').primaryKey(),
  kraPin: text('kra_pin'),
  phone: text('phone'),
  email: text('email'),
  county: text('county'),
  branding: jsonb('branding').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const clientLandlord = pgTable('client_landlord', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  isSelf: boolean('is_self').notNull().default(false),
  name: text('name').notNull(),
  phone: text('phone'),
  email: text('email'),
  kraPin: text('kra_pin'),
  mgmtFeeKind: text('mgmt_fee_kind', { enum: ['none', 'percent', 'flat'] })
    .notNull()
    .default('none'),
  mgmtFeeBps: integer('mgmt_fee_bps'),
  mgmtFeeFlatCents: cents('mgmt_fee_flat_cents'),
  notes: text('notes'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const property = pgTable('property', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  clientLandlordId: uuid('client_landlord_id').notNull(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['residential', 'commercial', 'mixed'] }).notNull(),
  county: text('county').notNull(),
  area: text('area'),
  address: text('address'),
  latitude: numeric('latitude', { precision: 9, scale: 6, mode: 'number' }),
  longitude: numeric('longitude', { precision: 9, scale: 6, mode: 'number' }),
  notes: text('notes'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const unit = pgTable('unit', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  code: text('code').notNull(),
  label: text('label'),
  mode: text('mode', { enum: ['long_term', 'short_stay'] }).notNull(),
  status: text('status', { enum: ['active', 'inactive'] })
    .notNull()
    .default('active'),
  bedrooms: smallint('bedrooms'),
  bathrooms: smallint('bathrooms'),
  floor: text('floor'),
  sizeSqm: integer('size_sqm'),
  rentCents: cents('rent_cents'),
  depositCents: cents('deposit_cents'),
  baseNightlyCents: cents('base_nightly_cents'),
  maxGuests: smallint('max_guests'),
  notes: text('notes'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const propertyStaff = pgTable(
  'property_staff',
  {
    orgId: uuid('org_id').notNull(),
    propertyId: uuid('property_id').notNull(),
    userId: uuid('user_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.propertyId, t.userId] })],
);
