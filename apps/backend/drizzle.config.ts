import { defineConfig } from 'drizzle-kit';

// drizzle-kit is a dev tool run from the host (`npm run db:generate`); `generate` does not connect.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/infrastructure/database/schema.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
