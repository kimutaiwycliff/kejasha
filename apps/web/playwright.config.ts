import { defineConfig, devices } from '@playwright/test';

/**
 * Web journeys (ADR-012). The API must already be running at NEXT_PUBLIC_API_URL
 * (`make dev-api` locally; the CI job boots the built API with BILLING_REQUIRED=false).
 * Locally the web dev server is reused; in CI the production build is started.
 */
const ci = Boolean(process.env.CI);

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 1 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: ci ? 'pnpm start' : 'pnpm dev',
    url: 'http://localhost:3000/sign-in',
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
});
