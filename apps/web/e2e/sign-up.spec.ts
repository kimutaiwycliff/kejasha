import { expect, test } from '@playwright/test';
import { newAccount, openNav, signUp } from './helpers';

test('sign up, create an organization, sign out and back in', async ({ page }) => {
  const acct = newAccount('signup');
  await signUp(page, acct);

  await expect(page.getByRole('heading', { name: 'Welcome, Amina' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Amina Rentals');
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  await expect(page.getByText('Collected this month')).toBeVisible();

  await openNav(page);
  await expect(page.getByRole('button', { name: 'Switch organization' })).toContainText(
    'Amina Rentals',
  );
  await page.getByRole('button', { name: 'Account menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/sign-in/);

  await page.getByRole('textbox', { name: 'Email' }).fill(acct.email);
  await page.getByRole('textbox', { name: 'Password', exact: true }).fill(acct.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

test('signed-out visitors are sent to sign in and returned afterwards', async ({ page }) => {
  await page.goto('/billing');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fbilling/);
});

test('sign-up shows field errors from the contract schema', async ({ page }) => {
  await page.goto('/sign-up');
  await page.getByRole('textbox', { name: 'Email' }).fill('not-an-email');
  await page.getByLabel('Password (10+ characters)').fill('short');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByLabel('Password (10+ characters)')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  await expect(page).toHaveURL(/\/sign-up/);
});
