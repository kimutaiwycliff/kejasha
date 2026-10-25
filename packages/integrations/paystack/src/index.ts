/**
 * Paystack — Kejasha's own subscription billing only (never rent: ADR-008).
 * https://paystack.com/docs/api — amounts are in the currency's subunit (KES cents).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export interface PaystackAuthorization {
  authorizationCode: string;
  reusable: boolean;
  brand: string | null;
  last4: string | null;
}

export interface PaystackTransaction {
  reference: string;
  status: 'success' | 'failed' | 'abandoned' | 'pending' | string;
  amountCents: bigint;
  currency: string;
  paidAt: Date | null;
  channel: string | null;
  customerCode: string | null;
  email: string | null;
  authorization: PaystackAuthorization | null;
  metadata: Record<string, unknown>;
}

export interface InitializeInput {
  email: string;
  amountCents: bigint;
  reference: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface PaystackClient {
  readonly configured: boolean;
  initialize(input: InitializeInput): Promise<{ authorizationUrl: string; reference: string }>;
  verify(reference: string): Promise<PaystackTransaction>;
  chargeAuthorization(input: {
    email: string;
    amountCents: bigint;
    reference: string;
    authorizationCode: string;
    metadata?: Record<string, unknown>;
  }): Promise<PaystackTransaction>;
}

export class PaystackError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaystackError';
  }
}

/** `x-paystack-signature` is the hex HMAC-SHA512 of the raw request body with the secret key. */
export function verifySignature(
  secretKey: string,
  rawBody: string | Buffer,
  signature: string | undefined,
): boolean {
  if (!signature || !/^[0-9a-f]{128}$/i.test(signature)) return false;
  const expected = createHmac('sha512', secretKey).update(rawBody).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function sign(secretKey: string, rawBody: string): string {
  return createHmac('sha512', secretKey).update(rawBody).digest('hex');
}

/** Parse a transaction object (API response `data` or webhook `data`). */
export function parseTransaction(d: Record<string, unknown>): PaystackTransaction {
  const auth = d.authorization as Record<string, unknown> | null | undefined;
  const customer = d.customer as Record<string, unknown> | null | undefined;
  return {
    reference: String(d.reference ?? ''),
    status: String(d.status ?? ''),
    amountCents: BigInt(Math.round(Number(d.amount ?? 0))),
    currency: String(d.currency ?? 'KES'),
    paidAt: d.paid_at || d.paidAt ? new Date(String(d.paid_at ?? d.paidAt)) : null,
    channel: (d.channel as string | undefined) ?? null,
    customerCode: (customer?.customer_code as string | undefined) ?? null,
    email: (customer?.email as string | undefined) ?? null,
    authorization: auth?.authorization_code
      ? {
          authorizationCode: String(auth.authorization_code),
          reusable: Boolean(auth.reusable),
          brand: (auth.brand as string | undefined) ?? null,
          last4: (auth.last4 as string | undefined) ?? null,
        }
      : null,
    metadata: (d.metadata && typeof d.metadata === 'object' ? d.metadata : {}) as Record<
      string,
      unknown
    >,
  };
}

export function createPaystackClient(cfg: {
  secretKey?: string | undefined;
  baseUrl?: string;
  fetch?: typeof fetch;
}): PaystackClient {
  const base = cfg.baseUrl ?? 'https://api.paystack.co';
  const doFetch = cfg.fetch ?? fetch;
  async function call(method: 'GET' | 'POST', path: string, body?: unknown) {
    if (!cfg.secretKey) throw new PaystackError('not_configured', 'Paystack is not configured.');
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${cfg.secretKey}`, 'content-type': 'application/json' },
      body: body === undefined ? null : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const json = (await res.json().catch(() => ({}))) as {
      status?: boolean;
      message?: string;
      data?: unknown;
    };
    if (!res.ok || json.status === false)
      throw new PaystackError(
        'request_failed',
        json.message ?? `Paystack answered HTTP ${res.status}`,
      );
    return json.data as Record<string, unknown>;
  }
  return {
    configured: Boolean(cfg.secretKey),
    async initialize(i) {
      const d = await call('POST', '/transaction/initialize', {
        email: i.email,
        amount: Number(i.amountCents),
        currency: 'KES',
        reference: i.reference,
        ...(i.callbackUrl ? { callback_url: i.callbackUrl } : {}),
        metadata: i.metadata ?? {},
      });
      return { authorizationUrl: String(d.authorization_url), reference: String(d.reference) };
    },
    async verify(reference) {
      return parseTransaction(
        await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`),
      );
    },
    async chargeAuthorization(i) {
      return parseTransaction(
        await call('POST', '/transaction/charge_authorization', {
          email: i.email,
          amount: Number(i.amountCents),
          currency: 'KES',
          reference: i.reference,
          authorization_code: i.authorizationCode,
          metadata: i.metadata ?? {},
        }),
      );
    },
  };
}

/** In-memory Paystack for tests: checkouts, verifications and card charges you control. */
export class FakePaystackClient implements PaystackClient {
  readonly configured = true;
  /** Transactions by reference, as Paystack would report them. */
  readonly transactions = new Map<string, PaystackTransaction>();
  initialized: InitializeInput[] = [];
  /** Next `chargeAuthorization` outcome. */
  nextCharge: 'success' | 'failed' = 'success';

  async initialize(i: InitializeInput) {
    this.initialized.push(i);
    this.transactions.set(i.reference, {
      reference: i.reference,
      status: 'pending',
      amountCents: i.amountCents,
      currency: 'KES',
      paidAt: null,
      channel: null,
      customerCode: null,
      email: i.email,
      authorization: null,
      metadata: i.metadata ?? {},
    });
    return {
      authorizationUrl: `https://checkout.paystack.test/${i.reference}`,
      reference: i.reference,
    };
  }

  /** Simulate the customer completing checkout (card saved for renewals). */
  complete(reference: string, at = new Date()): PaystackTransaction {
    const t = this.transactions.get(reference);
    if (!t) throw new Error(`no transaction ${reference}`);
    const done: PaystackTransaction = {
      ...t,
      status: 'success',
      paidAt: at,
      channel: 'card',
      customerCode: 'CUS_fake',
      authorization: {
        authorizationCode: `AUTH_${reference}`,
        reusable: true,
        brand: 'visa',
        last4: '4081',
      },
    };
    this.transactions.set(reference, done);
    return done;
  }

  async verify(reference: string) {
    const t = this.transactions.get(reference);
    if (!t) throw new PaystackError('request_failed', 'Transaction reference not found');
    return t;
  }

  async chargeAuthorization(i: {
    email: string;
    amountCents: bigint;
    reference: string;
    authorizationCode: string;
    metadata?: Record<string, unknown>;
  }) {
    const t: PaystackTransaction = {
      reference: i.reference,
      status: this.nextCharge,
      amountCents: i.amountCents,
      currency: 'KES',
      paidAt: this.nextCharge === 'success' ? new Date() : null,
      channel: 'card',
      customerCode: 'CUS_fake',
      email: i.email,
      authorization: {
        authorizationCode: i.authorizationCode,
        reusable: true,
        brand: 'visa',
        last4: '4081',
      },
      metadata: i.metadata ?? {},
    };
    this.transactions.set(i.reference, t);
    return t;
  }
}
