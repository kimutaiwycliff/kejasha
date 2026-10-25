import {
  bigint,
  boolean,
  customType,
  date,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

// SaaS billing and platform operators (infra/migrations/…_billing_operator.sql).
// plan, paystack_event and platform_operator are platform tables (owner role only).

const ts = (name: string) => timestamp(name, { withTimezone: true });
const cents = (name: string) => bigint(name, { mode: 'bigint' });
const day = (name: string) => date(name, { mode: 'string' });
const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const PLAN_CODES = ['landlord', 'host', 'agency'] as const;
export const SUBSCRIPTION_STATUSES = [
  'incomplete',
  'trialing',
  'active',
  'past_due',
  'suspended',
  'cancelled',
] as const;

export const plan = pgTable('plan', {
  code: text('code', { enum: PLAN_CODES }).primaryKey(),
  name: text('name').notNull(),
  baseCents: cents('base_cents').notNull(),
  unitPriceCents: cents('unit_price_cents').notNull(),
  listingPriceCents: cents('listing_price_cents').notNull(),
  minimumCents: cents('minimum_cents').notNull(),
  whiteLabel: boolean('white_label').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const subscription = pgTable('subscription', {
  orgId: uuid('org_id').primaryKey(),
  planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
  status: text('status', { enum: SUBSCRIPTION_STATUSES }).notNull().default('incomplete'),
  trialEndsOn: day('trial_ends_on'),
  currentPeriodStart: day('current_period_start'),
  currentPeriodEnd: day('current_period_end'),
  billingEmail: text('billing_email'),
  paystackCustomerCode: text('paystack_customer_code'),
  authorizationCiphertext: bytea('authorization_ciphertext'),
  cardBrand: text('card_brand'),
  cardLast4: text('card_last4'),
  pastDueSince: day('past_due_since'),
  cancelledAt: ts('cancelled_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const subscriptionInvoice = pgTable('subscription_invoice', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  number: text('number').notNull(),
  planCode: text('plan_code', { enum: PLAN_CODES }).notNull(),
  periodStart: day('period_start').notNull(),
  periodEnd: day('period_end').notNull(),
  units: integer('units').notNull(),
  listings: integer('listings').notNull(),
  amountCents: cents('amount_cents').notNull(),
  status: text('status', { enum: ['open', 'paid', 'void'] })
    .notNull()
    .default('open'),
  reference: text('reference').notNull(),
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: ts('last_attempt_at'),
  paidAt: ts('paid_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const subscriptionPayment = pgTable('subscription_payment', {
  id: uuid('id').primaryKey(),
  orgId: uuid('org_id').notNull(),
  invoiceId: uuid('invoice_id').notNull(),
  reference: text('reference').notNull(),
  amountCents: cents('amount_cents').notNull(),
  channel: text('channel'),
  paidAt: ts('paid_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const paystackEvent = pgTable('paystack_event', {
  id: uuid('id').primaryKey(),
  event: text('event').notNull(),
  reference: text('reference'),
  body: jsonb('body').notNull(),
  signatureOk: boolean('signature_ok').notNull(),
  outcome: text('outcome'),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

export const platformOperator = pgTable('platform_operator', {
  userId: uuid('user_id').primaryKey(),
  note: text('note'),
  grantedAt: ts('granted_at').notNull().defaultNow(),
});

export const operatorAccessLog = pgTable('operator_access_log', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: uuid('user_id').notNull(),
  method: text('method').notNull(),
  route: text('route').notNull(),
  targetOrg: uuid('target_org'),
  requestId: text('request_id'),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});
