import { Queue, Worker, type ConnectionOptions, type Job, type Processor } from 'bullmq';
import { DEAD_LETTER_QUEUE, QUEUES, type QueueName } from './queues';
import type { JobData } from './relay';

export type TopicHandler = (data: JobData, job: Job<JobData>) => Promise<void>;
export type TopicHandlers = Record<string, TopicHandler>;

export function createQueues(
  connection: ConnectionOptions,
  prefix?: string,
): Record<QueueName, Queue> {
  return Object.fromEntries(
    QUEUES.map((name) => [name, new Queue(name, { connection, ...(prefix ? { prefix } : {}) })]),
  ) as Record<QueueName, Queue>;
}

/**
 * A worker that routes jobs to topic handlers. Unknown topics fail loudly. When a job exhausts its
 * retries it is copied to the dead-letter queue with its last error, for inspection/replay.
 */
export function createTopicWorker(
  queue: QueueName,
  handlers: TopicHandlers,
  connection: ConnectionOptions,
  opts: { prefix?: string; concurrency?: number } = {},
): { worker: Worker<JobData>; deadLetter: Queue } {
  const prefix = opts.prefix ? { prefix: opts.prefix } : {};
  const deadLetter = new Queue(DEAD_LETTER_QUEUE, { connection, ...prefix });

  const processor: Processor<JobData> = async (job) => {
    const handler = handlers[job.name];
    if (!handler) throw new Error(`No handler for topic "${job.name}" on queue "${queue}"`);
    await handler(job.data, job);
  };

  const worker = new Worker<JobData>(queue, processor, {
    connection,
    concurrency: opts.concurrency ?? 5,
    ...prefix,
  });

  worker.on('failed', (job, err) => {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade < maxAttempts) return;
    void deadLetter.add(
      job.name,
      {
        queue,
        jobId: job.id,
        data: job.data,
        error: err.message,
        failedAt: new Date().toISOString(),
      },
      { jobId: `dlq-${queue}-${job.id}`, removeOnComplete: false, removeOnFail: false },
    );
  });

  return { worker, deadLetter };
}
