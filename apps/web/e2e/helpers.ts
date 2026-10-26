import { expect, type Page } from '@playwright/test';

/** A fresh, unique account per test so journeys can run in parallel and repeatedly. */
export function newAccount(tag: string) {
  const id = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return {
    name: `Amina ${tag}`,
    email: `e2e-${tag}-${id}@example.test`,
    password: 'correct-horse-battery',
  };
}

export async function signUp(page: Page, acct: ReturnType<typeof newAccount>) {
  await page.goto('/sign-up');
  await page.getByLabel('Your name').fill(acct.name);
  await page.getByRole('textbox', { name: 'Email' }).fill(acct.email);
  await page.getByLabel('Password (10+ characters)').fill(acct.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/onboarding/);
}

/** Opens the sidebar on small screens, where it is a sheet behind the toggle. */
export async function openNav(page: Page) {
  const toggle = page.getByRole('button', { name: 'Toggle navigation' });
  if (await page.getByRole('button', { name: 'Account menu' }).isHidden()) await toggle.click();
}
