/**
 * Africa's Talking SMS (ADR-015). Without an API key a MemorySmsSender is used: messages are kept
 * in memory (tests/journeys read OTPs from it) and logged in development.
 */
export interface SmsMessage {
  /** E.164, e.g. +254712345678 */
  to: string;
  message: string;
}

export interface SmsResult {
  providerMessageId?: string;
}

export interface SmsSender {
  readonly kind: 'africastalking' | 'memory';
  send(msg: SmsMessage): Promise<SmsResult>;
}

export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
  senderId?: string | undefined;
  /** Defaults to the sandbox host when username is "sandbox". */
  baseUrl?: string;
  fetch?: typeof fetch;
}

export class SmsSendError extends Error {
  constructor(
    message: string,
    public readonly status?: string,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

interface AtResponse {
  SMSMessageData?: {
    Message?: string;
    Recipients?: { status: string; statusCode: number; messageId?: string; number: string }[];
  };
}

export function createAfricasTalkingSender(cfg: AfricasTalkingConfig): SmsSender {
  const base =
    cfg.baseUrl ??
    (cfg.username === 'sandbox'
      ? 'https://api.sandbox.africastalking.com'
      : 'https://api.africastalking.com');
  const doFetch = cfg.fetch ?? fetch;
  return {
    kind: 'africastalking',
    async send({ to, message }) {
      const body = new URLSearchParams({ username: cfg.username, to, message });
      if (cfg.senderId) body.set('from', cfg.senderId);
      const res = await doFetch(`${base}/version1/messaging`, {
        method: 'POST',
        headers: {
          apiKey: cfg.apiKey,
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new SmsSendError(`Africa's Talking HTTP ${res.status}`);
      const json = (await res.json()) as AtResponse;
      const recipient = json.SMSMessageData?.Recipients?.[0];
      // 100 Processed, 101 Sent, 102 Queued
      if (!recipient || recipient.statusCode > 102) {
        throw new SmsSendError(
          `SMS not accepted: ${recipient?.status ?? json.SMSMessageData?.Message ?? 'no recipient'}`,
          recipient?.status,
        );
      }
      return recipient.messageId ? { providerMessageId: recipient.messageId } : {};
    },
  };
}

export class MemorySmsSender implements SmsSender {
  readonly kind = 'memory' as const;
  readonly sent: (SmsMessage & { at: Date })[] = [];
  constructor(private readonly log?: (msg: SmsMessage) => void) {}

  async send(msg: SmsMessage): Promise<SmsResult> {
    this.sent.push({ ...msg, at: new Date() });
    this.log?.(msg);
    return {};
  }

  lastTo(to: string): SmsMessage | undefined {
    return this.sent.findLast((m) => m.to === to);
  }
}

export function createSmsSender(
  cfg: { apiKey: string | undefined; username: string; senderId: string | undefined },
  log?: (msg: SmsMessage) => void,
): SmsSender {
  return cfg.apiKey
    ? createAfricasTalkingSender({
        apiKey: cfg.apiKey,
        username: cfg.username,
        senderId: cfg.senderId,
      })
    : new MemorySmsSender(log);
}
