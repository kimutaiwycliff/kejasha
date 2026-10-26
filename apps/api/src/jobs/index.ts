import { schema } from '@kejasha/db';
import type { TopicHandlers } from '@kejasha/jobs';
import type { AppDeps } from '../deps';
import { systemCtx } from '../lib/ctx';
import { createLeasing } from '../modules/leasing';
import { createCompliance } from '../modules/compliance';
import { createIdentityService } from '../modules/identity';
import { createPayments } from '../modules/payments';
import { createSubscriptionService } from '../modules/subscriptions';
import { runBackup } from '../ops/backup';
import { createShortStay } from '../modules/shortstay';

export interface JobLogger {
  info(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

/** Scheduled cron times (Africa/Nairobi). The worker registers them as BullMQ job schedulers. */
export const SCHEDULES = [
  {
    id: 'invoicing-daily',
    queue: 'invoicing',
    topic: 'invoicing.daily_run',
    pattern: '15 0 * * *',
    tz: 'Africa/Nairobi',
  },
  {
    id: 'stk-reconcile',
    queue: 'payments',
    topic: 'payments.stk_reconcile',
    pattern: '*/5 * * * *',
    tz: 'Africa/Nairobi',
  },
  {
    id: 'compliance-daily',
    queue: 'compliance',
    topic: 'compliance.daily_run',
    pattern: '0 7 * * *',
    tz: 'Africa/Nairobi',
  },
  {
    id: 'billing-daily',
    queue: 'billing',
    topic: 'billing.daily_run',
    pattern: '0 6 * * *',
    tz: 'Africa/Nairobi',
  },
  {
    id: 'backup-nightly',
    queue: 'ops',
    topic: 'ops.backup',
    pattern: '30 2 * * *',
    tz: 'Africa/Nairobi',
  },
  {
    id: 'ical-sync',
    queue: 'ical',
    topic: 'ical.sync_all',
    pattern: '*/20 * * * *',
    tz: 'Africa/Nairobi',
  },
] as const;

/**
 * Handlers the worker runs with the API's own services (same code path as HTTP, system actor).
 * One org failing never stops the others; the job fails at the end so BullMQ retries it, and the
 * run is idempotent so already-billed orgs are no-ops on retry.
 */
export function createJobHandlers(
  deps: AppDeps,
  log: JobLogger,
): {
  invoicing: TopicHandlers;
  payments: TopicHandlers;
  ical: TopicHandlers;
  compliance: TopicHandlers;
  billing: TopicHandlers;
  ops: TopicHandlers;
} {
  const leasing = createLeasing(deps);
  const payments = createPayments(deps);
  const shortStay = createShortStay(deps);
  const identity = createIdentityService(deps, { orgCreated: [], memberRemoved: [] });
  const compliance = createCompliance(deps, { staffContacts: identity.staffContacts });
  const subscriptions = createSubscriptionService(deps, { staffContacts: identity.staffContacts });
  return {
    ops: {
      // Nightly database backup to the backups bucket (R2, off the VM); failures retry and alert.
      'ops.backup': async () => {
        const r = await runBackup(deps);
        log.info(r, 'database backup');
      },
    },
    billing: {
      // Renewals (saved card), reminders on days 0/1/3/7, suspension after the grace period.
      'billing.daily_run': async () => {
        const today = deps.clock.today();
        const orgs = await deps.db.owner
          .select({ id: schema.organization.id })
          .from(schema.organization);
        const failed: string[] = [];
        for (const { id } of orgs) {
          try {
            const outcome = await subscriptions.runDaily(id, today);
            if (outcome !== 'ok' && outcome !== 'none')
              log.info({ orgId: id, outcome }, 'billing run');
          } catch (err) {
            failed.push(id);
            log.error({ orgId: id, err }, 'billing run failed for org');
          }
        }
        if (failed.length)
          throw new Error(`Billing run failed for ${failed.length} org(s): ${failed.join(', ')}`);
      },
    },
    compliance: {
      // Licence expiry reminders and the MRI reminder on the 15th (deduped per recipient).
      'compliance.daily_run': async () => {
        const today = deps.clock.today();
        const orgs = await deps.db.owner
          .select({ id: schema.organization.id })
          .from(schema.organization);
        const failed: string[] = [];
        for (const { id } of orgs) {
          try {
            const r = await compliance.reminders.runDaily(systemCtx(id), today);
            if (r.licenceReminders || r.mriReminders)
              log.info({ orgId: id, ...r }, 'compliance reminders');
          } catch (err) {
            failed.push(id);
            log.error({ orgId: id, err }, 'compliance run failed for org');
          }
        }
        if (failed.length)
          throw new Error(
            `Compliance run failed for ${failed.length} org(s): ${failed.join(', ')}`,
          );
      },
    },
    ical: {
      // Read-only iCal import (ADR-010). Feed errors are recorded on the feed, not thrown.
      'ical.sync_all': async () => {
        const orgs = await deps.db.owner
          .select({ id: schema.organization.id })
          .from(schema.organization);
        for (const { id } of orgs) {
          try {
            const results = await shortStay.ical.syncAll(systemCtx(id));
            const changed = results.filter((r) => r.added || r.updated || r.removed || r.error);
            if (changed.length) log.info({ orgId: id, feeds: changed }, 'ical feeds synced');
          } catch (err) {
            log.error({ orgId: id, err }, 'ical sync failed for org');
          }
        }
      },
    },
    payments: {
      // Pending STK requests: confirm with Safaricom or time out (ADR-008).
      'payments.stk_reconcile': async () => {
        const orgs = await deps.db.owner
          .select({ id: schema.organization.id })
          .from(schema.organization);
        for (const { id } of orgs) {
          try {
            const n = await payments.daraja.reconcilePending(systemCtx(id));
            if (n) log.info({ orgId: id, updated: n }, 'stk requests reconciled');
          } catch (err) {
            log.error({ orgId: id, err }, 'stk reconcile failed for org');
          }
        }
      },
    },
    invoicing: {
      'invoicing.daily_run': async () => {
        const asOf = deps.clock.today();
        const orgs = await deps.db.owner
          .select({ id: schema.organization.id })
          .from(schema.organization);
        const failed: string[] = [];
        for (const { id } of orgs) {
          try {
            const result = await leasing.ops.runDaily(systemCtx(id), asOf);
            if (result.invoicesCreated || result.lateFeesCreated || result.remindersQueued)
              log.info({ orgId: id, ...result }, 'daily billing run');
          } catch (err) {
            failed.push(id);
            log.error({ orgId: id, err }, 'daily billing run failed for org');
          }
        }
        if (failed.length)
          throw new Error(`Daily run failed for ${failed.length} org(s): ${failed.join(', ')}`);
      },
    },
  };
}
