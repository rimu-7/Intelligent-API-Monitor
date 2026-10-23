import { defineConfig } from 'vitest/config';

// Integration and contract tests share one Postgres DB and Redis DB, so they run serially.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/unit/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/integration/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/helpers/load-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
      {
        test: {
          name: 'contract',
          include: ['test/contract/**/*.test.ts'],
          environment: 'node',
          setupFiles: ['test/helpers/load-env.ts'],
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 30_000,
        },
      },
    ],
  },
});
