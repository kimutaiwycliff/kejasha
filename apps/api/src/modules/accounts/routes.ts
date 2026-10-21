import {
  BulkCreateUnitsBody,
  ClientLandlord,
  ClientLandlordPage,
  ClientLandlordQuery,
  CodeAvailability,
  CodeAvailabilityQuery,
  CreateClientLandlordBody,
  CreatePropertyBody,
  CreateUnitBody,
  IdParam,
  problemResponses,
  Property,
  PropertyDetail,
  PropertyIdParam,
  PropertyPage,
  PropertyQuery,
  SetPropertyStaffBody,
  StaffAssignmentList,
  Unit,
  UnitList,
  UnitPage,
  UnitQuery,
  UpdateClientLandlordBody,
  UpdatePropertyBody,
  UpdateUnitBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import type { AccountsService } from './service';

export function accountsRoutes(accounts: AccountsService): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['accounts'];
    const manager = { minRole: 'manager' as const };
    const agent = { minRole: 'agent' as const };

    // ── Client landlords (agents and up) ───────────────────────────────────────────────────
    app.get(
      '/v1/client-landlords',
      {
        config: agent,
        schema: {
          operationId: 'listClientLandlords',
          tags,
          summary: 'Client landlords (owners whose properties the org manages)',
          querystring: ClientLandlordQuery,
          response: { 200: ClientLandlordPage, ...problemResponses(422) },
        },
      },
      async (req) => accounts.listClientLandlords(req, req.query),
    );
    app.post(
      '/v1/client-landlords',
      {
        config: manager,
        schema: {
          operationId: 'createClientLandlord',
          tags,
          summary: 'Add a client landlord',
          body: CreateClientLandlordBody,
          response: { 201: ClientLandlord, ...problemResponses(422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await accounts.createClientLandlord(req, req.body)),
    );
    app.get(
      '/v1/client-landlords/:id',
      {
        config: agent,
        schema: {
          operationId: 'getClientLandlord',
          tags,
          summary: 'A client landlord',
          params: IdParam,
          response: { 200: ClientLandlord, ...problemResponses(404) },
        },
      },
      async (req) => accounts.getClientLandlord(req, req.params.id),
    );
    app.patch(
      '/v1/client-landlords/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateClientLandlord',
          tags,
          summary: 'Update a client landlord',
          params: IdParam,
          body: UpdateClientLandlordBody,
          response: { 200: ClientLandlord, ...problemResponses(404, 422) },
        },
      },
      async (req) => accounts.updateClientLandlord(req, req.params.id, req.body),
    );
    app.post(
      '/v1/client-landlords/:id/archive',
      {
        config: manager,
        schema: {
          operationId: 'archiveClientLandlord',
          tags,
          summary: 'Archive a client landlord (needs no active properties)',
          params: IdParam,
          response: { 200: ClientLandlord, ...problemResponses(404, 409) },
        },
      },
      async (req) => accounts.archiveClientLandlord(req, req.params.id),
    );

    // ── Properties (caretakers see only assigned ones) ─────────────────────────────────────
    app.get(
      '/v1/properties',
      {
        schema: {
          operationId: 'listProperties',
          tags,
          summary: 'Properties with active unit counts',
          querystring: PropertyQuery,
          response: { 200: PropertyPage, ...problemResponses(422) },
        },
      },
      async (req) => accounts.listProperties(req, req.query),
    );
    app.post(
      '/v1/properties',
      {
        config: manager,
        schema: {
          operationId: 'createProperty',
          tags,
          summary: 'Add a property',
          body: CreatePropertyBody,
          response: { 201: Property, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await accounts.createProperty(req, req.body)),
    );
    app.get(
      '/v1/properties/:id',
      {
        schema: {
          operationId: 'getProperty',
          tags,
          summary: 'A property with its assigned staff',
          params: IdParam,
          response: { 200: PropertyDetail, ...problemResponses(404) },
        },
      },
      async (req) => accounts.getProperty(req, req.params.id),
    );
    app.patch(
      '/v1/properties/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateProperty',
          tags,
          summary: 'Update a property',
          params: IdParam,
          body: UpdatePropertyBody,
          response: { 200: Property, ...problemResponses(404, 422) },
        },
      },
      async (req) => accounts.updateProperty(req, req.params.id, req.body),
    );
    app.post(
      '/v1/properties/:id/archive',
      {
        config: manager,
        schema: {
          operationId: 'archiveProperty',
          tags,
          summary: 'Archive a property (needs no active units)',
          params: IdParam,
          response: { 200: Property, ...problemResponses(404, 409) },
        },
      },
      async (req) => accounts.archiveProperty(req, req.params.id),
    );
    app.get(
      '/v1/properties/:id/staff',
      {
        config: agent,
        schema: {
          operationId: 'getPropertyStaff',
          tags,
          summary: 'Staff assigned to a property',
          params: IdParam,
          response: { 200: StaffAssignmentList, ...problemResponses(404) },
        },
      },
      async (req) => ({ items: await accounts.getPropertyStaff(req, req.params.id) }),
    );
    app.put(
      '/v1/properties/:id/staff',
      {
        config: manager,
        schema: {
          operationId: 'setPropertyStaff',
          tags,
          summary: 'Replace the staff assigned to a property',
          params: IdParam,
          body: SetPropertyStaffBody,
          response: { 200: StaffAssignmentList, ...problemResponses(404, 422) },
        },
      },
      async (req) => ({
        items: await accounts.setPropertyStaff(req, req.params.id, req.body.userIds),
      }),
    );

    // ── Units ──────────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/units',
      {
        schema: {
          operationId: 'listUnits',
          tags,
          summary: 'Units, sorted by code',
          querystring: UnitQuery,
          response: { 200: UnitPage, ...problemResponses(422) },
        },
      },
      async (req) => accounts.listUnits(req, req.query),
    );
    app.get(
      '/v1/unit-code-availability',
      {
        config: manager,
        schema: {
          operationId: 'checkUnitCode',
          tags,
          summary: 'Is a unit code (Paybill account number) valid and free?',
          querystring: CodeAvailabilityQuery,
          response: { 200: CodeAvailability, ...problemResponses() },
        },
      },
      async (req) => accounts.codeAvailability(req, req.query.code),
    );
    app.post(
      '/v1/properties/:propertyId/units',
      {
        config: manager,
        schema: {
          operationId: 'createUnit',
          tags,
          summary: 'Add a unit to a property',
          params: PropertyIdParam,
          body: CreateUnitBody,
          response: { 201: Unit, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await accounts.createUnit(req, req.params.propertyId, req.body)),
    );
    app.post(
      '/v1/properties/:propertyId/units/bulk',
      {
        config: manager,
        schema: {
          operationId: 'bulkCreateUnits',
          tags,
          summary: 'Add many numbered units at once (e.g. A1–A10)',
          description: 'All-or-nothing: if any generated code is taken, nothing is created.',
          params: PropertyIdParam,
          body: BulkCreateUnitsBody,
          response: { 201: UnitList, ...problemResponses(404, 409, 422) },
        },
      },
      async (req, reply) =>
        reply
          .status(201)
          .send({ items: await accounts.bulkCreateUnits(req, req.params.propertyId, req.body) }),
    );
    app.get(
      '/v1/units/:id',
      {
        schema: {
          operationId: 'getUnit',
          tags,
          summary: 'A unit',
          params: IdParam,
          response: { 200: Unit, ...problemResponses(404) },
        },
      },
      async (req) => accounts.getUnit(req, req.params.id),
    );
    app.patch(
      '/v1/units/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateUnit',
          tags,
          summary: 'Update a unit',
          params: IdParam,
          body: UpdateUnitBody,
          response: { 200: Unit, ...problemResponses(404, 409, 422) },
        },
      },
      async (req) => accounts.updateUnit(req, req.params.id, req.body),
    );
    app.post(
      '/v1/units/:id/archive',
      {
        config: manager,
        schema: {
          operationId: 'archiveUnit',
          tags,
          summary: 'Archive a unit (its code stays reserved)',
          params: IdParam,
          response: { 200: Unit, ...problemResponses(404) },
        },
      },
      async (req) => accounts.archiveUnit(req, req.params.id),
    );
  };
}
