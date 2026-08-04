import { InvalidEmailError, InvalidTemplateIdError } from "./notification.errors";

export type Locale = "es" | "en";

export interface TemplateContext {
  variables: Record<string, string>;
  locale: Locale;
}

export interface EmailMessage {
  /** Recipient email (validated: non-blank, has @). */
  to: string;
  subject: string;
  /** Plain text body. */
  text: string;
  /** Optional HTML body. */
  html: string | null;
  /** e.g. "invitation.es.v1" — the versioned template id that produced the message. */
  templateId: string;
  /** e.g. "invitation:<tokenHash>:<to>" — the idempotency key used by the dedupe ledger. */
  dedupeKey: string;
}

/**
 * Rejects non-string, blank, or "@"-less email addresses (spec §16: recipient
 * validation). Kept deliberately simple — full RFC 5322 parsing is out of
 * scope; providers validate further downstream.
 */
export function assertValidEmailAddress(email: string): void {
  if (typeof email !== "string" || email.trim() === "" || !email.includes("@")) {
    throw new InvalidEmailError(email);
  }
}

/**
 * Rejects non-string or blank template ids. Versioned ids look like
 * "invitation.es.v1" but the exact format is the registry's concern; a
 * well-formed id that is not registered surfaces later as TemplateNotFoundError.
 */
export function assertValidTemplateId(templateId: string): void {
  if (typeof templateId !== "string" || templateId.trim() === "") {
    throw new InvalidTemplateIdError(templateId);
  }
}
