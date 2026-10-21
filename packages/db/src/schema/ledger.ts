import { bigint, date, pgTable, pgView, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// Ledger (infra/migrations/…_ledger.sql). Append-only; written only by the ledger module.

export const LEDGER_ACCOUNT_KINDS = [
  'lease_receivable',
  'lease_deposit',
  'income_rent',
  'income_service_charge',
  'income_garbage',
  'income_water',
  'income_electricity',
  'income_security',
  'income_late_fee',
  'income_deposit_deductions',
  'income_other',
  'deposit_refund_payable',
  'collections',
  'booking_receivable',
  'income_short_stay',
] as const;
export type LedgerAccountKind = (typeof LEDGER_ACCOUNT_KINDS)[number];

export const LEDGER_SOURCES = [
  'invoice',
  'invoice_void',
  'credit_note',
  'deposit_settlement',
  'payment',
  'payment_reversal',
  'adjustment',
  'booking',
  'booking_cancellation',
] as const;
export type LedgerSource = (typeof LEDGER_SOURCES)[number];

export const ledgerAccount = pgTable('ledger_account', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  kind: text('kind', { enum: LEDGER_ACCOUNT_KINDS }).notNull(),
  leaseId: uuid('lease_id'),
  bookingId: uuid('booking_id'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const ledgerEntry = pgTable('ledger_entry', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  occurredOn: date('occurred_on', { mode: 'string' }).notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
  source: text('source', { enum: LEDGER_SOURCES }).notNull(),
  sourceId: uuid('source_id'),
  leaseId: uuid('lease_id'),
  unitId: uuid('unit_id'),
  bookingId: uuid('booking_id'),
  memo: text('memo'),
  idempotencyKey: text('idempotency_key').notNull(),
  reversesEntryId: uuid('reverses_entry_id'),
  createdBy: uuid('created_by'),
});

export const ledgerPosting = pgTable('ledger_posting', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull(),
  entryId: uuid('entry_id').notNull(),
  accountId: uuid('account_id').notNull(),
  amountCents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
});

export const ledgerAccountBalance = pgView('ledger_account_balance', {
  accountId: uuid('account_id').notNull(),
  orgId: uuid('org_id').notNull(),
  kind: text('kind', { enum: LEDGER_ACCOUNT_KINDS }).notNull(),
  leaseId: uuid('lease_id'),
  balanceCents: bigint('balance_cents', { mode: 'bigint' }).notNull(),
}).existing();
