import { eq } from 'drizzle-orm';
import type { DbExecutor } from '../../infrastructure/database/client';
import { appSettings, type AppSettingRow } from '../../infrastructure/database/schema';

export class SettingsRepository {
  constructor(private readonly db: DbExecutor) {}

  async find(key: string): Promise<AppSettingRow | undefined> {
    const [row] = await this.db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
    return row;
  }

  async upsert(
    key: string,
    value: Record<string, unknown>,
    updatedBy: string | null,
  ): Promise<AppSettingRow> {
    const now = new Date();
    const [row] = await this.db
      .insert(appSettings)
      .values({ key, value, updatedBy, updatedAt: now })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedBy, updatedAt: now } })
      .returning();
    if (!row) throw new Error(`upsert of setting "${key}" returned no row`);
    return row;
  }
}
