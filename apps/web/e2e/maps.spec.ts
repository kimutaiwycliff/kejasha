import { expect, test } from '@playwright/test';
import { apiPost, DEMO, randomTag } from './helpers';

test.use({
  storageState: DEMO.landlord.file,
  // Maps need WebGL; headless CI has no GPU. Software rendering is slow, so only this file uses it.
  launchOptions: {
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  },
});

test('a property is pinned on the map and its units show on the board', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'Pin dropping is covered on desktop.');
  const tag = randomTag();
  await page.goto('/dashboard');
  const property = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Map Court ${tag}`,
    county: 'Nairobi',
  });
  await apiPost(page, `/v1/properties/${property.id}/units`, {
    code: `MP${tag}`,
    mode: 'long_term',
    rentCents: 2_500_000,
  });

  await page.goto(`/properties/${property.id}`);
  // The board shows the unit as vacant, with its asking rent.
  await expect(
    page.getByRole('link', { name: new RegExp(`MP${tag}.*Vacant.*Asking Ksh 25,000.00`) }),
  ).toBeVisible();

  // Drop a pin by tapping the map, then save it.
  await expect(page.getByText('Not on the map yet.')).toBeVisible();
  await page.getByRole('button', { name: 'Set location' }).click();
  const dialog = page.getByRole('dialog');
  const map = dialog.getByRole('region', { name: `Choose the location of Map Court ${tag}` });
  await expect(map.locator('canvas')).toBeVisible({ timeout: 20_000 });
  await map.click({ position: { x: 200, y: 150 } });
  await expect(dialog.getByText(/^Pin at -?\d/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Save location' }).click();
  await expect(page.getByText('Location saved')).toBeVisible();
  await expect(page.getByRole('region', { name: `Map showing Map Court ${tag}` })).toBeVisible();

  // On the portfolio map the property has a pin that opens it.
  await page.goto('/properties');
  await page.getByRole('tab', { name: 'Map' }).click();
  const pin = page.getByRole('button', { name: new RegExp(`^Map Court ${tag}`) });
  await expect(pin).toBeVisible({ timeout: 20_000 });
  // Hover or keyboard focus shows a popover with the property's name (focus is used here because
  // other tests' pins can sit on the same spot).
  await pin.focus();
  const tip = pin.locator('xpath=following-sibling::div');
  await expect(tip).toContainText(`Map Court ${tag}`);
  await expect(tip).toHaveCSS('opacity', '1');
  await pin.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/properties/${property.id}`));
});
