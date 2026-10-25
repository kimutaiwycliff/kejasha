import type { Billing, Plan, SubscriptionInvoice } from '@kejasha/contracts';
import { money, subscriptions as pricing, time, uuidv7 } from '@kejasha/core';
import { and, desc, eq, schema, type Tx } from '@kejasha/db';
import { enqueueInTx } from '@kejasha/jobs';
import type { PaystackTransaction } from '@kejasha/integrations-paystack';
import type { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { record } from '../../lib/audit';
import { openSecret, sealSecret } from '../../lib/credentials';
import { inTenant, systemCtx, type Ctx } from '../../lib/ctx';
import { nextNumber } from '../../lib/numbering';
import * as accounts from '../accounts';
import * as leasing from '../leasing';

const { plan: pl, subscription: sub, subscriptionInvoice: inv, subscriptionPayment: pay } = schema;
type SubRow = typeof sub.$inferSelect;
type InvoiceRow = typeof inv.$inferSelect;
type PlanRow = typeof pl.$inferSelect;
const api = (v: bigint) => money.toApiInt(v);

export interface BillingContacts {
  /** Owners/managers who receive billing emails when no billing email is set. */
  staffContacts(
    orgId: string,
    roles: ('owner' | 'manager')[],
  ): Promise<{ userId: string; name: string; email: string | null; phone: string | null }[]>;
}

/** The sealed card authorization packs into one bytea: [version][wrapped key (60 B)][ciphertext]. */
const WRAPPED = 60;
function pack(s: { keyVersion: number; wrappedKey: Buffer; ciphertext: Buffer }) {
  return Buffer.concat([Buffer.from([s.keyVersion]), s.wrappedKey, s.ciphertext]);
}
function unpack(b: Buffer) {
  return {
    keyVersion: b[0]!,
    wrappedKey: b.subarray(1, 1 + WRAPPED),
    ciphertext: b.subarray(1 + WRAPPED),
  };
}

export function toPlanDto(p: PlanRow): z.infer<typeof Plan> {
  return {
    code: p.code,
    name: p.name,
    baseCents: api(p.baseCents),
    unitPriceCents: api(p.unitPriceCents),
    listingPriceCents: api(p.listingPriceCents),
    minimumCents: api(p.minimumCents),
    whiteLabel: p.whiteLabel,
  };
}

export function toInvoiceDto(r: InvoiceRow): z.infer<typeof SubscriptionInvoice> {
  return {
    id: r.id,
    number: r.number,
    planCode: r.planCode,
    periodStart: r.periodStart,
    periodEnd: r.periodEnd,
    units: r.units,
    listings: r.listings,
    amountCents: api(r.amountCents),
    status: r.status,
    reference: r.reference,
    attempts: r.attempts,
    paidAt: r.paidAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Effective status: an operator trial that ran out without payment is `incomplete` again. */
export function effectiveStatus(
  s: Pick<SubRow, 'status' | 'trialEndsOn'> | undefined,
  today: string,
) {
  if (!s) return 'incomplete' as const;
  if (s.status === 'trialing' && s.trialEndsOn && s.trialEndsOn < today)
    return 'incomplete' as const;
  return s.status;
}

/**
 * Kejasha's own SaaS billing (B6b; never rent — ADR-008). Monthly, billed in advance from usage;
 * Paystack checkout and saved-card renewals; a payment applies once per Paystack reference.
 */
export function createSubscriptionService(deps: AppDeps, people: BillingContacts) {
  const { db, clock, config, paystack } = deps;

  async function planOf(code: PlanRow['code']) {
    const [p] = await db.owner.select().from(pl).where(eq(pl.code, code));
    if (!p) throw AppError.notFound('Plan');
    return p;
  }

  async function usage(tx: Tx) {
    const props = await accounts.propertiesOf(tx);
    const units = (
      await accounts.unitsOfProperties(
        tx,
        props.map((p) => p.id),
      )
    ).filter((u) => !u.archived);
    const longTerm = units.filter((u) => u.mode === 'long_term').map((u) => u.id);
    const occupied = new Set(
      (await leasing.rentRollLeases(tx, longTerm, clock.today())).map((l) => l.unitId),
    );
    return {
      units: occupied.size,
      listings: units.filter((u) => u.mode === 'short_stay' && u.status === 'active').length,
    };
  }

  async function subscriptionIn(tx: Tx, lock = false) {
    const q = tx.select().from(sub);
    const [row] = lock ? await q.for('update') : await q;
    if (!row) throw AppError.notFound('Subscription');
    return row;
  }

  async function billingEmail(orgId: string, s: SubRow) {
    if (s.billingEmail) return s.billingEmail;
    const staff = await people.staffContacts(orgId, ['owner']);
    return staff.find((x) => x.email)?.email ?? null;
  }

  /** The open invoice for the period that must be paid next (created from usage if missing). */
  async function invoiceDue(tx: Tx, ctx: Ctx, s: SubRow): Promise<InvoiceRow> {
    const today = clock.today();
    const status = effectiveStatus(s, today);
    const start =
      (status === 'active' || status === 'past_due') && s.currentPeriodEnd
        ? time.addDays(s.currentPeriodEnd, 1)
        : today;
    const [open] = await tx
      .select()
      .from(inv)
      .where(eq(inv.status, 'open'))
      .orderBy(desc(inv.periodStart))
      .limit(1);
    // An overdue renewal is paid as invoiced; otherwise the month starts on the day it is paid.
    if (open && (status === 'past_due' || open.periodStart === start)) return open;
    if (open) await tx.update(inv).set({ status: 'void' }).where(eq(inv.id, open.id));
    const p = await planOf(s.planCode);
    const u = await usage(tx);
    const period = pricing.periodFrom(start);
    const id = uuidv7();
    const [row] = await tx
      .insert(inv)
      .values({
        id,
        orgId: ctx.orgId,
        number: await nextNumber(tx, ctx, 'subscription_invoice', 'KJ'),
        planCode: s.planCode,
        periodStart: period.start,
        periodEnd: period.end,
        units: u.units,
        listings: u.listings,
        amountCents: pricing.monthlyAmount(p, u),
        reference: `KJ-${id.replace(/-/g, '').slice(-20).toUpperCase()}`,
      })
      .onConflictDoNothing()
      .returning();
    if (row) return row;
    const [existing] = await tx
      .select()
      .from(inv)
      .where(and(eq(inv.periodStart, period.start), eq(inv.status, 'open')));
    if (!existing)
      throw AppError.conflict(
        'invoice_conflict',
        'The invoice for this period is already settled.',
      );
    return existing;
  }

  async function notify(ctx: Ctx, s: SubRow, key: string, subject: string, text: string) {
    const to = await billingEmail(ctx.orgId, s);
    if (!to) return;
    await inTenant(db, ctx, (tx) =>
      enqueueInTx(tx, {
        orgId: ctx.orgId,
        topic: 'notifications.email',
        payload: { to, subject, text },
        dedupeKey: key,
      }),
    );
  }

  /**
   * Apply a successful Paystack transaction to its invoice — exactly once per reference. Called by
   * the webhook, the post-checkout verify and renewal charges.
   */
  async function applyPayment(
    t: PaystackTransaction,
  ): Promise<'applied' | 'duplicate' | 'ignored'> {
    if (t.status !== 'success' || t.currency !== 'KES') return 'ignored';
    const invoiceId = typeof t.metadata.invoiceId === 'string' ? t.metadata.invoiceId : null;
    const [found] = await db.owner
      .select({ orgId: inv.orgId, id: inv.id })
      .from(inv)
      .where(invoiceId ? eq(inv.id, invoiceId) : eq(inv.reference, t.reference));
    if (!found) return 'ignored';
    const ctx = systemCtx(found.orgId);
    return inTenant(db, ctx, async (tx) => {
      const [i] = await tx.select().from(inv).where(eq(inv.id, found.id)).for('update');
      if (!i) return 'ignored';
      const [dup] = await tx.select({ id: pay.id }).from(pay).where(eq(pay.reference, t.reference));
      if (dup) return 'duplicate';
      if (t.amountCents < i.amountCents) return 'ignored';
      await tx.insert(pay).values({
        id: uuidv7(),
        orgId: ctx.orgId,
        invoiceId: i.id,
        reference: t.reference,
        amountCents: t.amountCents,
        channel: t.channel,
        paidAt: t.paidAt ?? clock.now(),
      });
      if (i.status === 'open')
        await tx
          .update(inv)
          .set({ status: 'paid', paidAt: t.paidAt ?? clock.now() })
          .where(eq(inv.id, i.id));
      const s = await subscriptionIn(tx, true);
      const card =
        t.authorization?.reusable && config.credentialsMasterKey
          ? {
              authorizationCiphertext: pack(
                sealSecret(config.credentialsMasterKey, {
                  code: t.authorization.authorizationCode,
                }),
              ),
              cardBrand: t.authorization.brand,
              cardLast4: t.authorization.last4,
            }
          : {};
      const extends_ = !s.currentPeriodEnd || i.periodEnd > s.currentPeriodEnd;
      await tx
        .update(sub)
        .set({
          status: 'active',
          pastDueSince: null,
          trialEndsOn: null,
          ...(extends_ ? { currentPeriodStart: i.periodStart, currentPeriodEnd: i.periodEnd } : {}),
          ...(t.customerCode ? { paystackCustomerCode: t.customerCode } : {}),
          ...card,
        })
        .where(eq(sub.orgId, ctx.orgId));
      await record(tx, ctx, {
        action: 'subscription.paid',
        entityType: 'subscription_invoice',
        entityId: i.id,
        diff: { reference: t.reference, amountCents: t.amountCents.toString() },
      });
      return 'applied';
    });
  }

  async function chargeSaved(ctx: Ctx, s: SubRow, i: InvoiceRow) {
    if (!s.authorizationCiphertext || !config.credentialsMasterKey) return false;
    const email = await billingEmail(ctx.orgId, s);
    if (!email) return false;
    const { code } = openSecret<{ code: string }>(
      config.credentialsMasterKey,
      unpack(Buffer.from(s.authorizationCiphertext)),
    );
    const attempt = i.attempts + 1;
    await inTenant(db, ctx, (tx) =>
      tx.update(inv).set({ attempts: attempt, lastAttemptAt: clock.now() }).where(eq(inv.id, i.id)),
    );
    const t = await paystack
      .chargeAuthorization({
        email,
        amountCents: i.amountCents,
        reference: `${i.reference}-R${attempt}`,
        authorizationCode: code,
        metadata: { orgId: ctx.orgId, invoiceId: i.id },
      })
      .catch(() => null);
    return t ? (await applyPayment(t)) === 'applied' : false;
  }

  return {
    applyPayment,
    usage,

    /** New orgs start `incomplete` on the plan matching their kind (org-created hook). */
    async onOrgCreated(tx: Tx, o: { orgId: string; kind: string }) {
      await tx
        .insert(sub)
        .values({
          orgId: o.orgId,
          planCode: o.kind === 'agency' ? 'agency' : o.kind === 'host' ? 'host' : 'landlord',
        })
        .onConflictDoNothing();
    },

    async get(ctx: Ctx): Promise<z.infer<typeof Billing>> {
      return inTenant(db, ctx, async (tx) => {
        const s = await subscriptionIn(tx);
        const p = await planOf(s.planCode);
        const u = await usage(tx);
        const [open] = await tx
          .select()
          .from(inv)
          .where(eq(inv.status, 'open'))
          .orderBy(desc(inv.periodStart))
          .limit(1);
        return {
          plan: toPlanDto(p),
          status: effectiveStatus(s, clock.today()),
          trialEndsOn: s.trialEndsOn,
          currentPeriodStart: s.currentPeriodStart,
          currentPeriodEnd: s.currentPeriodEnd,
          pastDueSince: s.pastDueSince,
          usage: u,
          nextAmountCents: api(pricing.monthlyAmount(p, u)),
          card: s.cardLast4 ? { brand: s.cardBrand, last4: s.cardLast4 } : null,
          billingEmail: s.billingEmail,
          openInvoice: open ? toInvoiceDto(open) : null,
        };
      });
    },

    async invoices(ctx: Ctx) {
      return inTenant(db, ctx, async (tx) =>
        (await tx.select().from(inv).orderBy(desc(inv.periodStart)).limit(36)).map(toInvoiceDto),
      );
    },

    /** Start a Paystack checkout for the invoice that is due (first month, renewal or overdue). */
    async checkout(ctx: Ctx, email: string | undefined) {
      if (!paystack.configured)
        throw new AppError(
          503,
          'billing_unavailable',
          'Billing unavailable',
          'Paystack is not configured.',
        );
      const { invoice, to } = await inTenant(db, ctx, async (tx) => {
        const s = await subscriptionIn(tx, true);
        if (email && email !== s.billingEmail)
          await tx.update(sub).set({ billingEmail: email }).where(eq(sub.orgId, ctx.orgId));
        const status = effectiveStatus(s, clock.today());
        if (
          status === 'active' &&
          s.currentPeriodEnd &&
          s.currentPeriodEnd > time.addDays(clock.today(), 7)
        )
          throw AppError.conflict('nothing_due', `You are paid up until ${s.currentPeriodEnd}.`);
        const invoice = await invoiceDue(tx, ctx, s);
        return { invoice, to: email ?? (await billingEmail(ctx.orgId, s)) };
      });
      if (!to) throw AppError.unprocessable('email_required', 'Send an email for the receipt.');
      const init = await paystack.initialize({
        email: to,
        amountCents: invoice.amountCents,
        reference: invoice.reference,
        callbackUrl: `${config.domain.webUrl}/billing/return`,
        metadata: { orgId: ctx.orgId, invoiceId: invoice.id },
      });
      return {
        authorizationUrl: init.authorizationUrl,
        reference: invoice.reference,
        amountCents: api(invoice.amountCents),
        invoice: toInvoiceDto(invoice),
      };
    },

    /** After the redirect: ask Paystack and apply (safe to repeat, same as the webhook). */
    async verify(ctx: Ctx, reference: string) {
      const owned = await inTenant(db, ctx, (tx) =>
        tx.select({ id: inv.id }).from(inv).where(eq(inv.reference, reference)),
      );
      if (!owned.length) throw AppError.notFound('Invoice');
      const t = await paystack.verify(reference).catch(() => null);
      if (t) await applyPayment(t);
      return this.get(ctx);
    },

    /**
     * Daily (worker): renew active subscriptions whose period ended, retry/remind past-due ones on
     * days 0/1/3/7, suspend after the grace period, and end lapsed operator trials.
     */
    async runDaily(orgId: string, today: string) {
      const ctx = systemCtx(orgId);
      const s = await inTenant(db, ctx, (tx) => subscriptionIn(tx)).catch(() => null);
      if (!s) return 'none';
      if (s.status === 'trialing' && s.trialEndsOn && s.trialEndsOn < today) {
        await inTenant(db, ctx, (tx) =>
          tx
            .update(sub)
            .set({ status: 'incomplete', trialEndsOn: null })
            .where(eq(sub.orgId, orgId)),
        );
        return 'trial_ended';
      }
      if (s.status === 'active' && s.currentPeriodEnd && s.currentPeriodEnd < today) {
        const i = await inTenant(db, ctx, async (tx) => {
          await tx
            .update(sub)
            .set({ status: 'past_due', pastDueSince: time.addDays(s.currentPeriodEnd!, 1) })
            .where(eq(sub.orgId, orgId));
          return invoiceDue(tx, ctx, { ...s, status: 'active' });
        });
        if (await chargeSaved(ctx, s, i)) return 'renewed';
        await notify(
          ctx,
          s,
          `billing:${i.id}:due`,
          `Kejasha: your ${i.periodStart} invoice is due`,
          `Your Kejasha subscription renewed for ${i.periodStart} to ${i.periodEnd}: ${money.formatKes(i.amountCents)}. Pay within ${pricing.GRACE_DAYS} days to keep everything running: open Billing in Kejasha.`,
        );
        return 'past_due';
      }
      if (s.status === 'past_due' && s.pastDueSince) {
        const days = time.diffDays(s.pastDueSince, today);
        if (days > pricing.GRACE_DAYS) {
          await inTenant(db, ctx, (tx) =>
            tx.update(sub).set({ status: 'suspended' }).where(eq(sub.orgId, orgId)),
          );
          await notify(
            ctx,
            s,
            `billing:${orgId}:${s.pastDueSince}:suspended`,
            'Kejasha: account suspended for non-payment',
            'Your Kejasha account is now read-only because the subscription is unpaid. Pay from Billing to restore it immediately.',
          );
          return 'suspended';
        }
        if ((pricing.RETRY_DAYS as readonly number[]).includes(days)) {
          const i = await inTenant(db, ctx, (tx) => invoiceDue(tx, ctx, s));
          if (await chargeSaved(ctx, s, i)) return 'renewed';
          await notify(
            ctx,
            s,
            `billing:${i.id}:reminder:${days}`,
            `Kejasha: payment reminder (${pricing.GRACE_DAYS - days} days left)`,
            `Your Kejasha invoice ${i.number} (${money.formatKes(i.amountCents)}) is unpaid. The account becomes read-only after ${time.addDays(s.pastDueSince, pricing.GRACE_DAYS)}.`,
          );
          return 'reminded';
        }
      }
      return 'ok';
    },
  };
}

export type SubscriptionService = ReturnType<typeof createSubscriptionService>;
