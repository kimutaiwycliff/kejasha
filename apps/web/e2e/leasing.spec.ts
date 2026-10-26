import { expect, test } from '@playwright/test';
import { apiPost, DEMO, randomTag } from './helpers';

test.use({ storageState: DEMO.landlord.file });

test('landlord leases a unit, bills, credits, ends the lease and settles the deposit', async ({
  page,
}) => {
  const tag = randomTag();
  const code = `L${tag}`;
  const tenant = `Achieng ${tag}`;

  // Setup through the API: a property with one long-term unit at Ksh 20,000 (deposit the same).
  await page.goto('/dashboard');
  const property = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Lease Court ${tag}`,
    county: 'Kisumu',
  });
  await apiPost(page, `/v1/properties/${property.id}/units`, {
    code,
    mode: 'long_term',
    rentCents: 2_000_000,
    depositCents: 2_000_000,
  });

  // Tenant.
  await page.goto('/tenants');
  await page.getByRole('button', { name: 'New tenant' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Full name').fill(tenant);
  await dlg.getByLabel('Phone', { exact: true }).fill(`07${tag}12`);
  await dlg.getByRole('button', { name: 'Add tenant' }).click();
  await expect(page.getByRole('heading', { name: tenant })).toBeVisible();

  // Lease from the tenant's page: the tenant is preselected; picking the unit copies its rent.
  await page.getByRole('link', { name: 'New lease' }).click();
  await expect(page.getByRole('heading', { name: 'New lease' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Tenant' })).toHaveValue(tenant);
  await page.getByRole('combobox', { name: 'Unit' }).fill(code);
  await page.getByRole('option', { name: new RegExp(code) }).click();
  await expect(page.getByLabel('Monthly rent')).toHaveValue('20000');
  await expect(page.getByLabel('Deposit')).toHaveValue('20000');
  await page.getByRole('button', { name: 'Add a charge' }).click();
  await page.getByLabel('Per month').fill('1500');
  await page.getByRole('button', { name: 'Create lease' }).click();

  await expect(page.getByRole('heading', { name: `${tenant} · ${code}` })).toBeVisible();
  await expect(page.getByText(/^Owes Ksh/)).toBeVisible();
  await page.getByRole('tab', { name: 'Charges' }).click();
  await expect(page.getByText('Ksh 1,500.00 / month')).toBeVisible();
  await page.getByRole('tab', { name: 'Invoices' }).click();
  // The deposit invoice (Ksh 20,000 due); the type column is hidden on phones.
  await expect(page.getByRole('cell', { name: 'Ksh 20,000.00' }).first()).toBeVisible();

  // A credit note shows on the statement.
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Credit note' }).click();
  await page.getByRole('dialog').getByLabel('Amount').fill('500');
  await page.getByRole('dialog').getByLabel('Reason').fill('Goodwill');
  await page.getByRole('dialog').getByRole('button', { name: 'Issue credit note' }).click();
  await expect(page.getByText(/Credit note .* issued/)).toBeVisible();
  await page.getByRole('tab', { name: 'Statement' }).click();
  await expect(page.getByRole('cell', { name: /Goodwill/ })).toBeVisible();

  // The tenant is in arrears. The report covers every lease in the org; under the parallel
  // journeys' lease creation it has taken up to 8 s locally, so allow longer than usual.
  await page.goto('/arrears');
  await expect(page.getByRole('cell', { name: new RegExp(tenant) })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('cell', { name: new RegExp(tenant) }).click();

  // End the lease today, then settle the deposit with a deduction.
  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'End lease' }).click();
  await page.getByRole('dialog').getByLabel('Reason').fill('Moved out');
  await page.getByRole('dialog').getByRole('button', { name: 'End lease' }).click();
  await expect(page.getByText('Ended', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'Actions' }).click();
  await page.getByRole('menuitem', { name: 'Settle deposit' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Add deduction' }).click();
  await page.getByRole('dialog').getByLabel('Deduction', { exact: true }).fill('Repainting');
  await page.getByRole('dialog').getByLabel('Amount').fill('2000');
  await page.getByRole('dialog').getByRole('button', { name: 'Settle' }).click();
  await expect(page.getByRole('heading', { name: 'Deposit settled' })).toBeVisible();
  await expect(page.getByText('Refund due to tenant')).toBeVisible();
});
