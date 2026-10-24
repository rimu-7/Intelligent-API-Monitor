/** Admin-editable runtime settings (`/api/v1/settings/*`). */

/** Where alert recipients come from: saved in the database, or the `ALERT_EMAIL_TO` env fallback. */
export type SettingSource = 'database' | 'environment';

export interface NotificationSettingsDto {
  alert_email_to: string[];
  source: SettingSource;
  email_enabled: boolean;
  min_severity: 'WARNING' | 'CRITICAL';
  from: string;
  smtp: {
    /** Null when no SMTP server is configured. */
    host: string | null;
    port: number;
    secure: boolean;
    auth_configured: boolean;
  };
  updated_at: string | null;
}

export interface TestEmailResultDto {
  delivered: true;
  to: string[];
  message_id: string | null;
  duration_ms: number;
}

/** Most addresses one alert email may go to. */
export const MAX_ALERT_RECIPIENTS = 10;
