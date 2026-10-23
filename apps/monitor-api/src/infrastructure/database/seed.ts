import type { Logger } from '../logger';
import type { PasswordService } from '../../modules/auth/password.service';
import type { DbExecutor } from './client';
import { users } from './schema';

/**
 * Idempotent seed (§10.1): creates the admin from SEED_ADMIN_* only if no user with that
 * email exists. Never resets an existing password, never seeds other users.
 */
export const seedAdmin = async (
  db: DbExecutor,
  passwords: PasswordService,
  logger: Logger,
  admin: { email: string | undefined; password: string | undefined },
): Promise<'created' | 'exists' | 'skipped'> => {
  if (!admin.email || !admin.password) {
    logger.warn('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set: no admin seeded');
    return 'skipped';
  }
  const inserted = await db
    .insert(users)
    .values({ email: admin.email, passwordHash: await passwords.hash(admin.password), role: 'ADMIN' })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });
  if (inserted.length > 0) {
    logger.info({ event: 'seed.admin_created', email: admin.email }, 'admin user created');
    return 'created';
  }
  logger.info(
    { event: 'seed.admin_exists', email: admin.email },
    'admin user already exists, left unchanged',
  );
  return 'exists';
};
