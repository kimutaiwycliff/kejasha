import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { client, ownerWithOrg } from './actors';
import { buildTestApi, testClock, type TestApi } from './helpers';

const clock = testClock('2026-10-21');
let api: TestApi;
beforeAll(async () => {
  api = await buildTestApi({}, { clock });
});
afterAll(() => api.close());

type C = ReturnType<typeof client>;

/** Org with a property, two let units (A1, A2) with tenants, and a Paybill with credentials. */
async function setup() {
  clock.set('2026-10-21');
  const o = await ownerWithOrg(api);
  const c = client(api, o.token);
  const prop = (await c.post('/v1/properties', { name: 'Riverside', county: 'Nairobi' })).json();
  const leases: Record<string, { id: string }> = {};
  for (const [code, name, phone] of [
    ['A1', 'Jane Wanjiru', '0712000111'],
    ['A2', 'Brian Otieno', '0722000222'],
  ] as const) {
    const unit = (
      await c.post(`/v1/properties/${prop.id}/units`, {
        code,
        mode: 'long_term',
        rentCents: 3_000_000,
      })
    ).json();
    const tenant = (await c.post('/v1/tenants', { fullName: name, phone })).json();
    leases[code] = (
      await c.post('/v1/leases', {
        unitId: unit.id,
        tenantId: tenant.id,
        startDate: '2026-10-01',
        rentCents: 3_000_000,
      })
    ).json();
  }
  const channel = (
    await c.post('/v1/payment-channels', {
      kind: 'paybill',
      shortcode: '600981',
      displayName: 'Riverside Paybill',
    })
  ).json();
  await c.put(`/v1/payment-channels/${channel.id}/credentials`, {
    consumerKey: 'ck-live',
    consumerSecret: 'cs-very-secret',
    passkey: 'pk-secret',
  });
  const token = new URL(channel.callbackUrls.confirmation).pathname.split('/')[4]!;
  return { o, c, prop, leases, channel, token };
}

