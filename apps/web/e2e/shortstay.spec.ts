import { expect, test } from '@playwright/test';
import { apiPost, DEMO, randomTag } from './helpers';

test.use({ storageState: DEMO.landlord.file });

const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi' }).format(new Date());
const plusDays = (iso: string, d: number) => {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + d);
  return t.toISOString().slice(0, 10);
};

test('book a short stay from the calendar, refuse a double booking, check in and out', async ({
  page,
}) => {
  const tag = randomTag();
  const code = `S${tag}`;
  const guest = `Njeri ${tag}`;

  // Setup through the API: a short-stay unit at Ksh 5,000 a night, Ksh 1,000 cleaning, 2-night minimum.
  await page.goto('/dashboard');
  const property = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Beach Villas ${tag}`,
    county: 'Kwale',
  });
  const unit = await apiPost<{ id: string }>(page, `/v1/properties/${property.id}/units`, {
    code,
    mode: 'short_stay',
    baseNightlyCents: 500_000,
  });
  const res = await page.request.put(
    `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/v1/units/${unit.id}/rate-plan`,
    {
      data: { baseNightlyCents: 500_000, cleaningFeeCents: 100_000, minStayNights: 2 },
      headers: { 'Idempotency-Key': crypto.randomUUID(), Origin: 'http://localhost:3000' },
    },
  );
  expect(res.ok()).toBe(true);

  // Tap today on the unit's row in the calendar.
  await page.goto(`/calendar?`);
  await page.getByRole('button', { name: `Book ${code} from ${today()}` }).click();
  await expect(page.getByRole('heading', { name: 'New booking' })).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Unit' })).toHaveValue(new RegExp(code));

  // One night is below the minimum; three nights are priced live.
  await page.getByLabel('Check-out').fill(plusDays(today(), 1));
  await expect(page.getByText('Minimum stay is 2 nights.')).toBeVisible();
  await page.getByLabel('Check-out').fill(plusDays(today(), 3));
  await expect(page.getByText('3 × nights at Ksh 5,000.00')).toBeVisible();
  await expect(page.getByText('Ksh 16,000.00')).toBeVisible();
  await page.getByLabel('Guest name').fill(guest);
  await page.getByRole('button', { name: 'Save booking' }).click();
  await expect(page.getByRole('heading', { name: `${guest} · ${code}` })).toBeVisible();

  // The same dates are now unavailable.
  const bookingUrl = page.url();
  await page.goto(`/bookings/new?unitId=${unit.id}&checkIn=${today()}`);
  await expect(page.getByText('These dates are already booked or blocked.')).toBeVisible();

  // Check in, then out.
  await page.goto(bookingUrl);
  await page.getByRole('button', { name: 'Check in' }).click();
  await expect(page.getByText('Checked in', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Check out' }).click();
  await expect(page.getByText('Checked out', { exact: true }).first()).toBeVisible();

  // The stay counts in this month's profit.
  await page.goto('/short-stay-profit');
  await expect(page.getByRole('cell', { name: new RegExp(code) })).toBeVisible();
});
