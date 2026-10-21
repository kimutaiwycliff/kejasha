import { sql, withAdmin, type Db } from '@kejasha/db';
import type { Queue } from 'bullmq';
import { DEFAULT_JOB_OPTIONS, queueForTopic, type QueueName } from './queues';

export interface RelayOptions {
  batchSize?: number;
  /** Base retry delay when Redis rejects an add (doubles per attempt, capped at 5 min). */
  retryDelayMs?: number;
}

interface PendingRow extends Record<string, unknown> {
  id: bigint;
  org_id: string | null;
  topic: string;
  payload: Record<string, unknown>;
  attempts: number;
}

export interface JobData {
  outboxId: string;
  orgId: string | null;
  topic: string;
  payload: Record<string, unknown>;
}

/**
 * Move one batch of committed outbox rows into BullMQ. Safe to run concurrently (SKIP LOCKED)
 * and safe to crash mid-way: the jobId is derived from the outbox id, so a re-add is a no-op.
 * Returns the number of rows dispatched.
 */
export async function relayOnce(
  db: Db,
  queues: Record<QueueName, Queue>,
  opts: RelayOptions = {},
): Promise<number> {
  const batchSize = opts.batchSize ?? 100;
  const retryDelayMs = opts.retryDelayMs ?? 1_000;

  return withAdmin(db, async (tx) => {
    const { rows } = await tx.execute<PendingRow>(sql`
      SELECT id, org_id, topic, payload, attempts
        FROM outbox
       WHERE dispatched_at IS NULL AND available_at <= now()
       ORDER BY id
       LIMIT ${batchSize}
       FOR UPDATE SKIP LOCKED`);

    let dispatched = 0;
    for (const row of rows) {
      const data: JobData = {
        outboxId: String(row.id),
        orgId: row.org_id,
        topic: row.topic,
        payload: row.payload,
      };
      try {
        await queues[queueForTopic(row.topic)].add(row.topic, data, {
          ...DEFAULT_JOB_OPTIONS,
          jobId: `outbox-${row.id}`,
        });
        await tx.execute(sql`UPDATE outbox SET dispatched_at = now() WHERE id = ${row.id}`);
        dispatched++;
      } catch (err) {
        const delay = Math.min(retryDelayMs * 2 ** row.attempts, 300_000);
        await tx.execute(sql`
          UPDATE outbox
             SET attempts = attempts + 1,
                 last_error = ${err instanceof Error ? err.message : String(err)},
                 available_at = now() + make_interval(secs => ${delay / 1000})
           WHERE id = ${row.id}`);
      }
    }
    return dispatched;
  });
}
