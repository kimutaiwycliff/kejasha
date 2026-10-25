import {
  IdParam,
  PortalLeaseParams,
  PortalMe,
  PortalPayBody,
  PortalTicketBody,
  PortalTicketList,
  problemResponses,
  LeaseStatement,
  StatementQuery,
  StkRequest,
  TicketDetail,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import type { PortalService } from './service';
import { hitLimit } from '../../lib/rate-limit';

/** Tenant portal: any signed-in user; access is by verified phone, checked per lease. */
export function portalRoutes(portal: PortalService): FastifyPluginAsyncZod<AppDeps> {
  return async (app, deps) => {
    const tags = ['portal'];
    const user = { auth: 'user' as const };

    app.get(
      '/v1/portal/me',
      {
        config: user,
        schema: {
          operationId: 'portalMe',
          tags,
          summary: 'Your tenancies with every landlord on Kejasha',
          response: { 200: PortalMe, ...problemResponses() },
        },
      },
      async (req) => portal.me(req.actor!.userId),
    );
    app.get(
      '/v1/portal/leases/:leaseId/statement',
      {
        config: user,
        schema: {
          operationId: 'portalLeaseStatement',
          tags,
          summary: 'Your invoices and payments with a running balance',
          params: PortalLeaseParams,
          querystring: StatementQuery,
          response: { 200: LeaseStatement, ...problemResponses(404, 422) },
        },
      },
      async (req) => portal.statement(req.actor!.userId, req.params.leaseId, req.query),
    );
    app.post(
      '/v1/portal/leases/:leaseId/pay',
      {
        config: user,
        schema: {
          operationId: 'portalPay',
          tags,
          summary: 'Pay rent: an M-Pesa prompt is sent to your phone',
          params: PortalLeaseParams,
          body: PortalPayBody,
          response: { 201: StkRequest, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await portal.pay(req.actor!.userId, req.params.leaseId, req.body)),
    );
    app.get(
      '/v1/portal/payments/:id/receipt',
      {
        config: user,
        schema: {
          operationId: 'portalReceipt',
          tags,
          summary: 'Receipt PDF for one of your payments',
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
        const pdf = await portal.receipt(req.actor!.userId, req.params.id);
        return reply
          .type('application/pdf')
          .serializer((p: unknown) => p as string)
          .send(pdf as unknown as string);
      },
    );
    app.get(
      '/v1/portal/tickets',
      {
        config: user,
        schema: {
          operationId: 'portalTickets',
          tags,
          summary: 'Repairs you reported',
          response: { 200: PortalTicketList, ...problemResponses() },
        },
      },
      async (req) => portal.tickets(req.actor!.userId),
    );
    app.post(
      '/v1/portal/tickets',
      {
        config: user,
        schema: {
          operationId: 'portalReportTicket',
          tags,
          summary: 'Report a problem in your unit',
          body: PortalTicketBody,
          response: { 201: TicketDetail, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) =>
        reply
          .status(201)
          .send(
            await hitLimit(deps.redis, `portal-ticket:${req.actor!.userId}`, 10, 3600).then(() =>
              portal.reportTicket(req.actor!.userId, req.body),
            ),
          ),
    );
  };
}
