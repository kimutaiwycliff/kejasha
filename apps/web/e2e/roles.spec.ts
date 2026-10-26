import { expect, test, type Browser } from '@playwright/test';
import { apiGet, apiPost, apiPut, DEMO, navLabels, randomTag, signInByPhone } from './helpers';

test.use({ storageState: DEMO.agency.file });

type Role = 'manager' | 'agent' | 'caretaker' | 'viewer';

/** What each role must and must not find in the sidebar (agency org). */
const NAV: Record<Role, { has: string[]; lacks: string[] }> = {
  manager: {
    has: ['Landlords', 'Leases', 'Payments', 'Reports', 'Compliance', 'Team', 'Billing'],
    lacks: [],
  },
  agent: {
    has: ['Landlords', 'Tenants', 'Leases', 'Bookings', 'Payments', 'Cash'],
    lacks: ['Reports', 'Compliance', 'Team', 'Billing', 'M-Pesa setup', 'Expenses'],
  },
  caretaker: {
    has: ['Properties', 'Units', 'Maintenance', 'Meter readings', 'Cash'],
    lacks: ['Landlords', 'Tenants', 'Leases', 'Payments', 'Reports', 'Team', 'Billing'],
  },
  viewer: {
    has: ['Dashboard', 'Reports'],
    lacks: ['Properties', 'Leases', 'Payments', 'Team', 'Maintenance'],
  },
};

/** A member invited by phone signs in with an SMS code and joins the agency. */
async function joinAs(browser: Browser, invite: (phone: string) => Promise<void>, tag: string) {
  const local = `07${tag}`;
  const e164 = `+2547${tag}`;
  await invite(local);
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await signInByPhone(page, local, e164);
  await expect(page).toHaveURL(/\/onboarding/);
  await page.getByRole('button', { name: 'Join' }).first().click();
  await expect(page).toHaveURL(/\/dashboard/);
  return { ctx, page, e164 };
}

test('each role sees its own sections; a caretaker sees only their property', async ({
  page,
  browser,
}) => {
  const tag = randomTag();
  await page.goto('/dashboard');
  const mine = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Assigned Court ${tag}`,
    county: 'Nairobi',
  });
  const other = await apiPost<{ id: string }>(page, '/v1/properties', {
    name: `Other Court ${tag}`,
    county: 'Nairobi',
  });
  const invite = (role: Role) => async (phone: string) => {
    await apiPost(page, '/v1/invitations', { phone, role });
  };

  for (const [i, role] of (['manager', 'agent', 'caretaker', 'viewer'] as Role[]).entries()) {
    const m = await joinAs(browser, invite(role), `${tag.slice(0, 5)}${i}${tag.slice(5)}0`);
    const labels = await navLabels(m.page);
    for (const has of NAV[role].has) expect(labels, `${role} sees ${has}`).toContain(has);
    for (const lacks of NAV[role].lacks)
      expect(labels, `${role} must not see ${lacks}`).not.toContain(lacks);

    if (role === 'manager') {
      // Agency twin: an invited manager adds a client landlord.
      await m.page.goto('/landlords');
      await m.page.getByRole('button', { name: 'New landlord' }).click();
      await m.page.getByRole('dialog').getByLabel('Name').fill(`Client ${tag}`);
      await m.page.getByRole('dialog').getByRole('button', { name: 'Add landlord' }).click();
      await expect(m.page.getByRole('heading', { name: `Client ${tag}` })).toBeVisible();
    }

    if (role === 'caretaker') {
      // Assign the caretaker to one property; they see it and cannot open the other.
      const members = await apiGet<{ items: { userId: string; phone: string | null }[] }>(
        page,
        '/v1/members',
      );
      const userId = members.items.find((x) => x.phone === m.e164)!.userId;
      await apiPut(page, `/v1/properties/${mine.id}/staff`, { userIds: [userId] });
      await m.page.goto('/properties');
      await expect(
        m.page.getByRole('cell', { name: new RegExp(`Assigned Court ${tag}`) }),
      ).toBeVisible();
      await expect(
        m.page.getByRole('cell', { name: new RegExp(`Other Court ${tag}`) }),
      ).toHaveCount(0);
      await m.page.goto(`/properties/${other.id}`);
      await expect(m.page.getByText(/not found/i)).toBeVisible();
    }
    await m.ctx.close();
  }
});
