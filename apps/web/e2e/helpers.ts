import { execFileSync } from 'node:child_process';
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
  const menu = page.getByRole('button', { name: 'Account menu' });
  // A click before hydration does nothing, so retry until the sheet is open.
  await expect(async () => {
    if (await menu.isHidden())
      await page.getByRole('button', { name: 'Toggle navigation' }).click();
    await expect(menu).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 10_000 });
}

/**
 * Seeded demo users (`pnpm --filter @kejasha/api seed`). The setup project signs each in once
 * and saves the session, so journeys start signed in without hitting sign-in rate limits.
 */
export const DEMO = {
  landlord: { email: 'landlord@demo.test', file: 'e2e/.auth/landlord.json' },
  agency: { email: 'agency@demo.test', file: 'e2e/.auth/agency.json' },
} as const;

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

/**
 * Calls the API with the page's session (cookies are shared across localhost ports), for test
 * setup that is not what the journey is about.
 */
export async function apiPost<T>(page: Page, path: string, body: unknown): Promise<T> {
  const res = await page.request.post(`${API}${path}`, {
    data: body,
    headers: { 'Idempotency-Key': crypto.randomUUID(), Origin: 'http://localhost:3000' },
  });
  if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export async function apiGet<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(`${API}${path}`);
  if (!res.ok()) throw new Error(`${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

export const randomTag = () => String(Math.floor(100000 + Math.random() * 900000));

/**
 * Run SQL against the API's database (test setup only: reading a dev OTP, granting an operator).
 * Uses DATABASE_URL, as in CI; locally the default dev database.
 */
export function sql(query: string): string {
  const url = process.env.DATABASE_URL ?? 'postgresql://app_owner:secret@localhost:5432/kejasha';
  return execFileSync('psql', [url, '-At', '-c', query], { encoding: 'utf8' }).trim();
}

/** The latest phone OTP the API stored for a +254 number (no SMS provider in dev/CI). */
export function latestOtp(e164: string): string {
  const v = sql(
    `SELECT value FROM verification WHERE identifier = '${e164.replace(/[^+\d]/g, '')}' ORDER BY created_at DESC LIMIT 1`,
  );
  return v.split(':')[0]!;
}
