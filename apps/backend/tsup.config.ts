import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', worker: 'src/worker.ts', migrate: 'src/migrate.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  splitting: true,
  // The runtime image has no TypeScript sources for the shared package — bundle it.
  noExternal: ['@apimon/shared'],
});
