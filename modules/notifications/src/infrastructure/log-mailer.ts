import type { Mailer } from "../application/ports";
import type { EmailMessage } from "../domain/notification.entity";

/**
 * Dev-preview mailer: logs a REDACTED summary instead of delivering.
 * Only to/templateId/dedupeKey/subject are logged — the body (text/html) is
 * never emitted, per spec §16 (logs without sensitive content: bodies may
 * carry tokens, links, or personal data).
 */
export function createLogMailer(log: (line: string) => void = console.info): Mailer {
  return {
    async send(message: EmailMessage): Promise<void> {
      log(
        `[mailer] to=${message.to} template=${message.templateId} dedupe=${message.dedupeKey} subject=${message.subject}`,
      );
    },
  };
}
