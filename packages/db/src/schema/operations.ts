import { bigint, date, jsonb, pgTable, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Operations, compliance and reporting (infra/migrations/…_ops_compliance.sql). Tenant tables.

const ts = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: 'bigint' });
const day = (name: string) => date(name, { mode: 'string' });

export const TICKET_CATEGORIES = [
  'plumbing',
  'electrical',
  'structural',
  'appliance',
  'pest',
  'cleaning',
  'security',
  'other',
] as const;
export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'cancelled'] as const;
export const LICENCE_KINDS = ['tra_short_stay', 'county_business_permit', 'other'] as const;

export const maintenanceTicket = pgTable('maintenance_ticket', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  number: text('number').notNull(),
  propertyId: uuid('property_id').notNull(),
  unitId: uuid('unit_id'),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category', { enum: TICKET_CATEGORIES }).notNull(),
  priority: text('priority', { enum: TICKET_PRIORITIES }).notNull().default('normal'),
  status: text('status', { enum: TICKET_STATUSES }).notNull().default('open'),
  reporterKind: text('reporter_kind', { enum: ['staff', 'caretaker', 'tenant'] }).notNull(),
  reportedBy: uuid('reported_by'),
  tenantId: uuid('tenant_id'),
  assigneeUserId: uuid('assignee_user_id'),
  assigneeName: text('assignee_name'),
  costCents: cents('cost_cents'),
  resolvedAt: ts('resolved_at'),
  closedAt: ts('closed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const maintenanceUpdate = pgTable('maintenance_update', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  ticketId: uuid('ticket_id').notNull(),
  authorId: uuid('author_id'),
  note: text('note'),
  statusFrom: text('status_from'),
  statusTo: text('status_to'),
  photoKeys: text('photo_keys').array().notNull().default([]),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const cashCollection = pgTable('cash_collection', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  leaseId: uuid('lease_id'),
  bookingId: uuid('booking_id'),
  amountCents: cents('amount_cents').notNull(),
  receivedOn: day('received_on').notNull(),
  payerName: text('payer_name'),
  note: text('note'),
  receiptKey: text('receipt_key'),
  status: text('status', { enum: ['pending', 'confirmed', 'rejected'] })
    .notNull()
    .default('pending'),
  submittedBy: uuid('submitted_by').notNull(),
  decidedBy: uuid('decided_by'),
  decidedAt: ts('decided_at'),
  rejectReason: text('reject_reason'),
  paymentId: uuid('payment_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const mriFiling = pgTable('mri_filing', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  clientLandlordId: uuid('client_landlord_id').notNull(),
  /** First day of the month filed. */
  period: day('period').notNull(),
  rentCents: cents('rent_cents').notNull(),
  taxCents: cents('tax_cents').notNull(),
  filedOn: day('filed_on').notNull(),
  kraReference: text('kra_reference'),
  details: jsonb('details').$type<unknown[]>().notNull(),
  filedBy: uuid('filed_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const licence = pgTable('licence', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  unitId: uuid('unit_id'),
  kind: text('kind', { enum: LICENCE_KINDS }).notNull(),
  number: text('number'),
  issuer: text('issuer'),
  issuedOn: day('issued_on'),
  expiresOn: day('expires_on').notNull(),
  feeCents: cents('fee_cents'),
  documentKey: text('document_key'),
  notes: text('notes'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const memberScope = pgTable('member_scope', {
  orgId: uuid('org_id').notNull(),
  userId: uuid('user_id').notNull(),
  clientLandlordId: uuid('client_landlord_id').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Collections leg of payment entries (and reversals), with the unit's property and landlord. */
export const reportCollectionEntry = pgView('report_collection_entry', {
  orgId: uuid('org_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  occurredOn: day('occurred_on').notNull(),
  source: text('source', { enum: ['payment', 'payment_reversal'] }).notNull(),
  paymentId: uuid('payment_id'),
  leaseId: uuid('lease_id'),
  bookingId: uuid('booking_id'),
  unitId: uuid('unit_id').notNull(),
  propertyId: uuid('property_id').notNull(),
  clientLandlordId: uuid('client_landlord_id').notNull(),
  amountCents: cents('amount_cents').notNull(),
}).existing();
