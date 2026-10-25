import {
  CollectionsReport,
  csvResponse,
  DateRangeQuery,
  ExportParams,
  ExportQuery,
  OccupancyReport,
  OwnerDashboard,
  OwnerStatement,
  OwnerStatementList,
  OwnerStatementQuery,
  PeriodLandlordQuery,
  problemResponses,
  RentRoll,
  RentRollQuery,
  StatementParams,
  StatementPeriodQuery,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppDeps } from '../../deps';
import { sendCsv } from '../../lib/csv';
import { ctxOf } from '../../lib/ctx';
import type { ExportCsv } from './exports';
import type { Reporting } from './service';

export interface ReportingParts {
  reporting: Reporting;
  statementPdf: (
    ctx: ReturnType<typeof ctxOf>,
    landlordId: string,
    period: string,
  ) => Promise<Buffer>;
  exportCsv: ExportCsv;
}

/** Managers and owners see everything (optionally one landlord); viewers only their landlord. */
export function reportingRoutes({
  reporting,
  statementPdf,
  exportCsv,
}: ReportingParts): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['reporting'];
    const owners = { minRole: 'manager' as const, allowViewer: true };

    app.get(
      '/v1/reports/owner-dashboard',
      {
        config: owners,
        schema: {
          operationId: 'getOwnerDashboard',
          tags,
          summary: 'Collected, spent, fees, net, arrears, occupancy and a 6-month trend',
          querystring: PeriodLandlordQuery,
          response: { 200: OwnerDashboard, ...problemResponses(404) },
        },
      },
      async (req) => reporting.dashboard(ctxOf(req), req.query.period, req.query.clientLandlordId),
    );
    app.get(
      '/v1/owner-statements',
      {
        config: owners,
        schema: {
          operationId: 'listOwnerStatements',
          tags,
          summary: 'Monthly statement totals per landlord',
          querystring: OwnerStatementQuery,
          response: { 200: OwnerStatementList, ...problemResponses(404) },
        },
      },
      async (req) => reporting.statements(ctxOf(req), req.query.period, req.query.clientLandlordId),
    );
    app.get(
      '/v1/owner-statements/:clientLandlordId',
      {
        config: owners,
        schema: {
          operationId: 'getOwnerStatement',
          tags,
          summary: "A landlord's monthly statement: income per unit, expenses, fee, net",
          params: StatementParams,
          querystring: StatementPeriodQuery,
          response: { 200: OwnerStatement, ...problemResponses(404) },
        },
      },
      async (req) => reporting.statement(ctxOf(req), req.params.clientLandlordId, req.query.period),
    );
    app.get(
      '/v1/owner-statements/:clientLandlordId/pdf',
      {
        config: owners,
        schema: {
          operationId: 'getOwnerStatementPdf',
          tags,
          summary: 'The monthly statement as a PDF (agency-branded for client landlords)',
          params: StatementParams,
          querystring: StatementPeriodQuery,
          response: {
            200: {
              description: 'PDF statement',
              content: { 'application/pdf': { schema: z.string().meta({ format: 'binary' }) } },
            },
            ...problemResponses(404),
          },
        },
      },
      async (req, reply) => {
        const pdf = await statementPdf(ctxOf(req), req.params.clientLandlordId, req.query.period);
        return reply
          .type('application/pdf')
          .serializer((p: unknown) => p as string)
          .send(pdf as unknown as string);
      },
    );
    app.get(
      '/v1/reports/rent-roll',
      {
        config: owners,
        schema: {
          operationId: 'getRentRoll',
          tags,
          summary: 'Every long-term unit: tenant, current rent, lease dates, balance',
          querystring: RentRollQuery,
          response: { 200: RentRoll, ...problemResponses(404) },
        },
      },
      async (req) => reporting.rentRoll(ctxOf(req), req.query),
    );
    app.get(
      '/v1/reports/collections',
      {
        config: owners,
        schema: {
          operationId: 'getCollectionsReport',
          tags,
          summary: 'Money received by day, method, source and property',
          querystring: DateRangeQuery,
          response: { 200: CollectionsReport, ...problemResponses(404, 422) },
        },
      },
      async (req) => reporting.collections(ctxOf(req), req.query),
    );
    app.get(
      '/v1/reports/occupancy',
      {
        config: owners,
        schema: {
          operationId: 'getOccupancyReport',
          tags,
          summary: 'Long-term units let and short-stay nights sold for a month',
          querystring: PeriodLandlordQuery,
          response: { 200: OccupancyReport, ...problemResponses(404) },
        },
      },
      async (req) => reporting.occupancy(ctxOf(req), req.query.period, req.query.clientLandlordId),
    );
    app.get(
      '/v1/exports/:dataset',
      {
        config: owners,
        schema: {
          operationId: 'exportCsv',
          tags,
          summary: 'Download a list as CSV',
          description:
            'clientLandlordId narrows rent-roll, collections and unit-expenses. Viewers may export only those three.',
          params: ExportParams,
          querystring: ExportQuery,
          response: { 200: csvResponse('The dataset as CSV'), ...problemResponses(404, 422) },
        },
      },
      async (req, reply) => {
        const out = await exportCsv(ctxOf(req), req.params.dataset, req.query);
        return sendCsv(reply, out.filename, out.body);
      },
    );
  };
}
