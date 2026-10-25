import { describe, expect, it } from 'vitest';
import { parseTransaction, sign, verifySignature } from './index';

describe('paystack', () => {
  it('verifies webhook signatures (HMAC-SHA512 of the raw body)', () => {
    const body = '{"event":"charge.success","data":{"reference":"KJ-1"}}';
    const sig = sign('sk_test_secret', body);
    expect(verifySignature('sk_test_secret', body, sig)).toBe(true);
    expect(verifySignature('sk_test_secret', `${body} `, sig)).toBe(false);
    expect(verifySignature('other', body, sig)).toBe(false);
    expect(verifySignature('sk_test_secret', body, undefined)).toBe(false);
    expect(verifySignature('sk_test_secret', body, 'abc')).toBe(false);
  });

  it('parses a transaction', () => {
    const t = parseTransaction({
      reference: 'KJ-1',
      status: 'success',
      amount: 120000,
      currency: 'KES',
      paid_at: '2026-10-25T08:00:00.000Z',
      channel: 'card',
      customer: { customer_code: 'CUS_x', email: 'a@b.test' },
      authorization: { authorization_code: 'AUTH_x', reusable: true, brand: 'visa', last4: '4081' },
      metadata: { orgId: 'o' },
    });
    expect(t).toMatchObject({ amountCents: 120000n, status: 'success', customerCode: 'CUS_x' });
    expect(t.authorization).toEqual({
      authorizationCode: 'AUTH_x',
      reusable: true,
      brand: 'visa',
      last4: '4081',
    });
  });
});
