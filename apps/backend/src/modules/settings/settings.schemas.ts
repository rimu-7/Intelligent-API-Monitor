import { MAX_ALERT_RECIPIENTS } from '@apimon/shared';
import { z } from 'zod';

const email = z.email('must be a valid email address').trim().toLowerCase().max(254);

export const updateNotificationSettingsBody = z.strictObject({
  alert_email_to: z
    .array(email)
    .min(1, 'at least one recipient is required')
    .max(MAX_ALERT_RECIPIENTS, `at most ${MAX_ALERT_RECIPIENTS} recipients`)
    .transform((list) => [...new Set(list)]),
});

/** Optional override; defaults to the saved alert recipients. */
export const testEmailBody = z.strictObject({ to: email.optional() });

/** What is stored in `app_settings.value` for key `notifications`. */
export const storedNotificationSettings = z.object({
  alert_email_to: z.array(z.string()).min(1),
});

export type UpdateNotificationSettingsInput = z.output<typeof updateNotificationSettingsBody>;
export type TestEmailInput = z.output<typeof testEmailBody>;
