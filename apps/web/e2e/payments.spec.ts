import { expect, test, type Page } from '@playwright/test';
import { apiGet, apiPost, DEMO, randomTag } from './helpers';

test.use({ storageState: DEMO.landlord.file });

const code = () =>
  Array.from(
    { length: 10 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 34)],
  ).join('');
const today = () => {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' })
    .format(new Date())
    .split('-');
  return `${d}/${m}/${y!.slice(2)}`;
};
const sms = (amount: string, name: string, phone: string) =>
  `${code()} Confirmed.You have received Ksh${amount} from ${name} ${phone} on ${today()} at 10:15 AM  New M-PESA balance is Ksh99,000.00.`;

/** A let unit with a tenant whose phone is known. */
async function leaseSetup(page: Page) {
  const tag = randomTag();
  await page.goto('/dashboard');
  const property = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Pay Court ${tag}`,
    county: 'Nairobi',
  });
  const unit = await apiPost<{ id: string }>(page, `/v1/properties/${property.id}/units`, {
    code: `P${tag}`,
    mode: 'long_term',
    rentCents: 1_500_000,
  });
  const phone = `07${tag}34`;
  const tenant = await apiPost<{ id: string }>(page, '/v1/tenants', {
    fullName: `Wafula ${tag}`,
    phone,
  });
  const start = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
  const lease = await apiPost<{ id: string }>(page, '/v1/leases', {
    unitId: unit.id,
    tenantId: tenant.id,
    startDate: start,
    rentCents: 1_500_000,
  });
  return { tag, phone, leaseId: lease.id, unitCode: `P${tag}`, tenantName: `Wafula ${tag}` };
}

test('SMS payments match by phone or by hand; cash is confirmed into the ledger', async ({
  page,
}) => {
  const s = await leaseSetup(page);

  // An SMS from the tenant's own phone matches itself.
  await page.goto('/payments');
  await page.getByRole('button', { name: 'Add payments' }).click();
  await page.getByRole('menuitem', { name: 'Paste an M-Pesa SMS' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('M-Pesa message')
    .fill(sms('5,000.00', 'WAFULA', s.phone));
  await page.getByRole('dialog').getByRole('button', { name: 'Add payment' }).click();
  await expect(page.getByText(`Ksh 5,000.00 matched to ${s.tenantName}`)).toBeVisible();

  // One from an unknown number waits in the queue; match it by hand and open its receipt.
  await page.getByRole('button', { name: 'Add payments' }).click();
  await page.getByRole('menuitem', { name: 'Paste an M-Pesa SMS' }).click();
  await page
    .getByRole('dialog')
    .getByLabel('M-Pesa message')
    .fill(sms('2,500.00', `BROTHER ${s.tag}`, '0799000111'));
  await page.getByRole('dialog').getByRole('button', { name: 'Add payment' }).click();
  await expect(page.getByText('Ksh 2,500.00 added to the unmatched queue')).toBeVisible();
  await page.getByRole('cell', { name: new RegExp(`BROTHER ${s.tag}`) }).click();
  await page.getByRole('combobox', { name: 'Someone else' }).fill(s.unitCode);
  await page.getByRole('option', { name: new RegExp(s.unitCode) }).click();
  await page.getByRole('button', { name: 'Apply to this lease' }).click();
  await expect(page.getByText(`Applied to ${s.tenantName}`)).toBeVisible();
  await expect(page.getByText('Matched', { exact: true })).toBeVisible();
  // The tab opens blank (so pop-up blockers allow it) and then loads the fetched PDF, which
  // headless Chromium saves as a download instead of displaying.
  const popup = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Receipt' }).click();
  const tab = await popup;
  const pdf = await tab.waitForEvent('download');
  expect(pdf.url()).toMatch(/^blob:/);
  await tab.close();

  // Cash logged by unit, then confirmed by the owner.
  await page.goto('/cash');
  await page.getByRole('button', { name: 'Log cash' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: 'Unit' }).fill(s.unitCode);
  await page.getByRole('option', { name: new RegExp(s.unitCode) }).click();
  await dlg.getByLabel('Amount').fill('1000');
  await dlg.getByRole('button', { name: 'Log cash' }).click();
  await expect(page.getByText('Cash logged; waiting for the owner to confirm')).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(s.unitCode) });
  await row.getByRole('button', { name: 'Confirm' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByText('Confirmed and receipted')).toBeVisible();

  // All three payments sit on the tenant's lease (checked through the API: the "Applied to"
  // column is hidden on phones).
  const paid = await apiGet<{ items: { amountCents: number; matchStatus: string }[] }>(
    page,
    `/v1/payments?leaseId=${s.leaseId}`,
  );
  expect(paid.items.map((p) => p.matchStatus)).toEqual(['matched', 'matched', 'matched']);
  expect(paid.items.reduce((t, p) => t + p.amountCents, 0)).toBe(850_000);
});

test('a Paybill is added with its go-live checklist', async ({ page }) => {
  const tag = randomTag();
  await page.goto('/payment-channels');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Paybill number').fill(`5${tag.slice(0, 5)}`);
  await dlg.getByLabel('Name').fill(`Paybill ${tag}`);
  await dlg.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Channel added')).toBeVisible();
  const card = page.locator('[data-slot="card"]', { hasText: `Paybill ${tag}` });
  await expect(card.getByText('Credentials: not set')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Register URLs' })).toBeDisabled();
  await card.getByRole('button', { name: 'Go-live checklist' }).click();
  await expect(page.getByRole('heading', { name: `Go live with Paybill ${tag}` })).toBeVisible();
  await expect(page.getByText('Callback URLs')).toBeVisible();
});
