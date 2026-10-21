import type { QueueName, TopicHandlers } from '@kejasha/jobs';

/**
 * Topic handlers per queue. Modules add theirs as phases land (B2 invoicing, B3 payments, …).
 * A topic with no handler fails its job and ends in the dead-letter queue — never silently dropped.
 */
export const handlers: Record<QueueName, TopicHandlers> = {
  default: {},
  notifications: {},
  invoicing: {},
  payments: {},
  ical: {},
  reports: {},
};
