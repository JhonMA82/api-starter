import type { Job, JobQueue } from "@consulting/module-jobs";

import type { Mailer, SentMailRepository } from "../src/application/ports";
import type { EmailMessage } from "../src/domain/notification.entity";
import { MailerUnavailableError } from "../src/domain/notification.errors";

export function makeEmailMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    to: "user@example.com",
    subject: "Subject",
    text: "Body text",
    html: null,
    templateId: "invitation.v1",
    dedupeKey: "invitation:tok:user@example.com",
    ...overrides,
  };
}

export function createFakeMailer(): Mailer & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message) {
      sent.push(message);
    },
  };
}

export function createFailingMailer(): Mailer {
  return {
    async send() {
      throw new MailerUnavailableError("transport down");
    },
  };
}

export function createFakeSentMailRepository(
  seed: string[] = [],
): SentMailRepository & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  for (const key of seed) {
    rows.set(key, `message-for-${key}`);
  }
  return {
    rows,
    async isDuplicated(dedupeKey) {
      return rows.has(dedupeKey);
    },
    async record(dedupeKey, messageId) {
      rows.set(dedupeKey, messageId);
    },
  };
}

export function createFakeJobQueue(): JobQueue & { jobs: Job[] } {
  const jobs: Job[] = [];
  const makeJob = (
    input: { type: string; payload: Record<string, unknown> },
    runAt: Date,
  ): Job => ({
    id: crypto.randomUUID(),
    type: input.type,
    payload: input.payload,
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    runAt,
    startedAt: null,
    finishedAt: null,
    createdAt: runAt,
    updatedAt: runAt,
  });
  return {
    jobs,
    async enqueue(input) {
      const job = makeJob(input, new Date());
      jobs.push(job);
      return job;
    },
    async schedule(input) {
      const job = makeJob(input, input.runAt);
      jobs.push(job);
      return job;
    },
    async cancel(jobId) {
      const job = jobs.find((candidate) => candidate.id === jobId);
      if (job === undefined) {
        throw new Error("fake queue: job not found");
      }
      const updated: Job = { ...job, status: "cancelled", finishedAt: new Date() };
      jobs[jobs.indexOf(job)] = updated;
      return updated;
    },
  };
}
