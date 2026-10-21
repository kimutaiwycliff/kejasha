/**
 * Safaricom Daraja (ADR-008): C2B URL registration, STK Push, STK query, and parsers for the
 * callbacks Safaricom sends. Credentials are the landlord's own (decrypted per call by the caller).
 */
export type DarajaEnv = 'sandbox' | 'production';

export interface DarajaCredentials {
  consumerKey: string;
  consumerSecret: string;
  /** Lipa na M-Pesa Online passkey (needed for STK Push). */
  passkey?: string | undefined;
}

export interface StkPushInput {
  shortcode: string;
  /** Paybill → CustomerPayBillOnline; Till → CustomerBuyGoodsOnline. */
  kind: 'paybill' | 'till';
  amountKes: number;
  /** 2547XXXXXXXX (no +). */
  phone: string;
  accountRef: string;
  description: string;
  callbackUrl: string;
}

export interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

export interface StkQueryResult {
  /** "0" success; anything else failed/cancelled; null while still processing. */
  resultCode: string | null;
  resultDesc: string;
}

export interface DarajaClient {
  registerC2B(
    env: DarajaEnv,
    creds: DarajaCredentials,
    input: { shortcode: string; confirmationUrl: string; validationUrl: string },
  ): Promise<void>;
  stkPush(env: DarajaEnv, creds: DarajaCredentials, input: StkPushInput): Promise<StkPushResult>;
  stkQuery(
    env: DarajaEnv,
    creds: DarajaCredentials,
    input: { shortcode: string; checkoutRequestId: string },
  ): Promise<StkQueryResult>;
}

export class DarajaError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'DarajaError';
  }
}

const BASE: Record<DarajaEnv, string> = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

/** Daraja timestamp: yyyyMMddHHmmss in Africa/Nairobi. */
export function darajaTimestamp(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}${get('second')}`;
}

export function stkPassword(shortcode: string, passkey: string, timestamp: string): string {
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

export function createDarajaClient(
  opts: { fetch?: typeof fetch; now?: () => Date } = {},
): DarajaClient {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? (() => new Date());
  const tokens = new Map<string, { token: string; expiresAt: number }>();

  async function token(env: DarajaEnv, creds: DarajaCredentials): Promise<string> {
    const cacheKey = `${env}:${creds.consumerKey}`;
    const hit = tokens.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.token;
    const res = await doFetch(`${BASE[env]}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${creds.consumerKey}:${creds.consumerSecret}`).toString('base64')}`,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new DarajaError(`Daraja OAuth failed (${res.status})`, res.status);
    const body = (await res.json()) as { access_token: string; expires_in: string | number };
    tokens.set(cacheKey, {
      token: body.access_token,
      expiresAt: Date.now() + (Number(body.expires_in) - 60) * 1000,
    });
    return body.access_token;
  }

  async function call<T>(
    env: DarajaEnv,
    creds: DarajaCredentials,
    path: string,
    payload: unknown,
  ): Promise<T> {
    const res = await doFetch(`${BASE[env]}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await token(env, creds)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as T & { errorMessage?: string };
    if (!res.ok)
      throw new DarajaError(
        `Daraja ${path} failed (${res.status}): ${body.errorMessage ?? ''}`.trim(),
        res.status,
        body,
      );
    return body;
  }

  return {
    async registerC2B(env, creds, input) {
      await call(env, creds, '/mpesa/c2b/v2/registerurl', {
        ShortCode: input.shortcode,
        ResponseType: 'Completed', // if our validation endpoint is unreachable, accept the payment
        ConfirmationURL: input.confirmationUrl,
        ValidationURL: input.validationUrl,
      });
    },

    async stkPush(env, creds, input) {
      if (!creds.passkey) throw new DarajaError('STK Push needs the Lipa na M-Pesa passkey');
      const ts = darajaTimestamp(now());
      const body = await call<{
        MerchantRequestID: string;
        CheckoutRequestID: string;
        ResponseCode: string;
        CustomerMessage: string;
      }>(env, creds, '/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: input.shortcode,
        Password: stkPassword(input.shortcode, creds.passkey, ts),
        Timestamp: ts,
        TransactionType: input.kind === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: input.amountKes,
        PartyA: input.phone,
        PartyB: input.shortcode,
        PhoneNumber: input.phone,
        CallBackURL: input.callbackUrl,
        AccountReference: input.accountRef.slice(0, 12),
        TransactionDesc: input.description.slice(0, 13),
      });
      if (body.ResponseCode !== '0')
        throw new DarajaError(`STK Push rejected: ${body.CustomerMessage}`, 200, body);
      return {
        merchantRequestId: body.MerchantRequestID,
        checkoutRequestId: body.CheckoutRequestID,
        customerMessage: body.CustomerMessage,
      };
    },

    async stkQuery(env, creds, input) {
      if (!creds.passkey) throw new DarajaError('STK query needs the Lipa na M-Pesa passkey');
      const ts = darajaTimestamp(now());
      try {
        const body = await call<{ ResultCode?: string; ResultDesc?: string }>(
          env,
          creds,
          '/mpesa/stkpushquery/v1/query',
          {
            BusinessShortCode: input.shortcode,
            Password: stkPassword(input.shortcode, creds.passkey, ts),
            Timestamp: ts,
            CheckoutRequestID: input.checkoutRequestId,
          },
        );
        return {
          resultCode: body.ResultCode === undefined ? null : String(body.ResultCode),
          resultDesc: body.ResultDesc ?? '',
        };
      } catch (err) {
        // Daraja answers 500 "The transaction is being processed" while the customer is still deciding.
        if (err instanceof DarajaError && /being processed/i.test(JSON.stringify(err.body ?? ''))) {
          return { resultCode: null, resultDesc: 'The transaction is being processed' };
        }
        throw err;
      }
    },
  };
}

// ── Callback payloads ──────────────────────────────────────────────────────────────────────

export interface C2BPayment {
  transId: string;
  amountCents: bigint;
  paidAt: Date;
  shortcode: string;
  billRef: string;
  /** As sent; newer Daraja versions may mask or hash it. */
  msisdn: string;
  payerName: string;
}

/** "20261021101530" (Nairobi local) → Date. */
export function parseDarajaTime(value: string | number): Date {
  const s = String(value);
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  if (!m) throw new DarajaError(`Unexpected Daraja timestamp: ${s}`);
  return new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+03:00`);
}

