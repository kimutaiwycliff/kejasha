import {
  AuditList,
  OperatorOrgDetail,
  OperatorOrgPage,
  OperatorOrgQuery,
  OrgIdParam,
  Plan,
  PlanCodeParam,
  PlanList,
  problemResponses,
  SubscriptionAction,
  UpdatePlanBody,
} from '@kejasha/contracts';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AppDeps } from '../../deps';
import type { OperatorService } from './service';

/** Kejasha staff console API (`auth: 'operator'`; every request is logged). */
export function operatorRoutes(op: OperatorService): FastifyPluginAsyncZod<AppDeps> {
  return async (app) => {
    const tags = ['operator'];
    const config = { auth: 'operator' as const };

    app.get(
      '/v1/operator/orgs',
      {
        config,
        schema: {
          operationId: 'operatorListOrgs',
          tags,
          summary: 'Customer organizations with plan, status, members and units',
          querystring: OperatorOrgQuery,
          response: { 200: OperatorOrgPage, ...problemResponses(422) },
        },
      },
      async (req) => op.listOrgs(req.query),
    );
    app.get(
      '/v1/operator/orgs/:orgId',
      {
        config,
        schema: {
          operationId: 'operatorGetOrg',
          tags,
          summary: 'An organization with owners and Kejasha invoices',
          params: OrgIdParam,
          response: { 200: OperatorOrgDetail, ...problemResponses(404) },
        },
      },
      async (req) => op.getOrg(req.params.orgId),
    );
    app.post(
      '/v1/operator/orgs/:orgId/subscription',
      {
        config,
        schema: {
          operationId: 'operatorSubscriptionAction',
          tags,
          summary: 'Grant a trial, extend, change plan, suspend, reactivate or cancel',
          params: OrgIdParam,
          body: SubscriptionAction,
          response: { 200: OperatorOrgDetail, ...problemResponses(404, 422) },
        },
      },
      async (req) => op.act(req.params.orgId, req.actor!.userId, req.body, req.id),
    );
    app.get(
      '/v1/operator/orgs/:orgId/audit',
      {
        config,
        schema: {
          operationId: 'operatorOrgAudit',
          tags,
          summary: "The organization's audit log (latest 200)",
          params: OrgIdParam,
          response: { 200: AuditList, ...problemResponses(404) },
        },
      },
      async (req) => ({ items: await op.audit(req.params.orgId) }),
    );
    app.get(
      '/v1/operator/plans',
      {
        config,
        schema: {
          operationId: 'operatorListPlans',
          tags,
          summary: 'Plan prices',
          response: { 200: PlanList, ...problemResponses() },
        },
      },
      async () => ({ items: await op.plans() }),
    );
    app.patch(
      '/v1/operator/plans/:code',
      {
        config,
        schema: {
          operationId: 'operatorUpdatePlan',
          tags,
          summary: 'Change plan prices (applies from each org’s next invoice)',
          params: PlanCodeParam,
          body: UpdatePlanBody,
          response: { 200: Plan, ...problemResponses(404) },
        },
      },
      async (req) => op.updatePlan(req.params.code, req.body),
    );
  };
}
