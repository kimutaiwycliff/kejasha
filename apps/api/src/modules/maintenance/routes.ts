import {
  AddTicketUpdateBody,
  CreateTicketBody,
  IdParam,
  problemResponses,
  TicketDetail,
  TicketPage,
  TicketQuery,
  UpdateTicketBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import { ctxOf } from '../../lib/ctx';
import type { MaintenanceService } from './service';

/** Caretakers (assigned properties only) report and progress tickets; agents+ edit them. */
export function maintenanceRoutes(service: MaintenanceService): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['maintenance'];
    const caretaker = { minRole: 'caretaker' as const };
    const agent = { minRole: 'agent' as const };

    app.get(
      '/v1/tickets',
      {
        config: caretaker,
        schema: {
          operationId: 'listTickets',
          tags,
          summary: 'Maintenance tickets, newest first (caretakers: assigned properties)',
          querystring: TicketQuery,
          response: { 200: TicketPage, ...problemResponses(422) },
        },
      },
      async (req) => service.list(ctxOf(req), req.query),
    );
    app.post(
      '/v1/tickets',
      {
        config: caretaker,
        schema: {
          operationId: 'createTicket',
          tags,
          summary: 'Report a problem on a unit or a whole property, with photos',
          body: CreateTicketBody,
          response: { 201: TicketDetail, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await service.create(ctxOf(req), req.body)),
    );
    app.get(
      '/v1/tickets/:id',
      {
        config: caretaker,
        schema: {
          operationId: 'getTicket',
          tags,
          summary: 'A ticket with its timeline and photos',
          params: IdParam,
          response: { 200: TicketDetail, ...problemResponses(404) },
        },
      },
      async (req) => service.get(ctxOf(req), req.params.id),
    );
    app.patch(
      '/v1/tickets/:id',
      {
        config: agent,
        schema: {
          operationId: 'updateTicket',
          tags,
          summary: 'Edit title, priority, assignee or cost',
          params: IdParam,
          body: UpdateTicketBody,
          response: { 200: TicketDetail, ...problemResponses(404, 409, 422) },
        },
      },
      async (req) => service.update(ctxOf(req), req.params.id, req.body),
    );
    app.post(
      '/v1/tickets/:id/updates',
      {
        config: caretaker,
        schema: {
          operationId: 'addTicketUpdate',
          tags,
          summary: 'Add a note, photos, the cost or a status change',
          params: IdParam,
          body: AddTicketUpdateBody,
          response: { 201: TicketDetail, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await service.addUpdate(ctxOf(req), req.params.id, req.body)),
    );
  };
}
