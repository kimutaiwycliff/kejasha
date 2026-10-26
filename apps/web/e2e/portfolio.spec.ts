import { expect, test } from '@playwright/test';
import { DEMO } from './helpers';

test.use({ storageState: DEMO.agency.file });

test('agency adds a landlord, a property, units, a meter and a meter round', async ({ page }) => {
  const tag = String(Math.floor(100000 + Math.random() * 900000));
  const landlord = `Otieno ${tag}`;
  const property = `Riverside ${tag}`;
  const prefix = `R${tag.slice(-4)}`;

  // Landlord with a 7.5% management fee.
  await page.goto('/landlords');
  await page.getByRole('button', { name: 'New landlord' }).click();
  const dlg = page.getByRole('dialog');
  await dlg.getByLabel('Name').fill(landlord);
  await dlg.getByRole('combobox', { name: 'Management fee' }).click();
  await page.getByRole('option', { name: 'Percent of rent collected' }).click();
  await dlg.getByLabel('Fee (% of rent collected)').fill('7.5');
  await dlg.getByRole('button', { name: 'Add landlord' }).click();
  await expect(page.getByRole('heading', { name: landlord })).toBeVisible();
  await expect(page.getByText('7.5%')).toBeVisible();

  // Property for that landlord (preselected from the landlord's page).
  await page.getByRole('button', { name: 'Add property' }).click();
  await page.getByRole('dialog').getByLabel('Name', { exact: true }).fill(property);
  await page.getByRole('dialog').getByRole('button', { name: 'Add property' }).click();
  await expect(page.getByRole('heading', { name: property })).toBeVisible();
  await expect(page.getByRole('link', { name: landlord })).toBeVisible();

  // Three numbered units at Ksh 18,000.
  await page.getByRole('button', { name: 'Add many' }).click();
  const bulk = page.getByRole('dialog');
  await bulk.getByLabel('Prefix').fill(prefix);
  await bulk.getByLabel('How many').fill('3');
  await expect(bulk.getByText(`Codes: ${prefix}01 … ${prefix}03`)).toBeVisible();
  await bulk.getByLabel('Monthly rent').fill('18,000');
  await bulk.getByRole('button', { name: 'Add 3 units' }).click();
  await expect(page.getByText('3 units added')).toBeVisible();
  await expect(page.getByRole('cell', { name: `${prefix}03` })).toBeVisible();

  // A water meter with an opening reading on the first unit.
  await page.getByRole('cell', { name: `${prefix}01` }).click();
  await expect(page.getByRole('heading', { name: `Unit ${prefix}01` })).toBeVisible();
  await expect(page.getByText('Ksh 18,000.00')).toBeVisible();
  await page.getByRole('button', { name: 'Add meter' }).click();
  await page.getByRole('dialog').getByLabel('Current reading').fill('100');
  // Dated a week ago: a meter takes one reading per day.
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  await page.getByRole('dialog').getByLabel('Read on').fill(weekAgo);
  await page.getByRole('dialog').getByRole('button', { name: 'Add meter' }).click();
  await expect(page.getByText(/^100 m³ on/)).toBeVisible();

  // The caretaker round: a lower reading is refused, a higher one is saved.
  await page.goto('/meter-readings');
  await page.getByRole('combobox', { name: 'Property' }).click();
  await page.getByRole('option', { name: property }).click();
  const input = page.getByRole('textbox', { name: `${prefix}01 Water reading` });
  await input.fill('90');
  await page.getByRole('button', { name: /Save 1 reading/ }).click();
  await expect(page.getByText('Lower than the last reading')).toBeVisible();
  await input.fill('112.5');
  await page.getByRole('button', { name: /Save 1 reading/ }).click();
  await expect(page.getByText('Saved', { exact: true })).toBeVisible();
});

test('a landlord org has no Landlords section and owns its properties directly', async ({
  browser,
}) => {
  const ctx = await browser.newContext({ storageState: DEMO.landlord.file });
  const page = await ctx.newPage();
  await page.goto('/properties');
  await expect(page.getByRole('heading', { name: 'Properties' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Landlords' })).toHaveCount(0);
  await page.getByRole('button', { name: 'New property' }).click();
  await expect(page.getByRole('dialog').getByRole('combobox', { name: 'Landlord' })).toHaveCount(0);
  await ctx.close();
});
