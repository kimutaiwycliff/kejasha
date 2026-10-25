import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Short-stay (infra/migrations/…_short_stay.sql). Tenant tables: withTenant().
// unit_occupancy is written only by triggers on booking/calendar_block (read-only to tenants).

const ts = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: 'bigint' });
const day = (name: string) => date(name, { mode: 'string' });

export const BOOKING_SOURCES = [
  'direct',
  'walk_in',
  'whatsapp',
  'airbnb',
  'booking',
  'other',
] as const;
export const BOOKING_STATUSES = [
  'confirmed',
  'checked_in',
  'checked_out',
  'cancelled',
  'no_show',
] as const;
export const EXPENSE_CATEGORIES = [
  'tokens',
  'wifi',
  'cleaning',
  'supplies',
  'repair',
  'licence',
  'laundry',
  'other',
] as const;

export const ratePlan = pgTable('rate_plan', {
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').primaryKey(),
  baseNightlyCents: cents('base_nightly_cents').notNull(),
  weekendNightlyCents: cents('weekend_nightly_cents'),
  minStayNights: smallint('min_stay_nights').notNull().default(1),
  bufferDays: smallint('buffer_days').notNull().default(0),
  cleaningFeeCents: cents('cleaning_fee_cents').notNull(),
  checkinInstructions: text('checkin_instructions'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const rateOverride = pgTable('rate_override', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  label: text('label').notNull(),
  startsOn: day('starts_on').notNull(),
  endsOn: day('ends_on').notNull(),
  nightlyCents: cents('nightly_cents').notNull(),
  minStayNights: smallint('min_stay_nights'),
});

export const guest = pgTable('guest', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  idNumber: text('id_number'),
  nationality: text('nationality'),
  notes: text('notes'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const icalFeed = pgTable('ical_feed', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  source: text('source', { enum: ['airbnb', 'booking', 'other'] }).notNull(),
  url: text('url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  etag: text('etag'),
  lastModified: text('last_modified'),
  lastSyncedAt: ts('last_synced_at'),
  lastStatus: text('last_status', { enum: ['ok', 'not_modified', 'error'] }),
  lastError: text('last_error'),
  conflicts: jsonb('conflicts')
    .$type<{ uid: string; start: string; end: string; summary: string }[]>()
    .notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const booking = pgTable('booking', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  guestId: uuid('guest_id'),
  checkIn: day('check_in').notNull(),
  checkOut: day('check_out').notNull(),
  bufferDays: smallint('buffer_days').notNull().default(0),
  source: text('source', { enum: BOOKING_SOURCES }).notNull(),
  status: text('status', { enum: BOOKING_STATUSES }).notNull().default('confirmed'),
  guestsCount: smallint('guests_count').notNull().default(1),
  grossCents: cents('gross_cents').notNull(),
  cleaningFeeCents: cents('cleaning_fee_cents').notNull(),
  commissionBps: integer('commission_bps').notNull().default(0),
  commissionCents: cents('commission_cents').notNull(),
  notes: text('notes'),
  icalFeedId: uuid('ical_feed_id'),
  externalUid: text('external_uid'),
  ledgerEntryId: uuid('ledger_entry_id'),
  cancelledAt: ts('cancelled_at'),
  cancelReason: text('cancel_reason'),
  checkedInAt: ts('checked_in_at'),
  checkedOutAt: ts('checked_out_at'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const calendarBlock = pgTable('calendar_block', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  startsOn: day('starts_on').notNull(),
  endsOn: day('ends_on').notNull(),
  reason: text('reason', { enum: ['owner_use', 'maintenance', 'ical', 'other'] }).notNull(),
  note: text('note'),
  icalFeedId: uuid('ical_feed_id'),
  externalUid: text('external_uid'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const unitExpense = pgTable('unit_expense', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  /** Null for property-wide costs (common areas). */
  unitId: uuid('unit_id'),
  bookingId: uuid('booking_id'),
  maintenanceTicketId: uuid('maintenance_ticket_id'),
  incurredOn: day('incurred_on').notNull(),
  category: text('category', { enum: EXPENSE_CATEGORIES }).notNull(),
  amountCents: cents('amount_cents').notNull(),
  description: text('description'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
