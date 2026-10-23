import type { Job } from 'bullmq';
import { emailJobSchema } from '../infrastructure/queue/queues';
import type { NotificationsService } from '../modules/notifications/notifications.service';

/** Sends one notification; a thrown error makes BullMQ retry (5 attempts, exponential 10 s). */
export const createEmailProcessor =
  (notifications: NotificationsService) =>
  async (job: Job): Promise<string> => {
    const data = emailJobSchema.parse(job.data);
    return notifications.send(data.notificationId);
  };
