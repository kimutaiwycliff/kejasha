import { expect, test, type Page } from '@playwright/test';
import { apiPost, DEMO, randomTag } from './helpers';

/**
 * Every section edits (PATCH), replaces (PUT) and deletes (DELETE) through the browser — the
 * paths CORS once blocked while journeys only created and read.
 */
const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const plusDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};
const dialog = (page: Page) => page.getByRole('dialog');

test.describe('as a landlord', () => {
  test.use({ storageState: DEMO.landlord.file });

  test('portfolio and leasing: edit property, staff, unit, tenant, lease terms and charges', async ({
    page,
  }) => {
    const tag = randomTag();
    await page.goto('/dashboard');
    const prop = await apiPost<{ id: string }>(page, '/v1/properties', {
      name: `Edit Court ${tag}`,
      county: 'Nairobi',
    });
    const unit = await apiPost<{ id: string }>(page, `/v1/properties/${prop.id}/units`, {
      code: `E${tag}`,
      mode: 'long_term',
      rentCents: 1_000_000,
    });
    const tenant = await apiPost<{ id: string }>(page, '/v1/tenants', {
      fullName: `Wanjiru ${tag}`,
    });
    const lease = await apiPost<{ id: string }>(page, '/v1/leases', {
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: today(),
      rentCents: 1_000_000,
    });

    // Property: rename (PATCH) and save staff (PUT).
    await page.goto(`/properties/${prop.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await dialog(page).getByLabel('Name', { exact: true }).fill(`Edited Court ${tag}`);
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('heading', { name: `Edited Court ${tag}` })).toBeVisible();
    await page.getByRole('button', { name: 'Assign' }).click();
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Staff updated')).toBeVisible();

    // Unit: new asking rent (PATCH).
    await page.goto(`/units/${unit.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await dialog(page).getByLabel('Monthly rent').fill('11000');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Ksh 11,000.00').first()).toBeVisible();

    // Tenant: add a KRA PIN (PATCH).
    await page.goto(`/tenants/${tenant.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await dialog(page).getByLabel('KRA PIN').fill('A123456789B');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('A123456789B')).toBeVisible();

    // Lease: due day (PATCH), then a charge added and its amount changed (PATCH).
    await page.goto(`/leases/${lease.id}`);
    await page.getByRole('button', { name: 'Actions' }).click();
    await page.getByRole('menuitem', { name: 'Edit terms' }).click();
    await dialog(page).getByLabel('Rent due on day').fill('5');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Day 5 of each month')).toBeVisible();
    await page.getByRole('tab', { name: 'Charges' }).click();
    await page.getByRole('button', { name: 'Add charge' }).click();
    await dialog(page).getByLabel('Per month').fill('500');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Ksh 500.00 / month')).toBeVisible();
    await page
      .getByRole('button', { name: /^Edit / })
      .first()
      .click();
    await dialog(page).getByLabel('Per month').fill('750');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Ksh 750.00 / month')).toBeVisible();
  });

  test('short stays: rates (PUT), seasons, booking dates, blocks and expenses (DELETE)', async ({
    page,
  }) => {
    const tag = randomTag();
    const code = `X${tag}`;
    await page.goto('/dashboard');
    const prop = await apiPost<{ id: string }>(page, '/v1/properties', {
      name: `Edit Villas ${tag}`,
      county: 'Kilifi',
    });
    const unit = await apiPost<{ id: string }>(page, `/v1/properties/${prop.id}/units`, {
      code,
      mode: 'short_stay',
      baseNightlyCents: 400_000,
    });
    const booking = await apiPost<{ id: string }>(page, '/v1/bookings', {
      unitId: unit.id,
      checkIn: plusDays(today(), 20),
      checkOut: plusDays(today(), 22),
      source: 'direct',
      guest: { fullName: `Guest ${tag}` },
    });

    // Rates (PUT) and a season added then removed (DELETE).
    await page.goto(`/units/${unit.id}`);
    await page.getByRole('button', { name: 'Edit' }).nth(1).click();
    await dialog(page).getByLabel('Cleaning fee').fill('800');
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Ksh 800.00')).toBeVisible();
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await dialog(page).getByLabel('Name').fill(`Holiday ${tag}`);
    await dialog(page).getByLabel('Ends (first night after)').fill(plusDays(today(), 10));
    await dialog(page).getByLabel('Nightly rate').fill('6000');
    await dialog(page).getByRole('button', { name: 'Add season' }).click();
    await expect(page.getByText(`Holiday ${tag}`)).toBeVisible();
    await page.getByRole('button', { name: `Remove season Holiday ${tag}` }).click();
    await dialog(page).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByText(`Holiday ${tag}`)).toHaveCount(0);

    // Booking: move the stay by a day (PATCH).
    await page.goto(`/bookings/${booking.id}`);
    await page.getByRole('button', { name: 'More' }).click();
    await page.getByRole('menuitem', { name: 'Edit' }).click();
    await dialog(page).getByLabel('Check-out').fill(plusDays(today(), 23));
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('3 nights')).toBeVisible();

    // Calendar block created, then re-opened (DELETE).
    await page.goto('/calendar');
    await page.getByRole('button', { name: 'Block dates' }).click();
    await dialog(page).getByRole('combobox', { name: 'Unit' }).fill(code);
    await page.getByRole('option', { name: new RegExp(code) }).click();
    await dialog(page).getByLabel('From').fill(plusDays(today(), 2));
    await dialog(page).getByLabel('Until (free again on)').fill(plusDays(today(), 4));
    await dialog(page).getByRole('button', { name: 'Block' }).click();
    await expect(page.getByText('Dates blocked')).toBeVisible();
    await page.getByRole('button', { name: 'Owner use' }).first().click();
    await dialog(page).getByRole('button', { name: 'Open dates' }).click();
    await expect(page.getByText('Dates opened')).toBeVisible();

    // Expense added, then deleted (DELETE).
    await page.goto('/expenses');
    await page.getByRole('button', { name: 'Add expense' }).click();
    await dialog(page).getByRole('combobox', { name: 'Unit' }).fill(code);
    await page.getByRole('option', { name: new RegExp(code) }).click();
    await dialog(page).getByLabel('Amount').fill('1234');
    await dialog(page).getByLabel('Description').fill(`Soap ${tag}`);
    await dialog(page).getByRole('button', { name: 'Add', exact: true }).click();
    const row = page.getByRole('row', { name: new RegExp(`Soap ${tag}`) });
    await expect(row).toBeVisible();
    await row.getByRole('button', { name: `Remove expense Soap ${tag}` }).click();
    await dialog(page).getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`Soap ${tag}`) })).toHaveCount(0);
  });

  test('operations: edit a ticket, renew and archive a licence', async ({ page }) => {
    const tag = randomTag();
    await page.goto('/dashboard');
    const prop = await apiPost<{ id: string }>(page, '/v1/properties', {
      name: `Ops Edit ${tag}`,
      county: 'Nairobi',
    });
    const ticket = await apiPost<{ id: string }>(page, '/v1/tickets', {
      propertyId: prop.id,
      title: `Gate stuck ${tag}`,
      category: 'security',
    });
    await apiPost(page, '/v1/licences', {
      propertyId: prop.id,
      kind: 'county_business_permit',
      number: `LC-${tag}`,
      expiresOn: plusDays(today(), 5),
    });

    // Ticket: assign an outside fundi and raise the priority (PATCH).
    await page.goto(`/maintenance/${ticket.id}`);
    await page.getByRole('button', { name: 'Edit' }).click();
    await dialog(page).getByLabel('Or an outside fundi').fill(`Fundi ${tag}`);
    await dialog(page).getByRole('combobox', { name: 'Priority' }).click();
    await page.getByRole('option', { name: 'Urgent' }).click();
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Fundi ${tag}`)).toBeVisible();
    await expect(page.getByText('Urgent priority')).toBeVisible();

    // Licence: renewed for a year (PATCH), then archived (DELETE).
    await page.goto('/compliance');
    await page.getByRole('tab', { name: 'Licences' }).click();
    const row = page.getByRole('row', { name: new RegExp(`LC-${tag}`) });
    await expect(row.getByText(/Expiring soon/)).toBeVisible();
    await row.getByRole('button', { name: 'Renew or edit' }).click();
    await dialog(page).getByLabel('Expires on').fill(plusDays(today(), 365));
    await dialog(page).getByRole('button', { name: 'Save' }).click();
    await expect(row.getByText('Valid')).toBeVisible();
    await row.getByRole('button', { name: 'Archive licence' }).click();
    await dialog(page).getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('row', { name: new RegExp(`LC-${tag}`) })).toHaveCount(0);
  });
});
