import type { MailMessage, MailSendResult, Mailer } from '../../src/infrastructure/mail/mailer';

export class FakeMailer implements Mailer {
  sent: MailMessage[] = [];
  failNext = 0;

  send(message: MailMessage): Promise<MailSendResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('SMTP 451 temporary failure'));
    }
    this.sent.push(message);
    return Promise.resolve({ messageId: `<fake-${this.sent.length}@test>` });
  }

  close(): void {}
}
