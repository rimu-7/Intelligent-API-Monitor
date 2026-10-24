import type { NotificationSettingsDto, TestEmailResultDto } from '@apimon/shared';
import type { Env } from '../../config/env';
import type { UserPrincipal } from '../../http/principal';
import type { Logger } from '../../infrastructure/logger';
import type { Mailer } from '../../infrastructure/mail/mailer';
import { AppError, ServiceUnavailableError } from '../../lib/errors';
import type { AuditContext, AuditService } from '../audit/audit.service';
import type { SettingsRepository } from './settings.repository';
import {
  storedNotificationSettings,
  type TestEmailInput,
  type UpdateNotificationSettingsInput,
} from './settings.schemas';

const NOTIFICATIONS_KEY = 'notifications';

/** `ALERT_EMAIL_TO` may hold a comma-separated list. */
const parseRecipients = (raw: string): string[] =>
  raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

type EmailEnv = Pick<
  Env,
  | 'EMAIL_ENABLED'
  | 'EMAIL_FROM'
  | 'ALERT_EMAIL_TO'
  | 'ALERT_EMAIL_MIN_SEVERITY'
  | 'SMTP_HOST'
  | 'SMTP_PORT'
  | 'SMTP_SECURE'
  | 'SMTP_USER'
>;

/** Alert-email recipients editable at runtime, with `ALERT_EMAIL_TO` as the fallback. */
export class SettingsService {
  constructor(
    private readonly deps: {
      repository: SettingsRepository;
      mailer: Mailer;
      audit: AuditService;
      env: EmailEnv;
      logger: Logger;
    },
  ) {}

  /** Current recipients. Never throws: falls back to the env value if the stored row is unreadable. */
  async alertRecipients(): Promise<string[]> {
    return (await this.loadRecipients()).recipients;
  }

  async getNotificationSettings(): Promise<NotificationSettingsDto> {
    const { env } = this.deps;
    const { recipients, source, updatedAt } = await this.loadRecipients();
    return {
      alert_email_to: recipients,
      source,
      email_enabled: env.EMAIL_ENABLED,
      min_severity: env.ALERT_EMAIL_MIN_SEVERITY,
      from: env.EMAIL_FROM,
      smtp: {
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        auth_configured: Boolean(env.SMTP_USER),
      },
      updated_at: updatedAt?.toISOString() ?? null,
    };
  }

  async updateNotificationSettings(
    input: UpdateNotificationSettingsInput,
    actor: UserPrincipal,
    context: AuditContext,
  ): Promise<NotificationSettingsDto> {
    const before = await this.alertRecipients();
    await this.deps.repository.upsert(NOTIFICATIONS_KEY, { alert_email_to: input.alert_email_to }, actor.id);
    await this.deps.audit.record({
      action: 'settings.notifications_changed',
      actor,
      target: { type: 'settings', id: NOTIFICATIONS_KEY },
      metadata: { from: before, to: input.alert_email_to },
      context,
    });
    return this.getNotificationSettings();
  }

  /** Sends one email synchronously so the caller sees the real SMTP result. */
  async sendTestEmail(
    input: TestEmailInput,
    actor: UserPrincipal,
    context: AuditContext,
  ): Promise<TestEmailResultDto> {
    const { env, mailer, logger, audit } = this.deps;
    if (!env.EMAIL_ENABLED) {
      throw new ServiceUnavailableError('Email is disabled. Set EMAIL_ENABLED=true and restart the API.');
    }
    const to = input.to ? [input.to] : await this.alertRecipients();
    const started = performance.now();
    try {
      const { messageId } = await mailer.send({
        to: to.join(', '),
        subject: '[API Monitor] Test email',
        text: [
          'This is a test email from API Monitor.',
          '',
          `Requested by: ${actor.email}`,
          `SMTP server: ${env.SMTP_HOST ?? 'not set'}:${String(env.SMTP_PORT)}`,
          '',
          'If you received this, alert emails will reach this address.',
        ].join('\n'),
        html: `<p>This is a test email from <strong>API Monitor</strong>.</p>
<p>Requested by: ${escapeHtml(actor.email)}<br>SMTP server: ${escapeHtml(env.SMTP_HOST ?? 'not set')}:${String(env.SMTP_PORT)}</p>
<p>If you received this, alert emails will reach this address.</p>`,
      });
      const durationMs = Math.round(performance.now() - started);
      await audit.record({
        action: 'settings.test_email_sent',
        actor,
        target: { type: 'settings', id: NOTIFICATIONS_KEY },
        metadata: { to, duration_ms: durationMs },
        context,
      });
      logger.info(
        { event: 'email.test_sent', recipients: to.length, duration_ms: durationMs },
        'test email sent',
      );
      return { delivered: true, to, message_id: messageId, duration_ms: durationMs };
    } catch (err) {
      logger.warn({ event: 'email.test_failed', err }, 'test email failed');
      const reason = err instanceof Error ? err.message.slice(0, 300) : 'unknown error';
      throw new AppError('EMAIL_DELIVERY_FAILED', `The SMTP server rejected or did not answer: ${reason}`, {
        smtp_host: env.SMTP_HOST,
        smtp_port: env.SMTP_PORT,
      });
    }
  }

  private async loadRecipients(): Promise<{
    recipients: string[];
    source: 'database' | 'environment';
    updatedAt: Date | null;
  }> {
    const fallback = {
      recipients: parseRecipients(this.deps.env.ALERT_EMAIL_TO),
      source: 'environment' as const,
      updatedAt: null,
    };
    try {
      const row = await this.deps.repository.find(NOTIFICATIONS_KEY);
      if (!row) return fallback;
      const parsed = storedNotificationSettings.safeParse(row.value);
      if (!parsed.success) {
        this.deps.logger.warn(
          { key: NOTIFICATIONS_KEY },
          'stored notification settings are invalid; using env',
        );
        return fallback;
      }
      return { recipients: parsed.data.alert_email_to, source: 'database', updatedAt: row.updatedAt };
    } catch (err) {
      this.deps.logger.warn({ err }, 'notification settings read failed; using env');
      return fallback;
    }
  }
}

const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (ch) => `&#${String(ch.charCodeAt(0))};`);
