import { schema } from '@kejasha/db';
import type { TopicHandlers } from '@kejasha/jobs';
import type { AppDeps } from '../deps';
import { systemCtx } from '../lib/ctx';
import { createLeasing } from '../modules/leasing';

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
] as const;

/**
 * Handlers the worker runs with the API's own services (same code path as HTTP, system actor).
 * One org failing never stops the others; the job fails at the end so BullMQ retries it, and the
 * run is idempotent so already-billed orgs are no-ops on retry.
 */
export function createJobHandlers(deps: AppDeps, log: JobLogger): { invoicing: TopicHandlers } {
  const leasing = createLeasing(deps);
  return {
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
