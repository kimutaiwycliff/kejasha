import { expect, test } from '@playwright/test';
import { apiPost, DEMO, randomTag } from './helpers';

test.use({ storageState: DEMO.landlord.file });

const nairobi = (d = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(d);
/** First day of last month and a day inside it (YYYY-MM-DD), and last month as YYYY-MM. */
function lastMonth() {
  const [y, m] = nairobi().split('-').map(Number) as [number, number];
  const period = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
  return { period, first: `${period}-01`, paidOn: `${period}-05` };
}
const plusDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

test('maintenance ticket to close, MRI filing, licence, owner statement and exports', async ({
  page,
}) => {
  const tag = randomTag();
  const code = `M${tag}`;
  const tenant = `Kamau ${tag}`;
  const lm = lastMonth();

  // Setup: a lease running since last month and Ksh 30,000 rent received on the 5th of last month.
  await page.goto('/dashboard');
  const property = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Ops Court ${tag}`,
    county: 'Nakuru',
  });
  const unit = await apiPost<{ id: string }>(page, `/v1/properties/${property.id}/units`, {
    code,
    mode: 'long_term',
    rentCents: 3_000_000,
  });
  const t = await apiPost<{ id: string }>(page, '/v1/tenants', { fullName: tenant });
  const lease = await apiPost<{ id: string }>(page, '/v1/leases', {
    unitId: unit.id,
    tenantId: t.id,
    startDate: lm.first,
    rentCents: 3_000_000,
  });
  await apiPost(page, '/v1/payments', {
    method: 'cash',
    amountCents: 3_000_000,
    paidOn: lm.paidOn,
    leaseId: lease.id,
  });

  // Maintenance: report, start, resolve with a cost, close.
  await page.goto('/maintenance');
  await page.getByRole('button', { name: 'Report a problem' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByRole('combobox', { name: 'Unit' }).fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
  await dlg.getByLabel('What is wrong').fill(`Leaking tap ${tag}`);
  await dlg.getByRole('button', { name: 'Open ticket' }).click();
  await expect(page.getByRole('heading', { name: `Leaking tap ${tag}` })).toBeVisible();
  await page.getByRole('button', { name: 'Start work' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Start work' }).click();
  await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Mark resolved' }).click();
  await page.getByRole('dialog').getByLabel('Final cost (optional)').fill('2500');
  await page.getByRole('dialog').getByRole('button', { name: 'Mark resolved' }).click();
  await expect(page.getByText('Ksh 2,500.00')).toBeVisible();
  await page.getByRole('button', { name: 'Close ticket' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close ticket' }).click();
  await expect(page.getByText('Closed', { exact: true }).first()).toBeVisible();

  // Compliance: last month's MRI includes the tenant's rent; record the filing.
  await page.goto('/compliance');
  await page.getByLabel('Month').fill(lm.period);
  // A loaded landlord row (the header has no cells; loading placeholders have no filing status).
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name: /filed/i }) })
    .first()
    .click();
  await expect(page.getByRole('cell', { name: new RegExp(tenant) })).toBeVisible();
  if (await page.getByRole('button', { name: 'Record filing' }).isVisible()) {
    await page.getByRole('button', { name: 'Record filing' }).click();
    await page.getByRole('dialog').getByLabel('KRA payment reference (PRN)').fill(`PRN${tag}`);
    await page.getByRole('dialog').getByRole('button', { name: 'Record filing' }).click();
  }
  await expect(page.getByText(/^Filed /).first()).toBeVisible();

  // The tenant has no KRA PIN on record; a licence expiring in 10 days is flagged.
  await page.goto('/compliance');
  await page.getByRole('tab', { name: 'Tenant PINs' }).click();
  await expect(
    page.getByRole('row', { name: new RegExp(tenant) }).getByText('Missing'),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Licences' }).click();
  await page.getByRole('button', { name: 'Add licence' }).click();
  const lic = page.getByRole('dialog');
  await lic.getByRole('combobox', { name: 'Type' }).click();
  await page.getByRole('option', { name: 'County business permit' }).click();
  await lic.getByRole('tab', { name: 'Whole property' }).click();
  await lic.getByRole('combobox', { name: 'Property' }).click();
  await page.getByRole('option', { name: `Ops Court ${tag}` }).click();
  await lic.getByLabel('Licence number').fill(`BP-${tag}`);
  await lic.getByLabel('Expires on').fill(plusDays(nairobi(), 10));
  await lic.getByRole('button', { name: 'Add licence' }).click();
  await expect(
    page.getByRole('row', { name: new RegExp(`BP-${tag}`) }).getByText(/Expiring soon/),
  ).toBeVisible();

  // Reports: the owner statement for last month, its PDF, and the rent roll CSV.
  await page.goto('/reports');
  await page.getByLabel('Month').fill(lm.period);
  await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('cell', { name: new RegExp(code) })).toBeVisible();
  const pdf = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF' }).click();
  expect((await pdf).suggestedFilename()).toMatch(/^statement-.*\.pdf$/);
  await page.goto('/reports');
  await page.getByRole('tab', { name: 'Rent roll' }).click();
  await expect(page.getByRole('cell', { name: new RegExp(code) })).toBeVisible();
  const csv = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV' }).click();
  expect((await csv).suggestedFilename()).toMatch(/^rent-roll-.*\.csv$/);
});
