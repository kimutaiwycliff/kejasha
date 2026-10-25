/** BullMQ queues (ADR-014). Topics map to queues by their first segment, e.g. `notifications.sms`. */
export const QUEUES = [
  'default',
  'notifications',
  'invoicing',
  'payments',
  'ical',
  'compliance',
  'billing',
  'reports',
] as const;
export type QueueName = (typeof QUEUES)[number];

export const DEAD_LETTER_QUEUE = 'dead-letter';

export function queueForTopic(topic: string): QueueName {
  const head = topic.split('.')[0] as QueueName;
  return (QUEUES as readonly string[]).includes(head) ? head : 'default';
}

/** Retries with exponential backoff; completed jobs kept 24h so relay re-adds stay no-ops. */
export const DEFAULT_JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 24 * 3600 },
  removeOnFail: false,
} as const;
