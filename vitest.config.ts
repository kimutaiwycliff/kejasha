import { defineConfig } from 'vitest/config';

const ignore = ['**/node_modules/**', '**/dist/**'];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages}/**/*.test.ts'],
          exclude: [...ignore, '**/*.int.test.ts', '**/*.rls.test.ts', '**/*.journey.test.ts'],
        },
      },
      {
        test: {
          name: 'int',
          include: ['{apps,packages}/**/*.int.test.ts'],
          exclude: ignore,
          globalSetup: ['packages/db/test/global-setup.ts'],
          // Integration files share one Postgres; running them one at a time keeps password
          // hashing and multi-period billing runs from starving each other.
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'rls',
          include: ['{apps,packages}/**/*.rls.test.ts'],
          exclude: ignore,
          globalSetup: ['packages/db/test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'journeys',
          include: ['apps/api/test/journeys/**/*.journey.test.ts'],
          exclude: ignore,
          globalSetup: ['packages/db/test/global-setup.ts'],
          fileParallelism: false,
          testTimeout: 90_000,
          hookTimeout: 120_000,
        },
      },
    ],
  },
});
