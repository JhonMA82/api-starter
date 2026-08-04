import type { Mailer } from "../application/ports";
import { MailerUnavailableError } from "../domain/notification.errors";

/**
 * SMTP transport stub. Proves the Mailer interface and fails fast on
 * misconfiguration: the URL must parse and use the smtp: scheme, otherwise
 * createSmtpMailer throws MailerUnavailableError.
 *
 * Actual SMTP delivery is intentionally NOT implemented in this starter
 * (spec §16: "No atar el dominio a Resend, SendGrid u otro proveedor") — wire
 * a provider adapter (Resend, SendGrid, ...) instead. Do NOT add nodemailer:
 * no new external dependencies.
 */
export function createSmtpMailer(options: { url: string }): Mailer {
  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    throw new MailerUnavailableError(`Invalid SMTP URL: ${options.url}`);
  }
  if (parsed.protocol !== "smtp:") {
    throw new MailerUnavailableError(
      `Invalid SMTP URL: expected smtp:// scheme, got ${parsed.protocol}`,
    );
  }
  return {
    async send() {
      throw new MailerUnavailableError(
        "SMTP transport not implemented in this starter; use a provider adapter",
      );
    },
  };
}
