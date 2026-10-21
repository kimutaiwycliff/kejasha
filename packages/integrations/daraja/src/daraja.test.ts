import { describe, expect, it, vi } from 'vitest';
import {
  createDarajaClient,
  darajaTimestamp,
  parseC2B,
  parseDarajaTime,
  parseStkCallback,
  stkPassword,
} from './index';

// Payload shapes as documented by Safaricom (C2B v2 confirmation, STK callback).
const c2b = {
  TransactionType: 'Pay Bill',
  TransID: 'RKTQDM7W6S',
  TransTime: '20261021101530',
  TransAmount: '30000.00',
  BusinessShortCode: '600981',
  BillRefNumber: ' a1 ',
  InvoiceNumber: '',
  OrgAccountBalance: '49197.00',
  ThirdPartyTransID: '',
  MSISDN: '254712000111',
  FirstName: 'JANE',
  MiddleName: '',
  LastName: 'WANJIRU',
};

describe('Daraja payloads', () => {
  it('parses a C2B confirmation into cents and a Nairobi instant', () => {
    expect(parseC2B(c2b)).toEqual({
      transId: 'RKTQDM7W6S',
      amountCents: 3_000_000n,
      paidAt: new Date('2026-10-21T07:15:30.000Z'),
      shortcode: '600981',
      billRef: 'a1',
      msisdn: '254712000111',
      payerName: 'JANE WANJIRU',
    });
    expect(() => parseC2B({ ...c2b, TransID: '' })).toThrow();
    expect(() => parseC2B({ ...c2b, TransAmount: '1.234' })).toThrow();
  });

  it('parses successful and cancelled STK callbacks', () => {
    const ok = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: '29115-34620561-1',
          CheckoutRequestID: 'ws_CO_191220191020363925',
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: 1500 },
              { Name: 'MpesaReceiptNumber', Value: 'NLJ7RT61SV' },
              { Name: 'TransactionDate', Value: 20261021102115 },
              { Name: 'PhoneNumber', Value: 254712000111 },
            ],
          },
        },
      },
    });
    expect(ok).toMatchObject({
      resultCode: '0',
      amountCents: 150_000n,
      receipt: 'NLJ7RT61SV',
      phone: '254712000111',
    });
    const cancelled = parseStkCallback({
      Body: {
        stkCallback: {
          MerchantRequestID: 'x',
          CheckoutRequestID: 'y',
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    });
    expect(cancelled).toMatchObject({ resultCode: '1032', amountCents: null, receipt: null });
    expect(() => parseStkCallback({})).toThrow();
  });

  it('formats timestamps and passwords like Daraja expects', () => {
    expect(darajaTimestamp(new Date('2026-10-21T21:05:09Z'))).toBe('20261022000509');
    expect(parseDarajaTime('20261022000509').toISOString()).toBe('2026-10-21T21:05:09.000Z');
    expect(Buffer.from(stkPassword('174379', 'pk', '20261021101530'), 'base64').toString()).toBe(
      '174379pk20261021101530',
    );
  });
});

describe('Daraja client', () => {
  it('caches the OAuth token and sends STK Push with the documented fields', async () => {
    const calls: { url: string; body?: unknown }[] = [];
    const fetch = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes('/oauth/'))
        return new Response(JSON.stringify({ access_token: 'tok', expires_in: '3599' }));
      return new Response(
        JSON.stringify({
          MerchantRequestID: 'm',
          CheckoutRequestID: 'c',
          ResponseCode: '0',
          CustomerMessage: 'ok',
        }),
      );
    });
    const client = createDarajaClient({
      fetch: fetch as unknown as typeof globalThis.fetch,
      now: () => new Date('2026-10-21T07:00:00Z'),
    });
    const creds = { consumerKey: 'k', consumerSecret: 's', passkey: 'p' };
    const input = {
      shortcode: '174379',
      kind: 'paybill' as const,
      amountKes: 30000,
      phone: '254712000111',
      accountRef: 'A1',
      description: 'Rent A1',
      callbackUrl: 'https://api.test/cb',
    };
    await client.stkPush('sandbox', creds, input);
    await client.stkPush('sandbox', creds, input);
    expect(calls.filter((c) => c.url.includes('/oauth/'))).toHaveLength(1);
    expect(calls[1]!.url).toBe('https://sandbox.safaricom.co.ke/mpesa/stkpush/v1/processrequest');
    expect(calls[1]!.body).toMatchObject({
      BusinessShortCode: '174379',
      Timestamp: '20261021100000',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 30000,
      AccountReference: 'A1',
    });
  });
});
