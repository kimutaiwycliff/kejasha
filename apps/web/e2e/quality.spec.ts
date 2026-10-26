import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { DEMO } from './helpers';

/**
 * Key pages meet WCAG 2.1 AA (no serious or critical axe findings), never scroll sideways on a
 * phone, and stay within a JavaScript and LCP budget (desktop project only).
 */
test.use({ storageState: DEMO.landlord.file });

const PAGES = [
  '/dashboard',
  '/properties',
  '/units',
  '/maintenance',
  '/tenants',
  '/leases',
  '/leases/new',
  '/invoices',
  '/arrears',
  '/calendar',
  '/bookings',
  '/bookings/new',
  '/payments',
  '/cash',
  '/reports',
  '/compliance',
  '/settings/team',
  '/settings/organization',
  '/payment-channels',
  '/billing',
];

/** Budget for compressed JavaScript per page load (baseline 2026-10-26: 470–485 KB). */
const JS_BUDGET_KB = 550;
const LCP_BUDGET_MS = 2500;

async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  // Data tables and cards render after their queries; wait for skeletons to go.
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0, { timeout: 15_000 });
}

for (const path of PAGES) {
  test(`${path} is accessible and fits the screen`, async ({ page }, info) => {
    await page.goto(path);
    await settle(page);
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map(
        (v) =>
          `${v.id}: ${v.help} (${v.nodes
            .map((n) => n.target.join(' '))
            .slice(0, 3)
            .join(' | ')})`,
      );
    expect(serious, serious.join('\n')).toEqual([]);

    if (info.project.name === 'mobile') {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
    }
  });
}

test('public pages are accessible', async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  for (const path of ['/sign-in', '/sign-up', '/forgot-password']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
      .analyze();
    const serious = violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${path} ${v.id}`);
    expect(serious, serious.join('\n')).toEqual([]);
  }
  await ctx.close();
});

for (const path of ['/sign-in', '/dashboard', '/leases/new', '/calendar']) {
  test(`${path} stays within the performance budget`, async ({ browser }, info) => {
    test.skip(info.project.name !== 'desktop', 'measured once, on desktop');
    // A fresh context: nothing cached, as for a first visit.
    const ctx = await browser.newContext(
      path === '/sign-in' ? {} : { storageState: DEMO.landlord.file },
    );
    const page = await ctx.newPage();
    let js = 0;
    page.on('requestfinished', async (req) => {
      if (req.resourceType() !== 'script' || !req.url().startsWith('http://localhost:3000')) return;
      js += (await req.sizes().catch(() => ({ responseBodySize: 0 }))).responseBodySize;
    });
    await page.goto(path, { waitUntil: 'networkidle' });
    const lcp = await page.evaluate(
      () =>
        new Promise<number>((resolve) =>
          new PerformanceObserver((list) => {
            const e = list.getEntries();
            resolve(e[e.length - 1]!.startTime);
          }).observe({ type: 'largest-contentful-paint', buffered: true }),
        ),
    );
    const budget = path === '/sign-in' ? 350 : JS_BUDGET_KB;
    expect(Math.round(js / 1024), `${path} JavaScript (KB, compressed)`).toBeLessThanOrEqual(
      budget,
    );
    expect(Math.round(lcp), `${path} LCP (ms)`).toBeLessThanOrEqual(LCP_BUDGET_MS);
    await ctx.close();
  });
}
