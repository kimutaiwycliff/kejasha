import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from '@kejasha/config';
import { createDb } from '@kejasha/db';
import { createQueues, createTopicWorker, relayOnce, type QueueName } from '@kejasha/jobs';
import type { ConnectionOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { pino } from 'pino';
import { buildHandlers } from './handlers';

const config = loadConfig();
const log = pino({ level: config.logLevel, base: { service: 'worker' } });
const db = createDb({
  ownerUrl: config.db.ownerUrl,
  authenticatedUrl: config.db.authenticatedUrl,
  applicationName: 'kejasha-worker',
});
// BullMQ requires maxRetriesPerRequest: null on its connections.
const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
}) as unknown as ConnectionOptions;
const queues = createQueues(connection);
const handlers = buildHandlers(config, log);

const workers = (Object.keys(handlers) as QueueName[]).map((queue) => {
  const { worker, deadLetter } = createTopicWorker(queue, handlers[queue], connection);
  worker.on('failed', (job, err) =>
    log.warn(
      { queue, jobId: job?.id, topic: job?.name, attempts: job?.attemptsMade, err: err.message },
      'job failed',
    ),
  );
  worker.on('error', (err) => log.error({ queue, err }, 'worker error'));
  return { worker, deadLetter };
});

let running = true;
async function relayLoop() {
  while (running) {
    try {
      const n = await relayOnce(db, queues, { batchSize: 100 });
      if (n > 0) log.debug({ dispatched: n }, 'outbox relayed');
      if (n < 100) await sleep(500);
    } catch (err) {
      log.error({ err }, 'outbox relay failed');
      await sleep(2_000);
    }
  }
}
const relay = relayLoop();
log.info({ queues: Object.keys(handlers) }, 'worker started');

async function shutdown(signal: string) {
  log.info({ signal }, 'shutting down');
  running = false;
  await relay;
  await Promise.all(
    workers.flatMap(({ worker, deadLetter }) => [worker.close(), deadLetter.close()]),
  );
  await Promise.all(Object.values(queues).map((q) => q.close()));
  await db.close();
  process.exit(0);
}
process.once('SIGTERM', () => void shutdown('SIGTERM'));
process.once('SIGINT', () => void shutdown('SIGINT'));
