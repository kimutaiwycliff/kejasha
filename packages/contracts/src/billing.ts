import { z } from 'zod';
import { Cents, CursorQuery, IdInput, IsoDate, pageOf, SafeString, Timestamp } from './common';
import { Email } from './kenya';

export const PlanCode = z.enum(['landlord', 'host', 'agency']).meta({ id: 'PlanCode' });
export const SubscriptionStatus = z
  .enum(['incomplete', 'trialing', 'active', 'past_due', 'suspended', 'cancelled'])
  .meta({
    id: 'SubscriptionStatus',
    description:
      'incomplete = not paid yet (setup only); past_due = renewal unpaid (grace, all works); suspended = writes blocked, reads allowed',
  });

export const Plan = z
  .object({
    code: PlanCode,
    name: z.string(),
    baseCents: Cents,
    unitPriceCents: Cents.meta({ description: 'Per occupied long-term unit per month' }),
    listingPriceCents: Cents.meta({ description: 'Per active short-stay listing per month' }),
    minimumCents: Cents,
    whiteLabel: z.boolean(),
  })
  .meta({ id: 'Plan' });

export const SubscriptionInvoice = z
  .object({
    id: z.uuid(),
    number: z.string(),
    planCode: PlanCode,
    periodStart: IsoDate,
    periodEnd: IsoDate,
    units: z.int(),
    listings: z.int(),
    amountCents: Cents,
    status: z.enum(['open', 'paid', 'void']),
    reference: z.string(),
    attempts: z.int(),
    paidAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .meta({ id: 'SubscriptionInvoice' });
export const SubscriptionInvoicePage = pageOf(SubscriptionInvoice, 'SubscriptionInvoice');

export const Billing = z
  .object({
    plan: Plan,
    status: SubscriptionStatus,
    trialEndsOn: IsoDate.nullable(),
    currentPeriodStart: IsoDate.nullable(),
    currentPeriodEnd: IsoDate.nullable(),
    pastDueSince: IsoDate.nullable(),
    usage: z.object({ units: z.int(), listings: z.int() }),
    nextAmountCents: Cents.meta({ description: 'What the next month costs at today’s usage' }),
    card: z.object({ brand: z.string().nullable(), last4: z.string().nullable() }).nullable(),
    billingEmail: z.string().nullable(),
    openInvoice: SubscriptionInvoice.nullable(),
  })
  .meta({ id: 'Billing' });

export const CheckoutBody = z
  .object({
    email: Email.optional().meta({
      description: 'Receipt email; defaults to the billing email or yours',
    }),
  })
  .meta({ id: 'CheckoutBody' });
export const Checkout = z
  .object({
    authorizationUrl: z
      .string()
      .meta({ description: 'Open in a browser to pay with card or M-Pesa' }),
    reference: z.string(),
    amountCents: Cents,
    invoice: SubscriptionInvoice,
  })
  .meta({ id: 'Checkout' });
export const VerifyCheckoutBody = z
  .object({ reference: SafeString(100).min(1) })
  .meta({ id: 'VerifyCheckoutBody', description: 'After the Paystack redirect; safe to repeat' });

export const PaystackWebhookBody = z
  .object({ event: z.string(), data: z.record(z.string(), z.unknown()) })
  .meta({ id: 'PaystackWebhookBody' });
export const WebhookAck = z.object({ received: z.boolean() }).meta({ id: 'WebhookAck' });

// ── Operator ───────────────────────────────────────────────────────────────────────────────
export const OperatorOrg = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(['landlord', 'agency', 'host']),
    createdAt: Timestamp,
    planCode: PlanCode.nullable(),
    status: SubscriptionStatus.nullable(),
    currentPeriodEnd: IsoDate.nullable(),
    trialEndsOn: IsoDate.nullable(),
    members: z.int(),
    units: z.int(),
  })
  .meta({ id: 'OperatorOrg' });
export const OperatorOrgPage = pageOf(OperatorOrg, 'OperatorOrg');
export const OperatorOrgQuery = CursorQuery.extend({
  q: SafeString(120).optional(),
  status: SubscriptionStatus.optional(),
});
export const OperatorOrgDetail = OperatorOrg.extend({
  billingEmail: z.string().nullable(),
  invoices: z.array(SubscriptionInvoice),
  owners: z.array(
    z.object({ name: z.string(), email: z.string().nullable(), phone: z.string().nullable() }),
  ),
}).meta({ id: 'OperatorOrgDetail' });

export const SubscriptionAction = z
  .object({
    action: z.enum([
      'grant_trial',
      'extend_period',
      'change_plan',
      'suspend',
      'reactivate',
      'cancel',
    ]),
    days: z.int().min(1).max(365).optional().meta({ description: 'grant_trial / extend_period' }),
    planCode: PlanCode.optional().meta({ description: 'change_plan' }),
    note: SafeString(500).min(3).meta({ description: 'Why (kept in the audit log)' }),
  })
  .meta({ id: 'SubscriptionAction' });

export const UpdatePlanBody = z
  .object({
    name: SafeString(60).min(2).optional(),
    baseCents: Cents.min(0).optional(),
    unitPriceCents: Cents.min(0).optional(),
    listingPriceCents: Cents.min(0).optional(),
    minimumCents: Cents.min(0).optional(),
    whiteLabel: z.boolean().optional(),
  })
  .meta({ id: 'UpdatePlanBody', description: 'Takes effect from each org’s next invoice' });
export const PlanList = z.object({ items: z.array(Plan) }).meta({ id: 'PlanList' });
export const PlanCodeParam = z.object({ code: PlanCode });
export const OrgIdParam = z.object({ orgId: IdInput });

export const AuditEntry = z
  .object({
    id: z.string(),
    actorKind: z.enum(['user', 'system', 'operator']),
    actorUserId: z.string().nullable(),
    action: z.string(),
    entityType: z.string(),
    entityId: z.string().nullable(),
    diff: z.unknown().nullable(),
    occurredAt: Timestamp,
  })
  .meta({ id: 'AuditEntry' });
export const AuditList = z.object({ items: z.array(AuditEntry) }).meta({ id: 'AuditList' });
