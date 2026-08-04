import type { Mailer } from "../application/ports";

/**
 * No-op mailer for tests: resolves without delivering or recording anything.
 */
export function createNoopMailer(): Mailer {
  return {
    async send() {
      /* nothing to do */
    },
  };
}
