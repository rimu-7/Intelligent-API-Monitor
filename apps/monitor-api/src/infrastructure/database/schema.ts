import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  index,
  inet,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * PostgreSQL schema (§10). All timestamps are timestamptz (UTC); ids are uuid unless noted.
 * `alert_severity` is declared low → high so GREATEST() and `>` order correctly.
 */

export const userRole = pgEnum('user_role', ['ADMIN', 'MANAGER']);
export const alertStatus = pgEnum('alert_status', ['ACTIVE', 'RESOLVED']);
export const alertSeverity = pgEnum('alert_severity', ['WARNING', 'CRITICAL']);
export const aiStatus = pgEnum('ai_status', ['PENDING', 'COMPLETED', 'FALLBACK']);
export const resolutionSource = pgEnum('resolution_source', ['MANUAL', 'AUTO']);
export const notificationStatus = pgEnum('notification_status', ['PENDING', 'SENDING', 'SENT', 'FAILED']);
export const notificationReason = pgEnum('notification_reason', ['NEW', 'ESCALATED']);

const tz = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => tz('created_at').notNull().defaultNow();
const updatedAt = () =>
  tz('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

// ─── Auth ───────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  /** Stored trimmed + lowercased. */
  email: varchar('email', { length: 254 }).notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  /** No default — the creator must choose. */
  role: userRole('role').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  /** Bumped on password/role change and deactivation; access tokens carry it as `tv`. */
  tokenVersion: integer('token_version').notNull().default(0),
  lastLoginAt: tz('last_login_at'),
  passwordChangedAt: tz('password_changed_at'),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    familyId: uuid('family_id').notNull(),
    /** sha256 hex of the token; the token itself is never stored. */
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: tz('expires_at').notNull(),
    revokedAt: tz('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 32 }),
    replacedById: uuid('replaced_by_id'),
    createdIp: inet('created_ip'),
    userAgent: varchar('user_agent', { length: 256 }),
    createdAt: createdAt(),
  },
  (t) => [
    index('refresh_tokens_user_id_idx').on(t.userId),
    index('refresh_tokens_family_id_idx').on(t.familyId),
  ],
);

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    actorType: varchar('actor_type', { length: 16 }).notNull(),
    actorId: uuid('actor_id'),
    action: varchar('action', { length: 64 }).notNull(),
    targetType: varchar('target_type', { length: 32 }),
    targetId: varchar('target_id', { length: 128 }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    ip: inet('ip'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('audit_logs_created_at_idx').on(t.createdAt.desc())],
);

// ─── Monitoring ─────────────────────────────────────────────────────────────

export const monitoredApis = pgTable(
  'monitored_apis',
  {
    name: varchar('name', { length: 120 }).primaryKey(),
    latencyWarningMs: integer('latency_warning_ms'),
    latencyCriticalMs: integer('latency_critical_ms'),
    expectsRecords: boolean('expects_records').notNull().default(true),
    firstSeenAt: tz('first_seen_at').notNull().defaultNow(),
    lastSeenAt: tz('last_seen_at').notNull().defaultNow(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check(
      'monitored_apis_thresholds_check',
      sql`(${t.latencyWarningMs} IS NULL AND ${t.latencyCriticalMs} IS NULL) OR (${t.latencyWarningMs} IS NOT NULL AND ${t.latencyCriticalMs} IS NOT NULL AND ${t.latencyCriticalMs} > ${t.latencyWarningMs})`,
    ),
  ],
);

export const monitorRuns = pgTable(
  'monitor_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** api | static_file | live_pull | simulator */
    source: varchar('source', { length: 24 }).notNull(),
    sourceDetail: varchar('source_detail', { length: 200 }),
    /** user id, `ingest-key` or `anonymous` */
    principal: varchar('principal', { length: 80 }).notNull(),
    received: integer('received').notNull().default(0),
    processed: integer('processed').notNull().default(0),
    healthy: integer('healthy').notNull().default(0),
    anomalous: integer('anomalous').notNull().default(0),
    rejected: integer('rejected').notNull().default(0),
    alertsCreated: integer('alerts_created').notNull().default(0),
    alertsUpdated: integer('alerts_updated').notNull().default(0),
    durationMs: integer('duration_ms'),
    requestId: varchar('request_id', { length: 64 }),
    createdAt: createdAt(),
  },
  (t) => [index('monitor_runs_created_at_idx').on(t.createdAt.desc())],
);

