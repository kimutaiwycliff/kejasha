import {
  CreateLicenceBody,
  csvResponse,
  FileMriBody,
  IdParam,
  LandlordIdParam,
  Licence,
  LicenceList,
  LicenceQuery,
  MriDetail,
  MriMonth,
  PeriodQuery,
  problemResponses,
  TenantPinRegister,
  UpdateLicenceBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { sendCsv } from '../../lib/csv';
import { ctxOf } from '../../lib/ctx';
import type { Licences } from './licences';
import type { Mri } from './mri';

const NoContent = z.undefined();

export interface ComplianceParts {
  mri: Mri;
  licences: Licences;
}

export function complianceRoutes({
  mri,
  licences,
}: ComplianceParts): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['compliance'];
    const agent = { minRole: 'agent' as const };
    const manager = { minRole: 'manager' as const };

    // ── Monthly Rental Income ─────────────────────────────────────────────────────────────
    app.get(
      '/v1/compliance/mri',
      {
        config: { ...manager, allowViewer: true },
        schema: {
          operationId: 'getMriMonth',
          tags,
          summary: 'MRI (7.5% of residential rent received) per landlord for a month',
          querystring: PeriodQuery,
          response: { 200: MriMonth, ...problemResponses() },
        },
      },
      async (req) => {
        const ctx = ctxOf(req);
        return mri.month(ctx, req.query.period, ctx.scope);
      },
    );
    app.get(
      '/v1/compliance/mri/:clientLandlordId',
      {
        config: manager,
        schema: {
          operationId: 'getMriDetail',
          tags,
          summary: "A landlord's MRI for a month, per tenant",
          params: LandlordIdParam,
          querystring: PeriodQuery,
          response: { 200: MriDetail, ...problemResponses(404) },
        },
      },
      async (req) => mri.detail(ctxOf(req), req.params.clientLandlordId, req.query.period),
    );
    app.get(
      '/v1/compliance/mri/:clientLandlordId/erits.csv',
      {
        config: manager,
        schema: {
          operationId: 'exportMriErits',
          tags,
          summary: 'eRITS-ready CSV: tenant PIN, name, unit, rent received, tax',
          params: LandlordIdParam,
          querystring: PeriodQuery,
          response: { 200: csvResponse('MRI lines for the month'), ...problemResponses(404) },
        },
      },
      async (req, reply) =>
        sendCsv(
          reply,
          `mri-${req.query.period}.csv`,
          await mri.eritsCsv(ctxOf(req), req.params.clientLandlordId, req.query.period),
        ),
    );
    app.post(
      '/v1/compliance/mri/:clientLandlordId/filings',
      {
        config: manager,
        schema: {
          operationId: 'fileMri',
          tags,
          summary: 'Mark a month filed with KRA (snapshots the figures)',
          params: LandlordIdParam,
          body: FileMriBody,
          response: { 201: MriDetail, ...problemResponses(404, 409) },
        },
      },
      async (req, reply) =>
        reply.status(201).send(await mri.file(ctxOf(req), req.params.clientLandlordId, req.body)),
    );
    app.delete(
      '/v1/compliance/mri-filings/:id',
      {
        config: manager,
        schema: {
          operationId: 'deleteMriFiling',
          tags,
          summary: 'Undo a filing mark (e.g. marked against the wrong month)',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404) },
        },
      },
      async (req, reply) => {
        await mri.unfile(ctxOf(req), req.params.id);
        return reply.status(204).send();
      },
    );
    app.get(
      '/v1/compliance/tenant-pins',
      {
        config: manager,
        schema: {
          operationId: 'getTenantPinRegister',
          tags,
          summary: 'KRA PINs of tenants with an active lease (missing first)',
          response: { 200: TenantPinRegister, ...problemResponses() },
        },
      },
      async (req) => mri.pinRegister(ctxOf(req)),
    );

    // ── Licences ──────────────────────────────────────────────────────────────────────────
    app.get(
      '/v1/licences',
      {
        config: agent,
        schema: {
          operationId: 'listLicences',
          tags,
          summary: 'Licences and permits by expiry date',
          querystring: LicenceQuery,
          response: { 200: LicenceList, ...problemResponses() },
        },
      },
      async (req) => licences.list(ctxOf(req), req.query),
    );
    app.post(
      '/v1/licences',
      {
        config: manager,
        schema: {
          operationId: 'createLicence',
          tags,
          summary: 'Track a licence or permit (expiry reminders at 30, 7, 1 and 0 days)',
          body: CreateLicenceBody,
          response: { 201: Licence, ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => reply.status(201).send(await licences.create(ctxOf(req), req.body)),
    );
    app.patch(
      '/v1/licences/:id',
      {
        config: manager,
        schema: {
          operationId: 'updateLicence',
          tags,
          summary: 'Edit or renew a licence',
          params: IdParam,
          body: UpdateLicenceBody,
          response: { 200: Licence, ...problemResponses(404, 422) },
        },
      },
      async (req) => licences.update(ctxOf(req), req.params.id, req.body),
    );
    app.delete(
      '/v1/licences/:id',
      {
        config: manager,
        schema: {
          operationId: 'archiveLicence',
          tags,
          summary: 'Stop tracking a licence (archived, no more reminders)',
          params: IdParam,
          response: { 204: NoContent, ...problemResponses(404) },
        },
      },
      async (req, reply) => {
        await licences.archive(ctxOf(req), req.params.id);
        return reply.status(204).send();
      },
    );
  };
}
