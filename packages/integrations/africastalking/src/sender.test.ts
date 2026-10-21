import { describe, expect, it, vi } from 'vitest';
import { createAfricasTalkingSender, MemorySmsSender, SmsSendError } from './index';

const ok = (statusCode: number, status = 'Success') =>
  new Response(
    JSON.stringify({
      SMSMessageData: {
        Recipients: [{ statusCode, status, number: '+254712345678', messageId: 'ATX1' }],
      },
    }),
  );

describe("Africa's Talking sender", () => {
  it('posts form data to the sandbox for the sandbox user', async () => {
    const fetch = vi.fn(async () => ok(101));
    const sender = createAfricasTalkingSender({
      apiKey: 'k',
      username: 'sandbox',
      senderId: 'KEJASHA',
      fetch,
    });
    await expect(sender.send({ to: '+254712345678', message: 'hi' })).resolves.toEqual({
      providerMessageId: 'ATX1',
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.sandbox.africastalking.com/version1/messaging');
    expect((init.headers as Record<string, string>).apiKey).toBe('k');
    expect(String(init.body)).toBe('username=sandbox&to=%2B254712345678&message=hi&from=KEJASHA');
  });

  it('rejects when the recipient is not accepted', async () => {
    const sender = createAfricasTalkingSender({
      apiKey: 'k',
      username: 'live',
      fetch: async () => ok(403, 'InvalidPhoneNumber'),
    });
    await expect(sender.send({ to: '+254712345678', message: 'x' })).rejects.toBeInstanceOf(
      SmsSendError,
    );
  });

  it('memory sender keeps messages for tests', async () => {
    const mem = new MemorySmsSender();
    await mem.send({ to: '+254700000001', message: 'code 123456' });
    expect(mem.lastTo('+254700000001')?.message).toBe('code 123456');
  });
});