export const alerts = pgTable(
  'alerts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    fingerprint: char('fingerprint', { length: 64 }).notNull(),
    apiName: varchar('api_name', { length: 120 }).notNull(),
    status: alertStatus('status').notNull().default('ACTIVE'),
    severity: alertSeverity('severity').notNull(),
    previousSeverity: alertSeverity('previous_severity'),
    anomalyTypes: text('anomaly_types').array().notNull(),
    // Trigger sample — the alert text always describes these values.
    statusCode: integer('status_code'),
    responseTimeMs: integer('response_time_ms'),
    recordsReturned: integer('records_returned'),
    // Latest and peak values.
    lastStatusCode: integer('last_status_code'),
    lastResponseTimeMs: integer('last_response_time_ms'),
    lastRecordsReturned: integer('last_records_returned'),
    peakResponseTimeMs: integer('peak_response_time_ms'),
    occurrenceCount: integer('occurrence_count').notNull().default(1),
    alertMessage: text('alert_message').notNull(),
    probableCause: text('probable_cause').notNull(),
    recommendedAction: text('recommended_action').notNull(),
    aiStatus: aiStatus('ai_status').notNull().default('PENDING'),
    /** gemini | openai | mistral | template */
    aiProvider: varchar('ai_provider', { length: 16 }),
    aiModel: varchar('ai_model', { length: 100 }),
    aiPromptVersion: varchar('ai_prompt_version', { length: 32 }),
    aiGeneratedAt: tz('ai_generated_at'),
    enrichmentVersion: integer('enrichment_version').notNull().default(1),
    firstSeenAt: tz('first_seen_at').notNull(),
    lastSeenAt: tz('last_seen_at').notNull(),
    escalatedAt: tz('escalated_at'),
    resolvedAt: tz('resolved_at'),
    resolvedBy: uuid('resolved_by').references(() => users.id, { onDelete: 'set null' }),
    resolutionSource: resolutionSource('resolution_source'),
    resolutionNote: varchar('resolution_note', { length: 500 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    // One ACTIVE incident per fingerprint; a resolved incident can re-open as a new row.
    uniqueIndex('alerts_active_fingerprint_uq')
      .on(t.fingerprint)
      .where(sql`status = 'ACTIVE'`),
    index('alerts_status_severity_last_seen_idx').on(t.status, t.severity, t.lastSeenAt.desc()),
    index('alerts_api_name_status_idx').on(t.apiName, t.status),
    index('alerts_pending_updated_at_idx')
      .on(t.updatedAt)
      .where(sql`ai_status = 'PENDING'`),
  ],
);

export const telemetryLogs = pgTable(
  'telemetry_logs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid('run_id')
      .notNull()
      .references(() => monitorRuns.id),
    apiName: varchar('api_name', { length: 120 }).notNull(),
    statusCode: integer('status_code'),
    responseTimeMs: integer('response_time_ms'),
    recordsReturned: integer('records_returned'),
    isAnomalous: boolean('is_anomalous').notNull(),
    severity: alertSeverity('severity'),
    anomalyTypes: text('anomaly_types')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    alertId: uuid('alert_id').references(() => alerts.id, { onDelete: 'set null' }),
    observedAt: tz('observed_at').notNull(),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('telemetry_logs_api_name_observed_at_idx').on(t.apiName, t.observedAt.desc()),
    index('telemetry_logs_observed_at_idx').on(t.observedAt),
    index('telemetry_logs_alert_id_idx').on(t.alertId),
    index('telemetry_logs_run_id_idx').on(t.runId),
  ],
);

/** Items that could not be attributed to an API. No raw payload column — field names and messages only. */
export const rejectedTelemetry = pgTable(
  'rejected_telemetry',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    runId: uuid('run_id')
      .notNull()
      .references(() => monitorRuns.id),
    itemIndex: integer('item_index').notNull(),
    reason: varchar('reason', { length: 32 }).notNull(),
    fieldErrors: jsonb('field_errors').$type<{ field: string; message: string }[]>().notNull().default([]),
    receivedAt: tz('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('rejected_telemetry_received_at_idx').on(t.receivedAt),
    index('rejected_telemetry_run_id_idx').on(t.runId),
  ],
);

export const alertNotifications = pgTable(
  'alert_notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    alertId: uuid('alert_id')
      .notNull()
      .references(() => alerts.id, { onDelete: 'cascade' }),
    channel: varchar('channel', { length: 16 }).notNull().default('email'),
    reason: notificationReason('reason').notNull(),
    status: notificationStatus('status').notNull().default('PENDING'),
    attempts: integer('attempts').notNull().default(0),
    lastError: varchar('last_error', { length: 500 }),
    sentAt: tz('sent_at'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique('alert_notifications_alert_channel_reason_uq').on(t.alertId, t.channel, t.reason),
    index('alert_notifications_status_created_at_idx').on(t.status, t.createdAt),
  ],
);

// ─── Settings ───────────────────────────────────────────────────────────────

/** Runtime settings an admin can change without a redeploy (one row per key, value is JSON). */
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: updatedAt(),
});

export type UserRow = typeof users.$inferSelect;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
export type AlertRow = typeof alerts.$inferSelect;
export type MonitorRunRow = typeof monitorRuns.$inferSelect;
export type MonitoredApiRow = typeof monitoredApis.$inferSelect;
export type TelemetryLogRow = typeof telemetryLogs.$inferSelect;
export type AlertNotificationRow = typeof alertNotifications.$inferSelect;
export type AuditLogRow = typeof auditLogs.$inferSelect;
export type AppSettingRow = typeof appSettings.$inferSelect;
