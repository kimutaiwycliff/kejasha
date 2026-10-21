import { sql } from 'drizzle-orm';
import {
  bigint,
  date,
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

// Leasing, invoicing (infra/migrations/…_leasing.sql, …_invoicing.sql). Tenant tables: withTenant().

const ts = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: 'bigint' });
const day = (name: string) => date(name, { mode: 'string' });

export const tenant = pgTable('tenant', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  fullName: text('full_name').notNull(),
  phone: text('phone'),
  email: text('email'),
  nationalId: text('national_id'),
  kraPin: text('kra_pin'),
  nextOfKinName: text('next_of_kin_name'),
  nextOfKinPhone: text('next_of_kin_phone'),
  notes: text('notes'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const lease = pgTable('lease', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  tenantId: uuid('tenant_id').notNull(),
  startDate: day('start_date').notNull(),
  endDate: day('end_date'),
  status: text('status', { enum: ['active', 'terminated', 'cancelled'] })
    .notNull()
    .default('active'),
  rentCents: cents('rent_cents').notNull(),
  depositCents: cents('deposit_cents')
    .notNull()
    .default(sql`0`),
  billingDay: smallint('billing_day').notNull(),
  escalationBps: integer('escalation_bps'),
  escalationEveryMonths: smallint('escalation_every_months'),
  lateFeeKind: text('late_fee_kind', { enum: ['none', 'flat', 'percent'] })
    .notNull()
    .default('none'),
  lateFeeFlatCents: cents('late_fee_flat_cents'),
  lateFeeBps: integer('late_fee_bps'),
  lateFeeGraceDays: smallint('late_fee_grace_days').notNull().default(0),
  notes: text('notes'),
  terminatedAt: ts('terminated_at'),
  terminationReason: text('termination_reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const leaseRentStep = pgTable(
  'lease_rent_step',
  {
    orgId: uuid('org_id').notNull(),
    leaseId: uuid('lease_id').notNull(),
    effectivePeriod: day('effective_period').notNull(),
    rentCents: cents('rent_cents').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leaseId, t.effectivePeriod] })],
);

export const meter = pgTable('meter', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  unitId: uuid('unit_id').notNull(),
  kind: text('kind', { enum: ['water', 'electricity'] }).notNull(),
  serial: text('serial'),
  unitLabel: text('unit_label').notNull().default('units'),
  archivedAt: ts('archived_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const meterReading = pgTable('meter_reading', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  meterId: uuid('meter_id').notNull(),
  readOn: day('read_on').notNull(),
  // numeric(14,3) kept as string end-to-end; converted to milli-units in @kejasha/core.
  reading: numeric('reading', { precision: 14, scale: 3 }).notNull(),
  note: text('note'),
  recordedBy: uuid('recorded_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const chargeRule = pgTable('charge_rule', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  leaseId: uuid('lease_id').notNull(),
  kind: text('kind', {
    enum: ['service_charge', 'garbage', 'water', 'electricity', 'security', 'other'],
  }).notNull(),
  label: text('label').notNull(),
  method: text('method', { enum: ['flat', 'metered'] }).notNull(),
  amountCents: cents('amount_cents'),
  unitPriceCents: cents('unit_price_cents'),
  meterId: uuid('meter_id'),
  startsOn: day('starts_on').notNull(),
  endsOn: day('ends_on'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const orgCounter = pgTable(
  'org_counter',
  {
    orgId: uuid('org_id').notNull(),
    name: text('name').notNull(),
    value: bigint('value', { mode: 'bigint' })
      .notNull()
      .default(sql`0`),
  },
  (t) => [primaryKey({ columns: [t.orgId, t.name] })],
);

export const invoice = pgTable('invoice', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  leaseId: uuid('lease_id').notNull(),
  number: text('number').notNull(),
  kind: text('kind', { enum: ['periodic', 'deposit', 'late_fee', 'manual'] }).notNull(),
  period: day('period'),
  sourceInvoiceId: uuid('source_invoice_id'),
  issuedOn: day('issued_on').notNull(),
  dueOn: day('due_on').notNull(),
  totalCents: cents('total_cents').notNull(),
  status: text('status', { enum: ['issued', 'void'] })
    .notNull()
    .default('issued'),
  ledgerEntryId: uuid('ledger_entry_id').notNull(),
  voidEntryId: uuid('void_entry_id'),
  voidedAt: ts('voided_at'),
  voidReason: text('void_reason'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const invoiceLine = pgTable('invoice_line', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  kind: text('kind', {
    enum: [
      'rent',
      'deposit',
      'service_charge',
      'garbage',
      'water',
      'electricity',
      'security',
      'late_fee',
      'other',
    ],
  }).notNull(),
  description: text('description').notNull(),
  quantity: numeric('quantity', { precision: 14, scale: 3 }).notNull().default('1'),
  unitPriceCents: cents('unit_price_cents'),
  amountCents: cents('amount_cents').notNull(),
  chargeRuleId: uuid('charge_rule_id'),
  meterId: uuid('meter_id'),
  readingFromId: uuid('reading_from_id'),
  readingToId: uuid('reading_to_id'),
  periodStart: day('period_start'),
  periodEnd: day('period_end'),
});

export const creditNote = pgTable('credit_note', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  leaseId: uuid('lease_id').notNull(),
  invoiceId: uuid('invoice_id'),
  number: text('number').notNull(),
  amountCents: cents('amount_cents').notNull(),
  reason: text('reason').notNull(),
  issuedOn: day('issued_on').notNull(),
  ledgerEntryId: uuid('ledger_entry_id').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const depositSettlement = pgTable('deposit_settlement', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  leaseId: uuid('lease_id').notNull(),
  settledOn: day('settled_on').notNull(),
  depositHeldCents: cents('deposit_held_cents').notNull(),
  deductions: jsonb('deductions').$type<{ description: string; amountCents: number }[]>().notNull(),
  deductionsCents: cents('deductions_cents').notNull(),
  appliedToArrearsCents: cents('applied_to_arrears_cents').notNull(),
  refundDueCents: cents('refund_due_cents').notNull(),
  ledgerEntryId: uuid('ledger_entry_id').notNull(),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const leaseInspection = pgTable('lease_inspection', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  leaseId: uuid('lease_id').notNull(),
  kind: text('kind', { enum: ['move_in', 'move_out'] }).notNull(),
  inspectedOn: day('inspected_on').notNull(),
  items: jsonb('items')
    .$type<
      {
        area: string;
        condition: 'good' | 'fair' | 'poor' | 'damaged';
        note?: string;
        photoKeys: string[];
      }[]
    >()
    .notNull(),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
