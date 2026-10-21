import { MemorySmsSender } from '@kejasha/integrations-africastalking';
import { MemoryEmailSender } from '@kejasha/integrations-resend';
import type { Job } from 'bullmq';
import { expect, it } from 'vitest';
import { notificationHandlers } from './notifications';

const job = {} as Job;
const data = (topic: string, payload: Record<string, unknown>) => ({
  outboxId: '1',
  orgId: null,
  topic,
  payload,
});

it('sends rendered email and SMS, and rejects malformed payloads', async () => {
  const email = new MemoryEmailSender();
  const sms = new MemorySmsSender();
  const h = notificationHandlers({ email, sms });

  await h['notifications.email']!(
    data('notifications.email', { to: 'a@b.test', subject: 'S', text: 'T' }),
    job,
  );
  await h['notifications.sms']!(
    data('notifications.sms', { to: '+254712345678', message: 'Hi' }),
    job,
  );
  expect(email.lastTo('a@b.test')?.subject).toBe('S');
  expect(sms.lastTo('+254712345678')?.message).toBe('Hi');

  await expect(
    h['notifications.sms']!(data('notifications.sms', { to: '0712', message: 'x' }), job),
  ).rejects.toThrow();
});