function toCents(amount: string | number): bigint {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(amount).trim());
  if (!m) throw new DarajaError(`Unexpected amount: ${amount}`);
  return BigInt(m[1]!) * 100n + BigInt((m[2] ?? '').padEnd(2, '0') || '0');
}

export function parseC2B(body: Record<string, unknown>): C2BPayment {
  const str = (k: string) =>
    body[k] === undefined || body[k] === null ? '' : String(body[k]).trim();
  if (!str('TransID')) throw new DarajaError('C2B payload has no TransID');
  return {
    transId: str('TransID'),
    amountCents: toCents(str('TransAmount')),
    paidAt: parseDarajaTime(str('TransTime')),
    shortcode: str('BusinessShortCode'),
    billRef: str('BillRefNumber'),
    msisdn: str('MSISDN'),
    payerName: [str('FirstName'), str('MiddleName'), str('LastName')].filter(Boolean).join(' '),
  };
}

export interface StkCallback {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: string;
  resultDesc: string;
  amountCents: bigint | null;
  receipt: string | null;
  paidAt: Date | null;
  phone: string | null;
}

export function parseStkCallback(body: unknown): StkCallback {
  const cb = (body as { Body?: { stkCallback?: Record<string, unknown> } })?.Body?.stkCallback;
  if (!cb?.CheckoutRequestID) throw new DarajaError('STK callback has no CheckoutRequestID');
  const items = (
    (cb.CallbackMetadata as { Item?: { Name: string; Value?: unknown }[] } | undefined)?.Item ?? []
  ).reduce<Record<string, unknown>>((acc, i) => ({ ...acc, [i.Name]: i.Value }), {});
  return {
    merchantRequestId: String(cb.MerchantRequestID ?? ''),
    checkoutRequestId: String(cb.CheckoutRequestID),
    resultCode: String(cb.ResultCode ?? ''),
    resultDesc: String(cb.ResultDesc ?? ''),
    amountCents: items.Amount === undefined ? null : toCents(items.Amount as string | number),
    receipt: items.MpesaReceiptNumber === undefined ? null : String(items.MpesaReceiptNumber),
    paidAt:
      items.TransactionDate === undefined
        ? null
        : parseDarajaTime(items.TransactionDate as string | number),
    phone: items.PhoneNumber === undefined ? null : String(items.PhoneNumber),
  };
}

// ── Test double ────────────────────────────────────────────────────────────────────────────

/** In-memory Daraja for tests and local development without sandbox credentials. */
export class FakeDarajaClient implements DarajaClient {
  readonly registered: { shortcode: string; confirmationUrl: string; validationUrl: string }[] = [];
  readonly pushes: StkPushInput[] = [];
  /** checkoutRequestId → result the next query returns (default: still processing). */
  readonly queryResults = new Map<string, StkQueryResult>();
  failNextPush: string | null = null;
  private seq = 0;

  async registerC2B(
    _env: DarajaEnv,
    _creds: DarajaCredentials,
    input: { shortcode: string; confirmationUrl: string; validationUrl: string },
  ) {
    this.registered.push(input);
  }

  async stkPush(
    _env: DarajaEnv,
    creds: DarajaCredentials,
    input: StkPushInput,
  ): Promise<StkPushResult> {
    if (!creds.passkey) throw new DarajaError('STK Push needs the Lipa na M-Pesa passkey');
    if (this.failNextPush) {
      const msg = this.failNextPush;
      this.failNextPush = null;
      throw new DarajaError(msg, 400);
    }
    this.pushes.push(input);
    this.seq += 1;
    return {
      merchantRequestId: `MR-${this.seq}`,
      checkoutRequestId: `ws_CO_FAKE_${Date.now()}_${this.seq}`,
      customerMessage: 'Success. Request accepted for processing',
    };
  }

  async stkQuery(
    _env: DarajaEnv,
    _creds: DarajaCredentials,
    input: { shortcode: string; checkoutRequestId: string },
  ): Promise<StkQueryResult> {
    return (
      this.queryResults.get(input.checkoutRequestId) ?? {
        resultCode: null,
        resultDesc: 'The transaction is being processed',
      }
    );
  }
}
