import {
  ArrearsQuery,
  ArrearsReport,
  BillingRunResult,
  BulkReadingsBody,
  BulkReadingsResult,
  CancelLeaseBody,
  ChargeRule,
  ChargeRuleList,
  CreateChargeBody,
  CreateCreditNoteBody,
  CreateInspectionBody,
  CreateLeaseBody,
  CreateMeterBody,
  CreateReadingBody,
  CreateTenantBody,
  CreditNote,
  DepositSettlement,
  DepositSettlementBody,
  IdParam,
  InspectionList,
  InvoiceDetail,
  InvoicePage,
  InvoiceQuery,
  LeaseCalendar,
  LeaseCalendarQuery,
  LeaseDetail,
  LeaseIdParam,
  LeasePage,
  LeaseQuery,
  LeaseStatement,
  ManualInvoiceBody,
  MeterIdParam,
  MeterList,
  MeterReading,
  MeterReadingList,
  problemResponses,
  RenewLeaseBody,
  RentChangeBody,
  StatementQuery,
  Tenant,
  TenantPage,
  TenantQuery,
  TerminateLeaseBody,
  UnitIdParam,
  UpdateChargeBody,
  UpdateLeaseBody,
  UpdateTenantBody,
  UploadRequest,
  UploadTicket,
  VoidInvoiceBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { ctxOf } from '../../lib/ctx';
import { hitLimit } from '../../lib/rate-limit';
import type { InvoiceOps } from './invoice-ops';
import type { MeterService } from './meters';
import type { LeasingOperations } from './operations';
import type { LeasingService } from './service';
import type { LeasingViews } from './views';

export interface LeasingParts {
  service: LeasingService;
  meters: MeterService;
  views: LeasingViews;
  ops: LeasingOperations;
  invoices: InvoiceOps;
}

export function leasingRoutes({
  service,
  meters,
  views,
  ops,
  invoices,
}: LeasingParts): FastifyPluginAsyncZod<AppDeps> {
  return async (app, deps) => {
    const tags = ['leasing'];
    const agent = { minRole: 'agent' as const };
    const manager = { minRole: 'manager' as const };

    // ── Tenants ────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/tenants',
      {
        config: agent,
        schema: {
          operationId: 'listTenants',
          tags,
          summary: 'Tenants (people who rent units)',
          querystring: TenantQuery,
          response: { 200: TenantPage, ...problemResponses(422) },
        },
      },
      async (req) => service.listTenants(ctxOf(req), req.query),
    );
    app.post(
      '/v1/tenants',
      {
        config: agent,
        schema: {
          operationId: 'createTenant',
          tags,
          summary: 'Add a tenant',
          body: CreateTenantBody,
          response: { 201: Tenant, ...problemResponses() },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await service.createTenant(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/tenants/:id',
      {
        config: agent,
        schema: {
          operationId: 'getTenant',
          tags,
          summary: 'A tenant with balance',
          params: IdParam,
          response: { 200: Tenant, ...problemResponses(404) },
        },
      },
      async (req) => service.getTenant(ctxOf(req), req.params.id),
    );
    app.patch(
      '/v1/tenants/:id',
      {
        config: agent,
        schema: {
          operationId: 'updateTenant',
          tags,
          summary: 'Update a tenant',
          params: IdParam,
          body: UpdateTenantBody,
          response: { 200: Tenant, ...problemResponses(404) },
        },
      },
      async (req) => service.updateTenant(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/tenants/:id/archive',
      {
        config: manager,
        schema: {
          operationId: 'archiveTenant',
          tags,
          summary: 'Archive a tenant (no active leases)',
          params: IdParam,
          response: { 200: Tenant, ...problemResponses(404, 409) },
        },
      },
      async (req) => service.archiveTenant(ctxOf(req), req.params.id),
    );

    // ── Leases ─────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/leases',
      {
        config: agent,
        schema: {
          operationId: 'listLeases',
          tags,
          summary: 'Leases, newest start first',
          querystring: LeaseQuery,
          response: { 200: LeasePage, ...problemResponses(422) },
        },
      },
      async (req) => service.listLeases(ctxOf(req), req.query),
    );
    app.get(
      '/v1/lease-calendar',
      {
        config: agent,
        schema: {
          operationId: 'getLeaseCalendar',
          tags,
          summary: 'Lease ends and rent escalations in a date range',
          querystring: LeaseCalendarQuery,
          response: { 200: LeaseCalendar, ...problemResponses(422) },
        },
      },
      async (req) => service.calendar(ctxOf(req), req.query.from, req.query.to),
    );
    app.post(
      '/v1/leases',
      {
        config: manager,
        schema: {
          operationId: 'createLease',
          tags,
          summary: 'Sign a lease',
          body: CreateLeaseBody,
          response: { 201: LeaseDetail, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await service.createLease(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/leases/:id',
      {
        config: agent,
        schema: {
          operationId: 'getLease',
          tags,
          summary: 'A lease with charges, rent steps and arrears',
          params: IdParam,
          response: { 200: LeaseDetail, ...problemResponses(404) },
        },
      },
      async (req) => service.getLease(ctxOf(req), req.params.id),
    );
    app.patch(
      '/v1/leases/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateLease',
          tags,
          summary: 'Change lease terms (future invoices)',
          params: IdParam,
          body: UpdateLeaseBody,
          response: { 200: LeaseDetail, ...problemResponses(404, 422) },
        },
      },
      async (req) => service.updateLease(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/leases/:id/rent-change',
      {
        config: manager,
        schema: {
          operationId: 'changeLeaseRent',
          tags,
          summary: 'Set a new rent from a future month',
          params: IdParam,
          body: RentChangeBody,
          response: { 200: LeaseDetail, ...problemResponses(404, 422) },
        },
      },
      async (req) => service.changeRent(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/leases/:id/renew',
      {
        config: manager,
        schema: {
          operationId: 'renewLease',
          tags,
          summary: 'Extend a lease (optionally with new rent)',
          params: IdParam,
          body: RenewLeaseBody,
          response: { 200: LeaseDetail, ...problemResponses(404, 409, 422) },
        },
      },
      async (req) => service.renewLease(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/leases/:id/terminate',
      {
        config: manager,
        schema: {
          operationId: 'terminateLease',
          tags,
          summary: 'End a lease early',
          params: IdParam,
          body: TerminateLeaseBody,
          response: { 200: LeaseDetail, ...problemResponses(404, 422) },
        },
      },
      async (req) => service.terminateLease(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/leases/:id/cancel',
      {
        config: manager,
        schema: {
          operationId: 'cancelLease',
          tags,
          summary: 'Cancel a lease entered by mistake',
          params: IdParam,
          body: CancelLeaseBody,
          response: { 200: LeaseDetail, ...problemResponses(404, 409) },
        },
      },
      async (req) => service.cancelLease(ctxOf(req), req.params.id, req.body.reason),
    );
    app.get(
      '/v1/leases/:id/statement',
      {
        config: agent,
        schema: {
          operationId: 'getLeaseStatement',
          tags,
          summary: 'Statement with running balance',
          params: IdParam,
          querystring: StatementQuery,
          response: { 200: LeaseStatement, ...problemResponses(404, 422) },
        },
      },
      async (req) => views.statement(ctxOf(req), req.params.id, req.query),
    );

    // ── Charges ────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/leases/:leaseId/charges',
      {
        config: agent,
        schema: {
          operationId: 'listLeaseCharges',
          tags,
          summary: 'Recurring charges on a lease',
          params: LeaseIdParam,
          response: { 200: ChargeRuleList, ...problemResponses(404) },
        },
      },
      async (req) => ({
        items: await service.listCharges(ctxOf(req), req.params.leaseId),
      }),
    );
    app.post(
      '/v1/leases/:leaseId/charges',
      {
        config: manager,
        schema: {
          operationId: 'createLeaseCharge',
          tags,
          summary: 'Add a recurring charge',
          params: LeaseIdParam,
          body: CreateChargeBody,
          response: { 201: ChargeRule, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) =>
        reply
          .status(201)
          .send(await service.createCharge(ctxOf(req), req.params.leaseId, req.body)),
    );
    app.patch(
      '/v1/charges/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateCharge',
          tags,
          summary: 'Change or end a recurring charge',
          params: IdParam,
          body: UpdateChargeBody,
          response: { 200: ChargeRule, ...problemResponses(404, 422) },
        },
      },
      async (req) => service.updateCharge(ctxOf(req), req.params.id, req.body),
    );

    // ── Meters (caretakers: assigned properties only) ─────────────────────────────────────
    app.get(
      '/v1/units/:unitId/meters',
      {
        schema: {
          operationId: 'listUnitMeters',
          tags,
          summary: 'Meters on a unit with last reading',
          params: UnitIdParam,
          response: { 200: MeterList, ...problemResponses(404) },
        },
      },
      async (req) => ({
        items: await meters.listUnitMeters(ctxOf(req), req.params.unitId),
      }),
    );
    app.post(
      '/v1/units/:unitId/meters',
      {
        config: manager,
        schema: {
          operationId: 'createMeter',
          tags,
          summary: 'Install a meter (optionally with its first reading)',
          params: UnitIdParam,
          body: CreateMeterBody,
          response: { 201: MeterList, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply
          .status(201)
          .send({ items: await meters.createMeter(ctxOf(req), req.params.unitId, req.body) }),
    );
    app.get(
      '/v1/meters/:meterId/readings',
      {
        schema: {
          operationId: 'listMeterReadings',
          tags,
          summary: 'Readings, newest first',
          params: MeterIdParam,
          response: { 200: MeterReadingList, ...problemResponses(404) },
        },
      },
      async (req) => ({
        items: await meters.listReadings(ctxOf(req), req.params.meterId),
      }),
    );
    app.post(
      '/v1/meters/:meterId/readings',
      {
        schema: {
          operationId: 'addMeterReading',
          tags,
          summary: 'Record a reading',
          params: MeterIdParam,
          body: CreateReadingBody,
          response: { 201: MeterReading, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await meters.addReading(ctxOf(req), req.params.meterId, req.body)),
    );
    app.post(
      '/v1/meter-readings/bulk',
      {
        schema: {
          operationId: 'addMeterReadingsBulk',
          tags,
          summary: 'Record many readings (caretaker round)',
          body: BulkReadingsBody,
          response: { 200: BulkReadingsResult, ...problemResponses() },
        },
      },
      async (req) => meters.addReadingsBulk(ctxOf(req), req.body),
    );

    // ── Invoices ───────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/invoices',
      {
        config: agent,
        schema: {
          operationId: 'listInvoices',
          tags,
          summary: 'Invoices with derived outstanding amounts',
          querystring: InvoiceQuery,
          response: { 200: InvoicePage, ...problemResponses(422) },
        },
      },
      async (req) => views.listInvoices(ctxOf(req), req.query),
    );
    app.get(
      '/v1/invoices/:id',
      {
        config: agent,
        schema: {
          operationId: 'getInvoice',
          tags,
          summary: 'An invoice with lines',
          params: IdParam,
          response: { 200: InvoiceDetail, ...problemResponses(404) },
        },
      },
      async (req) => views.getInvoice(ctxOf(req), req.params.id),
    );
    app.post(
      '/v1/leases/:leaseId/invoices',
      {
        config: manager,
        schema: {
          operationId: 'createManualInvoice',
          tags,
          summary: 'Bill a one-off charge',
          params: LeaseIdParam,
          body: ManualInvoiceBody,
          response: { 201: InvoiceDetail, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => {
        const id = await invoices.manualInvoice(ctxOf(req), req.params.leaseId, req.body);
        return reply.status(201).send(await views.getInvoice(ctxOf(req), id));
      },
    );
    app.post(
      '/v1/invoices/:id/void',
      {
        config: manager,
        schema: {
          operationId: 'voidInvoice',
          tags,
          summary: 'Void an invoice nothing has been applied to',
          params: IdParam,
          body: VoidInvoiceBody,
          response: { 200: InvoiceDetail, ...problemResponses(404, 409) },
        },
      },
      async (req) => {
        await invoices.voidInvoice(ctxOf(req), req.params.id, req.body.reason);
        return views.getInvoice(ctxOf(req), req.params.id);
      },
    );
    app.post(
      '/v1/leases/:leaseId/credit-notes',
      {
        config: manager,
        schema: {
          operationId: 'createCreditNote',
          tags,
          summary: 'Credit a tenant',
          params: LeaseIdParam,
          body: CreateCreditNoteBody,
          response: { 201: CreditNote, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await invoices.creditNote(ctxOf(req), req.params.leaseId, req.body)),
    );
    app.get(
      '/v1/arrears',
      {
        config: agent,
        schema: {
          operationId: 'getArrears',
          tags,
          summary: 'Arrears aging by lease',
          querystring: ArrearsQuery,
          response: { 200: ArrearsReport, ...problemResponses() },
        },
      },
      async (req) => views.arrears(ctxOf(req), req.query),
    );
    app.post(
      '/v1/billing/run',
      {
        config: manager,
        schema: {
          operationId: 'runBilling',
          tags,
          summary: 'Run billing, late fees and reminders now',
          description: 'The same job runs daily at 00:15 Africa/Nairobi; safe to repeat.',
          response: { 200: BillingRunResult, ...problemResponses() },
        },
      },
      async (req) => ops.runDaily(ctxOf(req)),
    );

    // ── Deposits, inspections, uploads ─────────────────────────────────────────────────────
    app.post(
      '/v1/leases/:leaseId/deposit-settlement',
      {
        config: manager,
        schema: {
          operationId: 'settleDeposit',
          tags,
          summary: 'Settle the deposit at move-out',
          params: LeaseIdParam,
          body: DepositSettlementBody,
          response: { 201: DepositSettlement, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await ops.settleDeposit(ctxOf(req), req.params.leaseId, req.body)),
    );
    app.get(
      '/v1/leases/:leaseId/inspections',
      {
        config: agent,
        schema: {
          operationId: 'listInspections',
          tags,
          summary: 'Move-in/out inspections',
          params: LeaseIdParam,
          response: { 200: InspectionList, ...problemResponses(404) },
        },
      },
      async (req) => ({
        items: await ops.listInspections(ctxOf(req), req.params.leaseId),
      }),
    );
    app.post(
      '/v1/leases/:leaseId/inspections',
      {
        config: agent,
        schema: {
          operationId: 'createInspection',
          tags,
          summary: 'Record a move-in/out inspection',
          params: LeaseIdParam,
          body: CreateInspectionBody,
          response: { 201: InspectionList, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) =>
        reply
          .status(201)
          .send({ items: await ops.createInspection(ctxOf(req), req.params.leaseId, req.body) }),
    );
    app.post(
      '/v1/uploads',
      {
        schema: {
          operationId: 'createUpload',
          tags: ['platform'],
          summary: 'Get a presigned URL to upload a photo',
          body: UploadRequest,
          response: { 201: UploadTicket, ...problemResponses(503, 429) },
        },
      },
      async (req, reply) => {
        await hitLimit(deps.redis, `upload:user:${req.actor!.userId}`, 200, 3600);
        return reply.status(201).send(await ops.createUpload(ctxOf(req), req.body));
      },
    );
  };
}
