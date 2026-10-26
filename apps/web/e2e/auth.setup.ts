import { expect, test as setup } from '@playwright/test';
import { DEMO } from './helpers';

/** Signs in each seeded demo user once and saves the session (see `DEMO`). */
for (const [who, u] of Object.entries(DEMO)) {
  setup(`sign in as the demo ${who}`, async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByRole('textbox', { name: 'Email' }).fill(u.email);
    await page.getByRole('textbox', { name: 'Password', exact: true }).fill('demo-password-123');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    // The shell picks the active org after sign-in; it is stored in the server-side session.
    await expect(page.getByRole('button', { name: 'Switch organization' })).toBeVisible();
    await page.context().storageState({ path: u.file });
  });
}
