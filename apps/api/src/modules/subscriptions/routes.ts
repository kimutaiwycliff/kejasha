import {
  Billing,
  Checkout,
  CheckoutBody,
  PaystackWebhookBody,
  problemResponses,
  SubscriptionInvoice,
  VerifyCheckoutBody,
  WebhookAck,
} from '@kejasha/contracts';
import { uuidv7 } from '@kejasha/core';
import { eq, schema } from '@kejasha/db';
import { parseTransaction, verifySignature } from '@kejasha/integrations-paystack';
import type { FastifyPluginAsyncZod, ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { AppError } from '../../errors';
import { ctxOf } from '../../lib/ctx';
import { hitLimit } from '../../lib/rate-limit';
import type { SubscriptionService } from './service';

declare module 'fastify' {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export function subscriptionRoutes(billing: SubscriptionService): FastifyPluginAsyncZod<AppDeps> {
  return async (app, deps) => {
    const tags = ['billing'];
    const manager = { minRole: 'manager' as const };

    app.get(
      '/v1/billing',
      {
        config: manager,
        schema: {
          operationId: 'getBilling',
          tags,
          summary: 'Plan, status, usage, next amount and the open invoice',
          response: { 200: Billing, ...problemResponses() },
        },
      },
      async (req) => billing.get(ctxOf(req)),
    );
    app.get(
      '/v1/billing/invoices',
      {
        config: manager,
        schema: {
          operationId: 'listSubscriptionInvoices',
          tags,
          summary: 'Kejasha invoices, newest first',
          response: {
            200: z
              .object({ items: z.array(SubscriptionInvoice) })
              .meta({ id: 'SubscriptionInvoiceList' }),
            ...problemResponses(),
          },
        },
      },
      async (req) => ({ items: await billing.invoices(ctxOf(req)) }),
    );
    app.post(
      '/v1/billing/checkout',
      {
        config: manager,
        schema: {
          operationId: 'startCheckout',
          tags,
          summary: 'Pay the month that is due (Paystack: card or M-Pesa)',
          body: CheckoutBody,
          response: { 200: Checkout, ...problemResponses(409, 422, 503) },
        },
      },
      async (req) => billing.checkout(ctxOf(req), req.body.email),
    );
    app.post(
      '/v1/billing/verify',
      {
        config: manager,
        schema: {
          operationId: 'verifyCheckout',
          tags,
          summary: 'Confirm a checkout after the Paystack redirect',
          body: VerifyCheckoutBody,
          response: { 200: Billing, ...problemResponses(404) },
        },
      },
      async (req) => billing.verify(ctxOf(req), req.body.reference),
    );

    // Paystack webhook: the signature covers the raw bytes, so this scope keeps them.
    await app.register(async (scoped) => {
      scoped.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
        req.rawBody = body as string;
        try {
          done(null, JSON.parse(body as string));
        } catch {
          done(
            new AppError(400, 'invalid_json', 'Bad request', 'Body is not valid JSON.'),
            undefined,
          );
        }
      });
      scoped.withTypeProvider<ZodTypeProvider>().post(
        '/v1/billing/paystack/webhook',
        {
          config: { auth: 'public', idempotency: 'off' },
          schema: {
            operationId: 'paystackWebhook',
            tags,
            summary: 'Paystack events (signed with HMAC-SHA512; re-verified with Paystack)',
            body: PaystackWebhookBody,
            response: { 200: WebhookAck, ...problemResponses(401) },
          },
        },
        async (req) => {
          await hitLimit(deps.redis, `paystack:ip:${req.ip}`, 120, 60);
          const secret = deps.config.paystack.secretKey;
          const signed = Boolean(
            secret &&
            verifySignature(
              secret,
              req.rawBody ?? '',
              req.headers['x-paystack-signature'] as string | undefined,
            ),
          );
          // Postgres text/jsonb cannot hold NUL; the signature was already checked on the raw bytes.
          const clean = (v: string) => v.replaceAll('\u0000', '');
          const reference =
            typeof req.body.data.reference === 'string'
              ? clean(req.body.data.reference).slice(0, 200)
              : null;
          const id = uuidv7();
          // Verify before storing (review M6): unsigned attempts keep no body, only a trace.
          await deps.db.owner.insert(schema.paystackEvent).values({
            id,
            event: clean(req.body.event).slice(0, 100),
            reference,
            body: signed
              ? (JSON.parse(JSON.stringify(req.body).replace(/\\u0000/g, '')) as object)
              : {},
            signatureOk: signed,
          });
          if (!signed) {
            req.log.warn({ reference }, 'unsigned Paystack webhook refused');
            throw new AppError(401, 'invalid_signature', 'Unauthorized', 'Signature check failed.');
          }
          let outcome = 'ignored';
          if (req.body.event === 'charge.success' && reference) {
            // Trust Paystack's own record of the transaction, not only the webhook body.
            const t = await deps.paystack
              .verify(reference)
              .catch(() => parseTransaction(req.body.data));
            outcome = await billing.applyPayment(t);
          }
          await deps.db.owner
            .update(schema.paystackEvent)
            .set({ outcome })
            .where(eq(schema.paystackEvent.id, id));
          return { received: true };
        },
      );
    });
  };
}
