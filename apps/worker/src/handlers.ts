import { createJobHandlers } from '@kejasha/api/jobs';
import { createDeps } from '@kejasha/api/runtime';
import type { Config } from '@kejasha/config';
import { createSmsSender } from '@kejasha/integrations-africastalking';
import { createEmailSender } from '@kejasha/integrations-resend';
import type { QueueName, TopicHandlers } from '@kejasha/jobs';
import type { Logger } from 'pino';
import { notificationHandlers } from './notifications';

/**
 * Topic handlers per queue. Modules add theirs as phases land (B2 invoicing, B3 payments, …).
 * A topic with no handler fails its job and ends in the dead-letter queue — never silently dropped.
 */
export function buildHandlers(config: Config, log: Logger): Record<QueueName, TopicHandlers> {
  const dev = config.env === 'development';
  const sms = createSmsSender(
    config.africasTalking,
    (m) => dev && log.info({ to: m.to, message: m.message }, 'sms (no provider)'),
  );
  const email = createEmailSender(
    { apiKey: config.email.resendApiKey, from: config.domain.emailFrom },
    (m) => dev && log.info({ to: m.to, subject: m.subject, text: m.text }, 'email (no provider)'),
  );
  const jobs = createJobHandlers(createDeps(config), log);
  return {
    default: {},
    notifications: notificationHandlers({ email, sms }),
    invoicing: jobs.invoicing,
    payments: jobs.payments,
    ical: jobs.ical,
    compliance: jobs.compliance,
    reports: {},
  };
}
