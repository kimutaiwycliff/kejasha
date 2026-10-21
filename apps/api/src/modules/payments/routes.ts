import {
  AllocatePaymentBody,
  ChannelTokenParam,
  CreateChannelBody,
  DarajaAck,
  DarajaCallbackBody,
  GoLiveChecklist,
  IdParam,
  ManualPaymentBody,
  Payment,
  PaymentChannel,
  PaymentChannelList,
  PaymentPage,
  PaymentQuery,
  PaymentSuggestionList,
  problemResponses,
  ReasonBody,
  SetCredentialsBody,
  SmsPaymentBody,
  StatementImport,
  StatementImportBody,
  StkRequest,
  StkRequestBody,
  UpdateChannelBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { ctxOf } from '../../lib/ctx';
import type { ChannelService } from './channels';
import type { DarajaFlows } from './daraja-flows';
import type { Imports } from './imports';
import type { Receipts } from './receipts';
import type { PaymentsService } from './service';

export interface PaymentsParts {
  payments: PaymentsService;
  channels: ChannelService;
  daraja: DarajaFlows;
  imports: Imports;
  receipts: Receipts;
}

export function paymentsRoutes({
  payments,
  channels,
  daraja,
  imports,
  receipts,
}: PaymentsParts): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['payments'];
    const agent = { minRole: 'agent' as const };
    const manager = { minRole: 'manager' as const };
    const callback = { auth: 'public' as const, idempotency: 'off' as const };

    // ── Channels ──────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/payment-channels',
      {
        config: manager,
        schema: {
          operationId: 'listPaymentChannels',
          tags,
          summary: 'Paybills, Tills and personal numbers',
          response: { 200: PaymentChannelList, ...problemResponses() },
        },
      },
      async (req) => ({
        items: await channels.list(ctxOf(req)),
      }),
    );
    app.post(
      '/v1/payment-channels',
      {
        config: manager,
        schema: {
          operationId: 'createPaymentChannel',
          tags,
          summary: 'Add a Paybill, Till or personal number',
          body: CreateChannelBody,
          response: { 201: PaymentChannel, ...problemResponses(409, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await channels.create(ctxOf(req), req.body)),
    );
    app.patch(
      '/v1/payment-channels/:id',
      {
        config: manager,
        schema: {
          operationId: 'updatePaymentChannel',
          tags,
          summary: 'Rename, disable or switch environment',
          params: IdParam,
          body: UpdateChannelBody,
          response: { 200: PaymentChannel, ...problemResponses(404) },
        },
      },
      async (req) => channels.update(ctxOf(req), req.params.id, req.body),
    );
    app.put(
      '/v1/payment-channels/:id/credentials',
      {
        config: manager,
        schema: {
          operationId: 'setChannelCredentials',
          tags,
          summary: 'Store Daraja credentials (write-only, encrypted)',
          params: IdParam,
          body: SetCredentialsBody,
          response: { 200: PaymentChannel, ...problemResponses(404, 422, 503) },
        },
      },
      async (req) => channels.setCredentials(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/payment-channels/:id/register-c2b',
      {
        config: manager,
        schema: {
          operationId: 'registerChannelC2B',
          tags,
          summary: 'Register payment notification URLs with Safaricom',
          params: IdParam,
          response: { 200: PaymentChannel, ...problemResponses(404, 422, 503) },
        },
      },
      async (req) => channels.registerC2B(ctxOf(req), req.params.id),
    );
    app.get(
      '/v1/payment-channels/:id/go-live',
      {
        config: manager,
        schema: {
          operationId: 'getChannelGoLive',
          tags,
          summary: 'Go-live checklist and documents',
          params: IdParam,
          response: { 200: GoLiveChecklist, ...problemResponses(404) },
        },
      },
      async (req) => channels.goLive(ctxOf(req), req.params.id),
    );

    // ── Payments ──────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/payments',
      {
        config: agent,
        schema: {
          operationId: 'listPayments',
          tags,
          summary: 'Payments, newest first (status=unmatched for the queue)',
          querystring: PaymentQuery,
          response: { 200: PaymentPage, ...problemResponses(422) },
        },
      },
      async (req) => payments.list(ctxOf(req), req.query),
    );
    app.post(
      '/v1/payments',
      {
        config: manager,
        schema: {
          operationId: 'recordManualPayment',
          tags,
          summary: 'Record a cash, bank or off-channel payment',
          body: ManualPaymentBody,
          response: { 201: Payment, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await payments.manual(ctxOf(req), req.body)),
    );
    app.post(
      '/v1/sms-payments',
      {
        config: agent,
        schema: {
          operationId: 'recordPaymentFromSms',
          tags,
          summary: 'Record a payment from a shared M-Pesa SMS',
          body: SmsPaymentBody,
          response: { 201: Payment, ...problemResponses(422) },
        },
      },
      async (req, reply) => reply.status(201).send(await imports.fromSms(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/payments/:id',
      {
        config: agent,
        schema: {
          operationId: 'getPayment',
          tags,
          summary: 'A payment',
          params: IdParam,
          response: { 200: Payment, ...problemResponses(404) },
        },
      },
      async (req) => payments.get(ctxOf(req), req.params.id),
    );
    app.get(
      '/v1/payments/:id/suggestions',
      {
        config: agent,
        schema: {
          operationId: 'getPaymentSuggestions',
          tags,
          summary: 'Likely leases for an unmatched payment',
          params: IdParam,
          response: { 200: PaymentSuggestionList, ...problemResponses(404) },
        },
      },
      async (req) => ({
        items: await payments.suggestions(ctxOf(req), req.params.id),
      }),
    );
    app.post(
      '/v1/payments/:id/allocate',
      {
        config: manager,
        schema: {
          operationId: 'allocatePayment',
          tags,
          summary: 'Apply an unmatched payment to a lease',
          params: IdParam,
          body: AllocatePaymentBody,
          response: { 200: Payment, ...problemResponses(404, 409) },
        },
      },
      async (req) => payments.allocate(ctxOf(req), req.params.id, req.body.leaseId),
    );
    app.post(
      '/v1/payments/:id/unallocate',
      {
        config: manager,
        schema: {
          operationId: 'unallocatePayment',
          tags,
          summary: 'Take a payment off its lease (reversing entry)',
          params: IdParam,
          body: ReasonBody,
          response: { 200: Payment, ...problemResponses(404, 409) },
        },
      },
      async (req) => payments.unallocate(ctxOf(req), req.params.id, req.body.reason),
    );
    app.post(
      '/v1/payments/:id/ignore',
      {
        config: manager,
        schema: {
          operationId: 'ignorePayment',
          tags,
          summary: 'Mark an unmatched payment as not rent',
          params: IdParam,
          body: ReasonBody,
          response: { 200: Payment, ...problemResponses(404, 409) },
        },
      },
      async (req) => payments.ignore(ctxOf(req), req.params.id, req.body.reason),
    );
    app.get(
      '/v1/payments/:id/receipt',
      {
        config: agent,
        schema: {
          operationId: 'getPaymentReceipt',
          tags,
          summary: 'Receipt PDF',
          params: IdParam,
          response: {
            200: {
              description: 'PDF receipt',
              content: { 'application/pdf': { schema: z.string().meta({ format: 'binary' }) } },
            },
            ...problemResponses(404, 422),
          },
        },
      },
      async (req, reply) => {
        const pdf = await receipts.pdf(ctxOf(req), req.params.id);
        // Binary body: bypass the JSON serializer for this response.
        return reply
          .type('application/pdf')
          .serializer((p: unknown) => p as string)
          .send(pdf as unknown as string);
      },
    );

    // ── STK Push & statements ─────────────────────────────────────────────────────────────
    app.post(
      '/v1/stk-requests',
      {
        config: agent,
        schema: {
          operationId: 'requestStkPayment',
          tags,
          summary: "Send an M-Pesa payment prompt to the tenant's phone",
          body: StkRequestBody,
          response: { 201: StkRequest, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await daraja.createStk(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/stk-requests/:id',
      {
        config: agent,
        schema: {
          operationId: 'getStkRequest',
          tags,
          summary: 'Status of a payment prompt',
          params: IdParam,
          response: { 200: StkRequest, ...problemResponses(404) },
        },
      },
      async (req) => daraja.getStk(ctxOf(req), req.params.id),
    );
    app.post(
      '/v1/statement-imports',
      {
        config: manager,
        schema: {
          operationId: 'importStatement',
          tags,
          summary: 'Import an M-Pesa statement (CSV or PDF)',
          body: StatementImportBody,
          response: { 201: StatementImport, ...problemResponses(422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await imports.importStatement(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/statement-imports/:id',
      {
        config: manager,
        schema: {
          operationId: 'getStatementImport',
          tags,
          summary: 'A statement import summary',
          params: IdParam,
          response: { 200: StatementImport, ...problemResponses(404) },
        },
      },
      async (req) => imports.getImport(ctxOf(req), req.params.id),
    );

    // ── Daraja callbacks (public; gated by the channel token) ─────────────────────────────
    const cbSchema = (operationId: string, summary: string) => ({
      operationId,
      tags: ['daraja'],
      summary,
      params: ChannelTokenParam,
      body: DarajaCallbackBody,
      response: { 200: DarajaAck, ...problemResponses(403, 404) },
    });
    app.post(
      '/v1/payments/daraja/:channelToken/c2b/validation',
      {
        config: callback,
        schema: cbSchema('darajaC2bValidation', 'Safaricom C2B validation (always accepts)'),
      },
      async (req) => daraja.c2bValidation(req, req.params.channelToken, req.body),
    );
    app.post(
      '/v1/payments/daraja/:channelToken/c2b/confirmation',
      { config: callback, schema: cbSchema('darajaC2bConfirmation', 'Safaricom C2B confirmation') },
      async (req) => daraja.c2bConfirmation(req, req.params.channelToken, req.body),
    );
    app.post(
      '/v1/payments/daraja/:channelToken/stk',
      { config: callback, schema: cbSchema('darajaStkResult', 'Safaricom STK Push result') },
      async (req) => daraja.stkResult(req, req.params.channelToken, req.body),
    );
  };
}
