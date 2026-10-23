import path from 'node:path';

// Host-mode tests read TEST_DATABASE_URL / TEST_REDIS_URL from the repo .env (CI sets them directly).
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '../../../../.env'));
} catch {
  // no .env — rely on the environment
}
