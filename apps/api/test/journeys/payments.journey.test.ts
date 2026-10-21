import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { testClock } from '../helpers';
import { startJourney, type Journey } from './harness';

/**
 * Journeys (B3): a landlord connects a Paybill; a tenant's C2B payment is matched and receipted
 * (and duplicate callbacks are no-ops); a 20-row statement auto-matches what it can and queues the
 * rest for manual allocation; an STK prompt succeeds and another fails. The ledger stays at zero.
 */
const clock = testClock('2026-10-21');
let j: Journey;
beforeAll(async () => {
  j = await startJourney({ clock });
});
afterAll(() => j.close());

it('Paybill + statement + STK reconciliation end to end', async () => {
  const s = await j.client.POST('/v1/identity/sign-up/email', {
    body: {
      name: 'Njeri',
      email: `njeri-${randomUUID().slice(0, 6)}@example.test`,
      password: 'a-strong-password',
    },
  });
  const me = j.as(s.data!.token);
  const org = await me.POST('/v1/orgs', {
    body: { name: 'Njeri Estates', kind: 'landlord', county: 'Nakuru' },
  });
  const prop = await me.POST('/v1/properties', { body: { name: 'Milimani', county: 'Nakuru' } });

  // Ten let units, N01–N10, tenants on 0711 000 001… with KES 20,000 rent.
  await me.POST('/v1/properties/{propertyId}/units/bulk', {
    params: { path: { propertyId: prop.data!.id } },
    body: { prefix: 'N', start: 1, count: 10, padding: 2, mode: 'long_term', rentCents: 2_000_000 },
  });
  const units = (
    await me.GET('/v1/units', { params: { query: { propertyId: prop.data!.id, limit: 25 } } })
  ).data!.items;
  const leaseByCode: Record<string, string> = {};
  for (const [i, u] of units.entries()) {
    const t = await me.POST('/v1/tenants', {
      body: { fullName: `Tenant ${u.code}`, phone: `07110000${String(i + 1).padStart(2, '0')}` },
    });
    const l = await me.POST('/v1/leases', {
      body: { unitId: u.id, tenantId: t.data!.id, startDate: '2026-10-01', rentCents: 2_000_000 },
    });
    leaseByCode[u.code] = l.data!.id;
  }

  const channel = await me.POST('/v1/payment-channels', {
    body: { kind: 'paybill', shortcode: '700100', displayName: 'Milimani Paybill' },
  });
  await me.PUT('/v1/payment-channels/{id}/credentials', {
    params: { path: { id: channel.data!.id } },
    body: { consumerKey: 'k', consumerSecret: 's', passkey: 'p' },
  });
  const token = new URL(channel.data!.callbackUrls!.confirmation).pathname.split('/')[4]!;

  // C2B: N01 pays with the right account number — three identical callbacks, one payment.
  const c2bBody = {
    TransID: 'RKJ0000001',
    TransTime: '20261021100000',
    TransAmount: '20000.00',
    BusinessShortCode: '700100',
    BillRefNumber: 'N01',
    MSISDN: '254711000001',
    FirstName: 'T',
    LastName: 'N01',
  };
  for (let i = 0; i < 3; i++) {
    const ack = await j.client.POST('/v1/payments/daraja/{channelToken}/c2b/confirmation', {
      params: { path: { channelToken: token } },
      body: c2bBody,
    });
    expect(ack.data).toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
  }
  const afterC2b = await me.GET('/v1/payments', { params: { query: { limit: 50 } } });
  expect(afterC2b.data!.items).toHaveLength(1);
  expect(afterC2b.data!.items[0]).toMatchObject({
    matchStatus: 'matched',
    unitCode: 'N01',
    receiptNumber: 'RCT-000001',
  });

  // Statement: 20 credit rows — 14 with a correct account, 4 with a known phone, 2 strangers.
  const rows = [
    '"Receipt No.","Completion Time","Details","Transaction Status","Paid In","Withdrawn","Balance","Other Party Info","A/C No."',
  ];
  for (let i = 0; i < 20; i++) {
    const n = (i % 10) + 1;
    const code = `N${String(n).padStart(2, '0')}`;
    const phone = i < 18 ? `2547110000${String(n).padStart(2, '0')}` : `25479900000${i}`;
    const account = i < 14 ? code : i < 18 ? 'rent' : 'XX';
    rows.push(
      `"RKST${String(i).padStart(6, '0')}","20-10-2026 08:${String(i).padStart(2, '0')}:00","Pay Bill","Completed","1,000.00","","0","${phone} - PAYER ${i}","${account}"`,
    );
  }
  const csv = rows.join('\n');
  const ticket = await me.POST('/v1/uploads', {
    body: { purpose: 'statement', contentType: 'text/csv', sizeBytes: csv.length },
  });
  expect(
    (
      await fetch(ticket.data!.uploadUrl, {
        method: 'PUT',
        headers: ticket.data!.headers,
        body: csv,
      })
    ).status,
  ).toBe(200);
  const imported = await me.POST('/v1/statement-imports', {
    body: { fileKey: ticket.data!.key, format: 'mpesa_business_csv', channelId: channel.data!.id },
  });
  expect(imported.data).toMatchObject({ rowsCredits: 20, rowsNew: 20, rowsMatched: 18 });

  const queue = await me.GET('/v1/payments', {
    params: { query: { status: 'unmatched', limit: 50 } },
  });
  expect(queue.data!.items).toHaveLength(2);
  for (const p of queue.data!.items) {
    const allocated = await me.POST('/v1/payments/{id}/allocate', {
      params: { path: { id: p.id } },
      body: { leaseId: leaseByCode.N05! },
    });
    expect(allocated.data!.matchStatus).toBe('matched');
  }
  expect(
    (await me.GET('/v1/payments', { params: { query: { status: 'unmatched' } } })).data!.items,
  ).toHaveLength(0);

  // STK: a prompt for N02 is confirmed by Safaricom; a prompt for N03 fails.
  const prompt = await me.POST('/v1/stk-requests', { body: { leaseId: leaseByCode.N02! } });
  expect(prompt.response.status).toBe(201);
  const checkout = (
    await j.api.deps.db.pools.owner.query(
      'SELECT checkout_request_id FROM stk_request WHERE id = $1',
      [prompt.data!.id],
    )
  ).rows[0].checkout_request_id as string;
  j.api.daraja.queryResults.set(checkout, { resultCode: '0', resultDesc: 'ok' });
  const amountKes = prompt.data!.amountCents / 100;
  await j.client.POST('/v1/payments/daraja/{channelToken}/stk', {
    params: { path: { channelToken: token } },
    body: {
      Body: {
        stkCallback: {
          MerchantRequestID: 'm',
          CheckoutRequestID: checkout,
          ResultCode: 0,
          ResultDesc: 'ok',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: amountKes },
              { Name: 'MpesaReceiptNumber', Value: 'STKJ000001' },
              { Name: 'TransactionDate', Value: 20261021120000 },
              { Name: 'PhoneNumber', Value: 254711000002 },
            ],
          },
        },
      },
    },
  });
  expect(
    (await me.GET('/v1/stk-requests/{id}', { params: { path: { id: prompt.data!.id } } })).data!
      .status,
  ).toBe('succeeded');

  const failing = await me.POST('/v1/stk-requests', {
    body: { leaseId: leaseByCode.N03!, amountCents: 50_000 },
  });
  const failCheckout = (
    await j.api.deps.db.pools.owner.query(
      'SELECT checkout_request_id FROM stk_request WHERE id = $1',
      [failing.data!.id],
    )
  ).rows[0].checkout_request_id as string;
  await j.client.POST('/v1/payments/daraja/{channelToken}/stk', {
    params: { path: { channelToken: token } },
    body: {
      Body: {
        stkCallback: {
          MerchantRequestID: 'm',
          CheckoutRequestID: failCheckout,
          ResultCode: 2001,
          ResultDesc: 'The initiator information is invalid.',
        },
      },
    },
  });
  expect(
    (await me.GET('/v1/stk-requests/{id}', { params: { path: { id: failing.data!.id } } })).data!
      .status,
  ).toBe('failed');

  const { rows: tb } = await j.api.deps.db.pools.owner.query(
    'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
    [org.data!.id],
  );
  expect(tb[0].t).toBe('0');
});
