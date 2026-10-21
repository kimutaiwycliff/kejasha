/** Transactional email via Resend (ADR-015). Without an API key a MemoryEmailSender is used. */
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string | undefined;
}

export interface EmailSender {
  readonly kind: 'resend' | 'memory';
  send(msg: EmailMessage): Promise<{ providerMessageId?: string }>;
}

export function createResendSender(cfg: {
  apiKey: string;
  from: string;
  fetch?: typeof fetch;
}): EmailSender {
  const doFetch = cfg.fetch ?? fetch;
  return {
    kind: 'resend',
    async send(msg) {
      const res = await doFetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: cfg.from,
          to: [msg.to],
          subject: msg.subject,
          text: msg.text,
          html: msg.html,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`Resend HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { id?: string };
      return json.id ? { providerMessageId: json.id } : {};
    },
  };
}

export class MemoryEmailSender implements EmailSender {
  readonly kind = 'memory' as const;
  readonly sent: (EmailMessage & { at: Date })[] = [];
  constructor(private readonly log?: (msg: EmailMessage) => void) {}
  async send(msg: EmailMessage) {
    this.sent.push({ ...msg, at: new Date() });
    this.log?.(msg);
    return {};
  }
  lastTo(to: string): EmailMessage | undefined {
    return this.sent.findLast((m) => m.to === to);
  }
}

export function createEmailSender(
  cfg: { apiKey: string | undefined; from: string },
  log?: (msg: EmailMessage) => void,
): EmailSender {
  return cfg.apiKey
    ? createResendSender({ apiKey: cfg.apiKey, from: cfg.from })
    : new MemoryEmailSender(log);
}
