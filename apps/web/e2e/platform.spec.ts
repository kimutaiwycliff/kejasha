import { expect, test } from '@playwright/test';
import { apiPost, DEMO, latestOtp, newAccount, randomTag, signUp, sql } from './helpers';

test.describe('team and organization settings', () => {
  test.use({ storageState: DEMO.agency.file });

  test('invite a caretaker by phone, cancel it, and set the brand colour', async ({ page }) => {
    const tag = randomTag();
    await page.goto('/settings/team');
    await expect(page.getByRole('heading', { name: 'Team' })).toBeVisible();
    await page.getByRole('button', { name: 'Invite' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByRole('tab', { name: 'By phone (SMS)' }).click();
    await dlg.getByLabel('Phone').fill(`07${tag}56`);
    await dlg.getByRole('combobox', { name: 'Role' }).click();
    await page.getByRole('option', { name: /^Caretaker/ }).click();
    await dlg.getByRole('button', { name: 'Send invitation' }).click();
    await expect(page.getByText('Waiting to join')).toBeVisible();
    const row = page.getByText(`+2547${tag}56`).locator('xpath=ancestor::div[2]');
    await row.getByRole('button', { name: 'Cancel' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel invitation' }).click();
    // The toast still names the number; the invitation itself is gone from the page.
    await expect(page.getByRole('main').getByText(`+2547${tag}56`)).toHaveCount(0);

    await page.goto('/settings/organization');
    await page.getByLabel('Accent colour').fill('#1D4ED8');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Accent colour')).toHaveValue('#1D4ED8');
  });
});

test.describe('tenant portal', () => {
  test.use({ storageState: DEMO.landlord.file });

  test('a tenant signs in by phone, sees their balance and statement, and reports a problem', async ({
    page,
    browser,
  }) => {
    const tag = randomTag();
    const local = `07${tag}78`;
    const e164 = `+2547${tag}78`;
    // The landlord records the tenant (with this phone) on a lease.
    await page.goto('/dashboard');
    const property = await apiPost<{ id: string }>(page, '/v1/properties', {
      name: `Portal Court ${tag}`,
      county: 'Nairobi',
    });
    const unit = await apiPost<{ id: string }>(page, `/v1/properties/${property.id}/units`, {
      code: `T${tag}`,
      mode: 'long_term',
      rentCents: 1_200_000,
    });
    const tenant = await apiPost<{ id: string }>(page, '/v1/tenants', {
      fullName: `Otieno ${tag}`,
      phone: local,
    });
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(
      new Date(),
    );
    await apiPost(page, '/v1/leases', {
      unitId: unit.id,
      tenantId: tenant.id,
      startDate: today,
      rentCents: 1_200_000,
    });

    // The tenant, in their own browser, signs in with an SMS code.
    const ctx = await browser.newContext();
    const t = await ctx.newPage();
    await t.goto('/sign-in');
    await t.getByRole('tab', { name: 'Phone' }).click();
    await t.getByLabel('Phone number').fill(local);
    await t.getByRole('button', { name: /Send code/ }).click();
    await expect(t.getByRole('textbox', { name: 'One-time code' })).toBeVisible();
    await t.getByRole('textbox', { name: 'One-time code' }).fill(latestOtp(e164));
    await expect(t).toHaveURL(/\/portal$/);
    await expect(t.getByRole('heading', { name: 'My home' })).toBeVisible();
    await expect(t.getByText(`T${tag} · Portal Court ${tag}`)).toBeVisible();
    await expect(t.getByText('Ksh 12,000.00').first()).toBeVisible();

    // No M-Pesa channel on this landlord: the portal says so instead of failing silently.
    await t.getByRole('button', { name: 'Pay with M-Pesa' }).click();
    await t.getByRole('dialog').getByRole('button', { name: 'Send M-Pesa prompt' }).click();
    await expect(t.getByText(/has not connected M-Pesa yet/)).toBeVisible();
    await t.keyboard.press('Escape');

    await t.getByRole('button', { name: 'Report a problem' }).click();
    await t.getByRole('dialog').getByLabel('What is wrong').fill(`Broken window ${tag}`);
    await t.getByRole('dialog').getByRole('button', { name: 'Send' }).click();
    await expect(t.getByText('Sent to your landlord')).toBeVisible();
    await expect(t.getByText(`Broken window ${tag}`)).toBeVisible();

    await t.getByRole('link', { name: 'Statement' }).click();
    await expect(t.getByRole('heading', { name: 'Statement' })).toBeVisible();
    await expect(t.getByText('Balance now')).toBeVisible();
    await ctx.close();
  });
});

test('the operator console is for platform staff only', async ({ browser }) => {
  // A member who is not an operator is turned away.
  const denied = await browser.newContext({ storageState: DEMO.landlord.file });
  const d = await denied.newPage();
  await d.goto('/operator');
  await expect(d.getByRole('heading', { name: 'Kejasha staff only' })).toBeVisible();
  await denied.close();

  // A new account granted operator access (as `make operator-grant` does) sees every org.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const acct = newAccount('operator');
  await signUp(page, acct);
  sql(
    `INSERT INTO platform_operator (user_id, note) SELECT id, 'e2e' FROM "user" WHERE email = '${acct.email}'`,
  );
  await page.goto('/operator');
  await expect(page.getByRole('heading', { name: 'Organizations' })).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search by name' }).fill('Wanjiku Homes');
  await page
    .getByRole('cell', { name: /Wanjiku Homes/ })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Wanjiku Homes' })).toBeVisible();
  await expect(page.getByText('Audit log')).toBeVisible();
  await page.getByRole('link', { name: 'Plans' }).click();
  await expect(page.getByRole('heading', { name: 'Plans' })).toBeVisible();
  await expect(page.getByText('Per occupied unit').first()).toBeVisible();
  await ctx.close();
});
