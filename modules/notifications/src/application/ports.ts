import type { EmailMessage, Locale } from "../domain/notification.entity";

/**
 * Outbound email transport. Implementations MUST NOT log message bodies
 * (spec §16: logs without sensitive content).
 */
export interface Mailer {
  /**
   * Delivers the message. Throws MailerUnavailableError on transport
   * failure so callers can retry (the job queue's own retry policy).
   */
  send(message: EmailMessage): Promise<void>;
}

/**
 * Marker interface for future non-email channels (push, SMS). No methods yet:
 * the email path is the only one implemented in this work unit; new channels
 * will extend this interface without touching the Mailer contract.
 */
// biome-ignore lint/suspicious/noEmptyInterface: spec §16 mandates an empty marker interface for future channels
export interface NotificationChannel {
  /* reserved */
}

export interface TemplateRenderer {
  /**
   * Resolves the versioned template id against the registry, picks the locale
   * content (exact locale -> es -> first available) and substitutes
   * {placeholder} variables. Throws TemplateNotFoundError for unknown ids.
   */
  render(input: {
    templateId: string;
    variables: Record<string, string>;
    locale: Locale;
  }): Promise<{ subject: string; text: string; html: string | null }>;
}

/** Deduplication ledger (DB-backed) so idempotency survives restarts. */
export interface SentMailRepository {
  isDuplicated(dedupeKey: string): Promise<boolean>;
  record(dedupeKey: string, messageId: string): Promise<void>;
}
