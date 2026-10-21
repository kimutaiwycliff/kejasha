import type { EmailSender } from '@kejasha/integrations-resend';
import type { SmsSender } from '@kejasha/integrations-africastalking';
import type { TopicHandlers } from '@kejasha/jobs';
import { z } from 'zod';

const EmailPayload = z.object({
  to: z.email(),
  subject: z.string().min(1),
  text: z.string().min(1),
  html: z.string().optional(),
});
const SmsPayload = z.object({
  to: z.string().regex(/^\+254[17]\d{8}$/),
  message: z.string().min(1).max(918),
});

/**
 * Delivery of fully rendered messages (the producing module owns the content). A malformed payload
 * fails the job — after retries it lands in the dead-letter queue rather than vanishing.
 */
export function notificationHandlers(senders: {
  email: EmailSender;
  sms: SmsSender;
}): TopicHandlers {
  return {
    'notifications.email': async ({ payload }) => {
      await senders.email.send(EmailPayload.parse(payload));
    },
    'notifications.sms': async ({ payload }) => {
      await senders.sms.send(SmsPayload.parse(payload));
    },
  };
}