const c2b = (over: Record<string, string> = {}) => ({
  TransactionType: 'Pay Bill',
  TransID: `RK${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
  TransTime: '20261021101530',
  TransAmount: '30000.00',
  BusinessShortCode: '600981',
  BillRefNumber: 'A1',
  MSISDN: '254700999999',
  FirstName: 'JANE',
  MiddleName: '',
  LastName: 'WANJIRU',
  ...over,
});

const confirm = (token: string, body: object) =>
  api.app.inject({
    method: 'POST',
    url: `/v1/payments/daraja/${token}/c2b/confirmation`,
    payload: body,
  });

const balance = async (c: C, leaseId: string) =>
  (await c.get(`/v1/leases/${leaseId}`)).json().balanceCents as number;
const trialBalance = async (orgId: string) =>
  (
    await api.deps.db.pools.owner.query(
      'SELECT coalesce(sum(amount_cents),0)::text AS t FROM ledger_posting WHERE org_id = $1',
      [orgId],
    )
  ).rows[0].t;

describe('channels and credentials', () => {
  it('stores Daraja credentials encrypted and never returns them', async () => {
    const { o, c, channel } = await setup();
    const listed = (await c.get('/v1/payment-channels')).json().items[0];
    expect(listed).toMatchObject({ hasCredentials: true, kind: 'paybill', shortcode: '600981' });
    expect(JSON.stringify(listed)).not.toContain('cs-very-secret');
    const { rows } = await api.deps.db.pools.owner.query(
      'SELECT credentials_ciphertext FROM payment_channel WHERE org_id = $1',
      [o.org.id],
    );
    expect(Buffer.from(rows[0].credentials_ciphertext).toString('utf8')).not.toContain(
      'cs-very-secret',
    );

    expect(
      (
        await c.post('/v1/payment-channels', { kind: 'paybill', shortcode: '12', displayName: 'x' })
      ).json().code,
    ).toBe('invalid_shortcode');
    expect(
      (
        await c.post('/v1/payment-channels', {
          kind: 'paybill',
          shortcode: '600981',
          displayName: 'x',
        })
      ).json().code,
    ).toBe('channel_exists');
    const phone = (
      await c.post('/v1/payment-channels', {
        kind: 'phone',
        shortcode: '0712 345 678',
        displayName: 'Mama mboga line',
      })
    ).json();
    expect(phone).toMatchObject({ shortcode: '+254712345678', callbackUrls: null });

    const registered = (await c.post(`/v1/payment-channels/${channel.id}/register-c2b`)).json();
    expect(registered.c2bRegisteredAt).not.toBeNull();
    expect(api.daraja.registered.at(-1)).toMatchObject({
      shortcode: '600981',
      confirmationUrl: channel.callbackUrls.confirmation,
    });
    const goLive = (await c.get(`/v1/payment-channels/${channel.id}/go-live`)).json();
    expect(goLive.items.find((i: { key: string }) => i.key === 'c2b_registered').done).toBe(true);
    expect(goLive.ready).toBe(false); // still sandbox, no payment yet
  });
});

describe('C2B', () => {
  it('matches by account number, issues a receipt, and ignores duplicate callbacks', async () => {
    const { o, c, leases, token } = await setup();
    const before = await balance(c, leases.A1!.id);
    const body = c2b({ BillRefNumber: ' a1 ', TransAmount: '30000.00' });
    const acks = await Promise.all([
      confirm(token, body),
      confirm(token, body),
      confirm(token, body),
    ]);
    expect(acks.map((a) => a.json())).toEqual(
      Array(3).fill({ ResultCode: 0, ResultDesc: 'Accepted' }),
    );

    const { items } = (await c.get('/v1/payments')).json();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      providerRef: body.TransID,
      matchStatus: 'matched',
      matchMethod: 'auto_account',
      unitCode: 'A1',
      receiptNumber: 'RCT-000001',
      tenantName: 'Jane Wanjiru',
    });
    expect(await balance(c, leases.A1!.id)).toBe(before - 3_000_000);

    const { rows } = await api.deps.db.pools.owner.query(
      "SELECT payload FROM outbox WHERE org_id = $1 AND dedupe_key LIKE 'receipt:%'",
      [o.org.id],
    );
    expect(rows).toEqual([
      {
        payload: expect.objectContaining({
          to: '+254712000111',
          message: expect.stringContaining('RCT-000001'),
        }),
      },
    ]);
    const callbacks = await api.deps.db.pools.owner.query(
      'SELECT outcome FROM payment_callback WHERE org_id = $1 ORDER BY received_at',
      [o.org.id],
    );
    expect(callbacks.rows.map((r) => r.outcome).sort()).toEqual([
      'duplicate',
      'duplicate',
      'recorded:matched',
    ]);

    const pdf = await api.app.inject({
      method: 'GET',
      url: `/v1/payments/${items[0].id}/receipt`,
      headers: { authorization: `Bearer ${o.token}` },
    });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it("matches by the tenant's phone when the account number is wrong", async () => {
    const { c, token } = await setup();
    await confirm(token, c2b({ BillRefNumber: 'RENT OCT', MSISDN: '254722000222' }));
    expect((await c.get('/v1/payments')).json().items[0]).toMatchObject({
      matchMethod: 'auto_phone',
      unitCode: 'A2',
    });
  });

  it('queues unknown payments with suggestions; allocate, unallocate and ignore', async () => {
    const { o, c, leases, token } = await setup();
    await confirm(
      token,
      c2b({
        BillRefNumber: 'house 5',
        MSISDN: '254799000000',
        FirstName: 'BRIAN',
        LastName: 'OTIENO',
      }),
    );
    const queued = (await c.get('/v1/payments?status=unmatched')).json().items[0];
    expect(queued).toMatchObject({ matchStatus: 'unmatched', receiptNumber: null });

    const suggestions = (await c.get(`/v1/payments/${queued.id}/suggestions`)).json().items;
    expect(suggestions[0]).toMatchObject({
      unitCode: 'A2',
      reasons: expect.arrayContaining(['name', 'exact_invoice_amount']),
    });

    const before = await balance(c, leases.A2!.id);
    const allocated = (
      await c.post(`/v1/payments/${queued.id}/allocate`, { leaseId: leases.A2!.id })
    ).json();
    expect(allocated).toMatchObject({
      matchStatus: 'matched',
      matchMethod: 'manual',
      unitCode: 'A2',
    });
    expect(await balance(c, leases.A2!.id)).toBe(before - 3_000_000);
    expect(
      (await c.post(`/v1/payments/${queued.id}/allocate`, { leaseId: leases.A1!.id })).json().code,
    ).toBe('payment_not_unmatched');

    const undone = (
      await c.post(`/v1/payments/${queued.id}/unallocate`, { reason: 'Wrong tenant' })
    ).json();
    expect(undone).toMatchObject({ matchStatus: 'unmatched', leaseId: null });
    expect(await balance(c, leases.A2!.id)).toBe(before);
    const ignored = (
      await c.post(`/v1/payments/${queued.id}/ignore`, { reason: 'Owner deposit, not rent' })
    ).json();
    expect(ignored).toMatchObject({
      matchStatus: 'ignored',
      ignoreReason: 'Owner deposit, not rent',
    });
    expect(await trialBalance(o.org.id)).toBe('0');
  });

  it('keeps agency channels inside their client landlord, and guards the callback URL', async () => {
    const { c, token } = await setup();
    const other = (await c.post('/v1/client-landlords', { name: 'Other Owner' })).json();
    const scoped = (
      await c.post('/v1/payment-channels', {
        kind: 'till',
        shortcode: '5123456',
        displayName: 'Other owner till',
        clientLandlordId: other.id,
      })
    ).json();
    const scopedToken = new URL(scoped.callbackUrls.confirmation).pathname.split('/')[4]!;
    await confirm(scopedToken, c2b({ BillRefNumber: 'A1', MSISDN: '254700000001' })); // A1 belongs to the self landlord
    expect((await c.get('/v1/payments?status=unmatched')).json().items).toHaveLength(1);

    expect((await confirm('x'.repeat(43), c2b())).statusCode).toBe(404);
    const strict = await buildTestApi({ DARAJA_CALLBACK_IPS: '196.201.214.200' });
    try {
      const res = await strict.app.inject({
        method: 'POST',
        url: `/v1/payments/daraja/${token}/c2b/confirmation`,
        payload: c2b(),
        headers: { 'x-forwarded-for': '10.1.1.1' },
      });
      expect(res.statusCode).toBe(403);
    } finally {
      await strict.close();
    }
  });
});

describe('STK Push', () => {
  it('books money only after Safaricom confirms; handles cancel and unconfirmed callbacks', async () => {
    const { o, c, leases, token } = await setup();
    const req = await c.post('/v1/stk-requests', { leaseId: leases.A1!.id });
    expect(req.statusCode, req.body).toBe(201);
    expect(req.json()).toMatchObject({
      status: 'pending',
      amountCents: 3_000_000,
      msisdn: '+254712000111',
      accountRef: 'A1',
    });
    const push = api.daraja.pushes.at(-1)!;
    expect(push).toMatchObject({ amountKes: 30_000, phone: '254712000111', accountRef: 'A1' });
    const checkout = (
      await api.deps.db.pools.owner.query(
        'SELECT checkout_request_id FROM stk_request WHERE id = $1',
        [req.json().id],
      )
    ).rows[0].checkout_request_id;

    const success = (amount: number, receipt: string, id = checkout) => ({
      Body: {
        stkCallback: {
          MerchantRequestID: 'MR',
          CheckoutRequestID: id,
          ResultCode: 0,
          ResultDesc: 'The service request is processed successfully.',
          CallbackMetadata: {
            Item: [
              { Name: 'Amount', Value: amount },
              { Name: 'MpesaReceiptNumber', Value: receipt },
              { Name: 'TransactionDate', Value: 20261021103000 },
              { Name: 'PhoneNumber', Value: 254712000111 },
            ],
          },
        },
      },
    });
    const stkCb = (body: object) =>
      api.app.inject({ method: 'POST', url: `/v1/payments/daraja/${token}/stk`, payload: body });

    // Callback arrives but Safaricom's query does not confirm yet → nothing booked.
    await stkCb(success(30_000, 'STKREC0001'));
    expect((await c.get(`/v1/stk-requests/${req.json().id}`)).json().status).toBe('pending');
    expect((await c.get('/v1/payments')).json().items).toHaveLength(0);

    // Confirmed → payment recorded and allocated to the requested lease.
    api.daraja.queryResults.set(checkout, { resultCode: '0', resultDesc: 'ok' });
    await stkCb(success(30_000, 'STKREC0001'));
    expect((await c.get(`/v1/stk-requests/${req.json().id}`)).json()).toMatchObject({
      status: 'succeeded',
      paymentId: expect.any(String),
    });
    expect((await c.get('/v1/payments')).json().items[0]).toMatchObject({
      source: 'stk',
      providerRef: 'STKREC0001',
      matchStatus: 'matched',
      unitCode: 'A1',
    });

    // A second prompt the tenant cancels.
    const second = (
      await c.post('/v1/stk-requests', { leaseId: leases.A2!.id, amountCents: 100_000 })
    ).json();
    const secondCheckout = (
      await api.deps.db.pools.owner.query(
        'SELECT checkout_request_id FROM stk_request WHERE id = $1',
        [second.id],
      )
    ).rows[0].checkout_request_id;
    await stkCb({
      Body: {
        stkCallback: {
          MerchantRequestID: 'MR',
          CheckoutRequestID: secondCheckout,
          ResultCode: 1032,
          ResultDesc: 'Request cancelled by user',
        },
      },
    });
    expect((await c.get(`/v1/stk-requests/${second.id}`)).json().status).toBe('cancelled');

    expect(
      (await c.post('/v1/stk-requests', { leaseId: leases.A2!.id, amountCents: 150 })).json().code,
    ).toBe('whole_shillings_only');
    expect(await trialBalance(o.org.id)).toBe('0');
  });
});

describe('without a Paybill', () => {
  it('imports a statement CSV through an upload, dedupes on re-import, and parses shared SMS', async () => {
    const { c, leases } = await setup();
    const csv = [
      '"Receipt No.","Completion Time","Details","Transaction Status","Paid In","Withdrawn","Balance","Other Party Info","A/C No."',
      '"RKS0000001","21-10-2026 09:00:00","Pay Bill","Completed","30,000.00","","1","254712000111 - JANE WANJIRU","A1"',
      '"RKS0000002","21-10-2026 09:05:00","Pay Bill","Completed","12,000.00","","2","254766000000 - STRANGER","X9"',
      '"RKS0000003","21-10-2026 09:10:00","Payment to bank","Completed","","-5,000.00","3","Equity",""',
    ].join('\n');
    const ticket = (
      await c.post('/v1/uploads', {
        purpose: 'statement',
        contentType: 'text/csv',
        sizeBytes: csv.length,
      })
    ).json();
    expect(
      (await fetch(ticket.uploadUrl, { method: 'PUT', headers: ticket.headers, body: csv })).status,
    ).toBe(200);
    expect(
      (
        await c.post('/v1/uploads', {
          purpose: 'statement',
          contentType: 'image/png',
          sizeBytes: 10,
        })
      ).json().code,
    ).toBe('invalid_content_type');

    const first = (
      await c.post('/v1/statement-imports', { fileKey: ticket.key, format: 'mpesa_business_csv' })
    ).json();
    expect(first).toMatchObject({
      status: 'parsed',
      rowsTotal: 3,
      rowsCredits: 2,
      rowsNew: 2,
      rowsDuplicate: 0,
      rowsMatched: 1,
      periodFrom: '2026-10-21',
    });
    const again = (
      await c.post('/v1/statement-imports', { fileKey: ticket.key, format: 'mpesa_business_csv' })
    ).json();
    expect(again).toMatchObject({ rowsNew: 0, rowsDuplicate: 2 });
    expect(
      (
        await c.post('/v1/statement-imports', {
          fileKey: 'org/other/statement/x.csv',
          format: 'mpesa_business_csv',
        })
      ).json().code,
    ).toBe('invalid_file_key');

    const sms = await c.post('/v1/sms-payments', {
      text: 'RKS0000009 Confirmed.You have received Ksh5,000.00 from BRIAN OTIENO 0722000222 on 21/10/26 at 2:15 PM  New M-PESA balance is Ksh9,000.00.',
    });
    expect(sms.statusCode, sms.body).toBe(201);
    expect(sms.json()).toMatchObject({
      source: 'sms',
      amountCents: 500_000,
      matchMethod: 'auto_phone',
      unitCode: 'A2',
    });
    expect(
      (
        await c.post('/v1/sms-payments', {
          text: 'RKS0000010 Confirmed. Ksh500.00 sent to JOHN 0711000000 on 21/10/26 at 1:00 PM.',
        })
      ).json().code,
    ).toBe('sms_not_incoming');

    const manual = (
      await c.post('/v1/payments', {
        method: 'cash',
        amountCents: 200_000,
        paidOn: '2026-10-21',
        leaseId: leases.A1!.id,
        notes: 'Paid at the office',
      })
    ).json();
    expect(manual).toMatchObject({
      source: 'manual',
      method: 'cash',
      matchStatus: 'matched',
      receiptNumber: expect.stringMatching(/^RCT-/),
    });
  });
});
