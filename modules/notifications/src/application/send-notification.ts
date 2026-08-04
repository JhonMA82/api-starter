import type { JobQueue } from "@consulting/module-jobs";

import {
  assertValidEmailAddress,
  assertValidTemplateId,
  type EmailMessage,
  type Locale,
} from "../domain/notification.entity";
import type { Mailer, SentMailRepository, TemplateRenderer } from "./ports";

export const NOTIFICATION_JOB_TYPE = "notification.send";

/**
 * Payload carried by "notification.send" jobs. The message is rendered BEFORE
 * enqueueing so the job is self-contained: the worker never re-renders and
 * cannot hit a template version drift between queue time and delivery time.
 */
export interface NotificationJobPayload {
  messageId: string;
  to: string;
  subject: string;
  text: string;
  html: string | null;
  templateId: string;
  dedupeKey: string;
}

/** Handler shape consumed by the JobQueue consumer loop. */
export type JobHandler = (job: { type: string; payload: NotificationJobPayload }) => Promise<void>;

export interface SendNotificationDeps {
  mailer: Mailer;
  templates: TemplateRenderer;
  sent: SentMailRepository;
  /** Async sending; null = send synchronously (tests/dev). */
  queue: JobQueue | null;
  /** Per-user locale, defaulting to Spanish. */
  locale?: Locale;
}

export interface SendNotificationInput {
  to: string;
  templateId: string;
  variables: Record<string, string>;
  dedupeKey: string;
}

export type SendNotificationResult = {
  status: "sent" | "queued" | "duplicate";
  messageId: string;
};

export interface SendNotificationService {
  send(input: SendNotificationInput): Promise<SendNotificationResult>;
}

export function createSendNotificationService(deps: SendNotificationDeps): SendNotificationService {
  const locale = deps.locale ?? "es";
  return {
    async send(input) {
      assertValidEmailAddress(input.to);
      assertValidTemplateId(input.templateId);

      if (await deps.sent.isDuplicated(input.dedupeKey)) {
        return { status: "duplicate", messageId: input.dedupeKey };
      }

      // Rendered BEFORE enqueue: the job carries the final message (spec §16).
      const rendered = await deps.templates.render({
        templateId: input.templateId,
        variables: input.variables,
        locale,
      });

      const messageId = crypto.randomUUID();

      if (deps.queue !== null) {
        await deps.queue.enqueue({
          type: NOTIFICATION_JOB_TYPE,
          payload: {
            messageId,
            to: input.to,
            subject: rendered.subject,
            text: rendered.text,
            html: rendered.html,
            templateId: input.templateId,
            dedupeKey: input.dedupeKey,
          },
        });
        // Recorded at queue time so replays of the same dedupeKey dedupe; the
        // worker re-checks isDuplicated before sending as a second guard.
        await deps.sent.record(input.dedupeKey, messageId);
        return { status: "queued", messageId };
      }

      await deps.mailer.send({
        to: input.to,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        templateId: input.templateId,
        dedupeKey: input.dedupeKey,
      });
      await deps.sent.record(input.dedupeKey, messageId);
      return { status: "sent", messageId };
    },
  };
}

export interface NotificationWorkerDeps {
  mailer: Mailer;
  sent: SentMailRepository;
  /** Injected clock for future scheduling/retry hooks. */
  now?: () => Date;
}

/**
 * JobQueue consumer for "notification.send" jobs. Idempotent: skips jobs whose
 * dedupeKey was already recorded (e.g. queued before a worker restart).
 * Transport failures (MailerUnavailableError) propagate so the queue's own
 * retry policy fails and re-runs the job.
 */
export function createNotificationWorker(deps: NotificationWorkerDeps): JobHandler {
  return async (job) => {
    const payload = job.payload;
    if (await deps.sent.isDuplicated(payload.dedupeKey)) {
      return;
    }
    const message: EmailMessage = {
      to: payload.to,
      subject: payload.subject,
      text: payload.text,
      html: payload.html,
      templateId: payload.templateId,
      dedupeKey: payload.dedupeKey,
    };
    await deps.mailer.send(message);
    await deps.sent.record(payload.dedupeKey, payload.messageId);
  };
}
