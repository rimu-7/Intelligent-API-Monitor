import { z } from 'zod';

/** The only module that reads process.env in the simulator. Same parsing rules as the API (§5.2). */
const blank = (value: unknown) => (typeof value === 'string' && value.trim() === '' ? undefined : value);
const int = (fallback: number, min: number, max: number) =>
  z.preprocess(blank, z.coerce.number().int().min(min).max(max).default(fallback));
const secret = (name: string) =>
  z.preprocess(
    blank,
    z.string({ error: `${name} is required` }).min(32, `${name} must be at least 32 characters`),
  );

const schema = z
  .object({
    APP_ENV: z.preprocess(blank, z.enum(['development', 'test', 'production']).default('development')),
    LOG_LEVEL: z.preprocess(
      blank,
      z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    ),
    PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).optional()),
    SIMULATOR_PORT: z.preprocess(blank, z.coerce.number().int().min(1).max(65535).optional()),
    MONITOR_API_URL: z.preprocess(blank, z.url().default('http://localhost:3001')),
    INGEST_API_KEY: secret('INGEST_API_KEY'),
    INTERNAL_SERVICE_KEY: secret('INTERNAL_SERVICE_KEY'),
    SIMULATOR_SEED: int(42, 0, 2 ** 31 - 1),
    STREAM_MAX_DURATION_MS: int(600_000, 1_000, 3_600_000),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== 'production') return;
    for (const name of ['INGEST_API_KEY', 'INTERNAL_SERVICE_KEY'] as const) {
      if (env[name].startsWith('dev-only-')) {
        ctx.addIssue({ code: 'custom', path: [name], message: `${name} still uses a dev-only- value` });
      }
    }
  })
  .transform((env) => ({ ...env, LISTEN_PORT: env.PORT ?? env.SIMULATOR_PORT ?? 4400 }));

export type SimulatorEnv = Readonly<z.output<typeof schema>>;

export const parseSimulatorEnv = (source: Record<string, string | undefined>): SimulatorEnv => {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(
      `Invalid environment configuration:\n${result.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')}`,
    );
  }
  return Object.freeze(result.data);
};

export const loadSimulatorEnv = (): SimulatorEnv => {
  try {
    return parseSimulatorEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
};
