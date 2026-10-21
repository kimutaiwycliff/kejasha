import {
  bigint,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// Payments (infra/migrations/…_payments.sql). Tenant tables: withTenant().

const ts = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: 'bigint' });
const bytea = customType<{ data: Buffer; driverData: Buffer }>({ dataType: () => 'bytea' });

export const paymentChannel = pgTable('payment_channel', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  clientLandlordId: uuid('client_landlord_id'),
  kind: text('kind', { enum: ['paybill', 'till', 'phone'] }).notNull(),
  shortcode: text('shortcode').notNull(),
  displayName: text('display_name').notNull(),
  status: text('status', { enum: ['active', 'disabled'] })
    .notNull()
    .default('active'),
  channelToken: text('channel_token').notNull(),
  darajaEnv: text('daraja_env', { enum: ['sandbox', 'production'] })
    .notNull()
    .default('sandbox'),
  credentialsKeyVersion: smallint('credentials_key_version'),
  credentialsWrappedKey: bytea('credentials_wrapped_key'),
  credentialsCiphertext: bytea('credentials_ciphertext'),
  credentialsUpdatedAt: ts('credentials_updated_at'),
  c2bRegisteredAt: ts('c2b_registered_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const statementImport = pgTable('statement_import', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  channelId: uuid('channel_id'),
  fileKey: text('file_key').notNull(),
  fileName: text('file_name'),
  format: text('format', { enum: ['mpesa_business_csv', 'mpesa_statement_pdf'] }).notNull(),
  status: text('status', { enum: ['parsed', 'failed'] }).notNull(),
  rowsTotal: integer('rows_total').notNull().default(0),
  rowsCredits: integer('rows_credits').notNull().default(0),
  rowsNew: integer('rows_new').notNull().default(0),
  rowsDuplicate: integer('rows_duplicate').notNull().default(0),
  rowsMatched: integer('rows_matched').notNull().default(0),
  periodFrom: date('period_from', { mode: 'string' }),
  periodTo: date('period_to', { mode: 'string' }),
  error: text('error'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const payment = pgTable('payment', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  channelId: uuid('channel_id'),
  source: text('source', { enum: ['c2b', 'stk', 'statement_import', 'sms', 'manual'] }).notNull(),
  method: text('method', { enum: ['mpesa', 'cash', 'bank', 'other'] })
    .notNull()
    .default('mpesa'),
  providerRef: text('provider_ref').notNull(),
  amountCents: cents('amount_cents').notNull(),
  paidAt: ts('paid_at').notNull(),
  msisdn: text('msisdn'),
  payerName: text('payer_name'),
  accountRef: text('account_ref'),
  raw: jsonb('raw'),
  importId: uuid('import_id'),
  matchStatus: text('match_status', { enum: ['unmatched', 'matched', 'ignored'] })
    .notNull()
    .default('unmatched'),
  matchMethod: text('match_method', { enum: ['auto_account', 'auto_phone', 'manual'] }),
  leaseId: uuid('lease_id'),
  bookingId: uuid('booking_id'),
  matchedBy: uuid('matched_by'),
  matchedAt: ts('matched_at'),
  ledgerEntryId: uuid('ledger_entry_id'),
  receiptNumber: text('receipt_number'),
  receiptFileKey: text('receipt_file_key'),
  ignoreReason: text('ignore_reason'),
  notes: text('notes'),
  createdBy: uuid('created_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const paymentCallback = pgTable('payment_callback', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  kind: text('kind', { enum: ['c2b_validation', 'c2b_confirmation', 'stk_result'] }).notNull(),
  body: jsonb('body').notNull(),
  sourceIp: text('source_ip'),
  receivedAt: ts('received_at').notNull().defaultNow(),
  outcome: text('outcome'),
  paymentId: uuid('payment_id'),
});

export const stkRequest = pgTable('stk_request', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  channelId: uuid('channel_id').notNull(),
  leaseId: uuid('lease_id'),
  bookingId: uuid('booking_id'),
  invoiceId: uuid('invoice_id'),
  msisdn: text('msisdn').notNull(),
  amountCents: cents('amount_cents').notNull(),
  accountRef: text('account_ref').notNull(),
  merchantRequestId: text('merchant_request_id'),
  checkoutRequestId: text('checkout_request_id'),
  status: text('status', { enum: ['pending', 'succeeded', 'failed', 'cancelled', 'timeout'] })
    .notNull()
    .default('pending'),
  resultCode: text('result_code'),
  resultDesc: text('result_desc'),
  paymentId: uuid('payment_id'),
  requestedBy: uuid('requested_by'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
