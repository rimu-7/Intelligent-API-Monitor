import nodemailer from 'nodemailer';
import type { Env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface MailSendResult {
  messageId: string | null;
}

export interface Mailer {
  send(message: MailMessage): Promise<MailSendResult>;
  close(): void;
}

/** SMTP via nodemailer (Mailpit locally). */
export const createMailer = (env: Env): Mailer => {
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? '' } } : {}),
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  return {
    async send(message) {
      const info = await transport.sendMail({ from: env.EMAIL_FROM, ...message });
      return { messageId: typeof info.messageId === 'string' ? info.messageId : null };
    },
    close() {
      transport.close();
    },
  };
};
