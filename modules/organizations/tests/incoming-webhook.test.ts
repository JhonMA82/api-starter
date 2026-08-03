import { describe, expect, test } from "bun:test";
import type { Job, JobQueue } from "@consulting/module-jobs";

import { createIncomingWebhookProcessor } from "../src/application/process-incoming-webhook";
import {
  createReceiveIncomingWebhookUseCase,
  INCOMING_WEBHOOK_JOB_TYPE,
  type ReceiveIncomingWebhookDeps,
  type ReceiveIncomingWebhookInput,
} from "../src/application/receive-incoming-webhook";
import {
  isWebhookTimestampFresh,
  signWebhookPayload,
  verifyWebhookSignature,
  WEBHOOK_MAX_CLOCK_SKEW_SECONDS,
} from "../src/application/webhook-signature";
import {
  assertValidEventId,
  assertValidProvider,
  parseIncomingWebhookPayload,
} from "../src/domain/incoming-webhook.entity";
import {
  IncomingWebhookEventIdError,
  InvalidWebhookProviderError,
  InvalidWebhookSignatureError,
  ProviderNotConfiguredError,
} from "../src/domain/organization.errors";
import { createFakeAudit, createFakeIncomingWebhookRepository } from "./fakes";

const SECRET = "whsec_test-signing-secret";
const NOW = new Date("2026-08-03T12:00:00.000Z");
const TIMESTAMP = String(Math.floor(NOW.getTime() / 1_000));
const BODY = JSON.stringify({ id: "evt_1", type: "payment.succeeded", data: { amount: 100 } });

function makeInput(
  overrides: Partial<ReceiveIncomingWebhookInput> = {},
): ReceiveIncomingWebhookInput {
  const rawBody = overrides.rawBody ?? BODY;
  return {
    provider: "stripe",
    signatureHeader: signWebhookPayload(SECRET, TIMESTAMP, rawBody),
    timestampHeader: TIMESTAMP,
    eventIdHeader: "evt_1",
    rawBody,
    ...overrides,
  };
}

function makeFakeJob(type: string, payload: Record<string, unknown>): Job {
  const now = new Date();
  return {
    id: crypto.randomUUID(),
    type,
    payload,
    status: "pending",
    attempts: 0,
    maxAttempts: 5,
    lastError: null,
    runAt: now,
    startedAt: null,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function createFakeQueue(): { queue: JobQueue; jobs: Job[] } {
  const jobs: Job[] = [];
  const queue: JobQueue = {
    async enqueue(input) {
      const job = makeFakeJob(input.type, input.payload);
      jobs.push(job);
      return job;
    },
    async schedule(input) {
      const job = makeFakeJob(input.type, input.payload);
      jobs.push(job);
      return job;
    },
    async cancel(jobId) {
      const job = jobs.find((entry) => entry.id === jobId);
      if (job === undefined) {
        throw new Error(`job not found: ${jobId}`);
      }
      return { ...job, status: "cancelled" };
    },
  };
  return { queue, jobs };
}

function setup(overrides: Partial<ReceiveIncomingWebhookDeps> = {}) {
  const { incomingWebhooks, incomingWebhookStore } = createFakeIncomingWebhookRepository();
  const { audit, records } = createFakeAudit();
  const { queue, jobs } = createFakeQueue();
  const useCase = createReceiveIncomingWebhookUseCase({
    incomingWebhooks,
    secrets: {
      async getSecret(provider: string) {
        return provider === "stripe" ? SECRET : null;
      },
    },
    queue,
    audit,
    now: () => NOW,
    ...overrides,
  });
  return { useCase, incomingWebhooks, incomingWebhookStore, audit, records, queue, jobs };
}

describe("signWebhookPayload / verifyWebhookSignature", () => {
  test("a signature produced by signWebhookPayload verifies", () => {
    const signature = signWebhookPayload(SECRET, TIMESTAMP, BODY);
    expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, signature)).toBe(true);
  });

  test("tampering with the body, timestamp, secret, or signature fails verification", () => {
    const signature = signWebhookPayload(SECRET, TIMESTAMP, BODY);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, `${BODY} `, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, "1", BODY, signature)).toBe(false);
    expect(verifyWebhookSignature("wrong-secret", TIMESTAMP, BODY, signature)).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, `${signature.slice(0, -1)}0`)).toBe(
      false,
    );
  });

  test("missing or malformed signatures return false without throwing", () => {
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, "")).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, "sha256=")).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, "md5=deadbeef")).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, `sha256=${"z".repeat(64)}`)).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, `sha256=${"a".repeat(63)}`)).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, `sha256=${"A".repeat(64)}`)).toBe(false);
    expect(verifyWebhookSignature(SECRET, TIMESTAMP, BODY, `sha256=${"a".repeat(128)}`)).toBe(
      false,
    );
  });
});

describe("isWebhookTimestampFresh", () => {
  test("accepts timestamps inside the 5-minute window (inclusive edges)", () => {
    expect(isWebhookTimestampFresh(String(Math.floor(NOW.getTime() / 1_000)), NOW)).toBe(true);
    expect(
      isWebhookTimestampFresh(
        String(Math.floor(NOW.getTime() / 1_000) + WEBHOOK_MAX_CLOCK_SKEW_SECONDS),
        NOW,
      ),
    ).toBe(true);
    expect(
      isWebhookTimestampFresh(
        String(Math.floor(NOW.getTime() / 1_000) - WEBHOOK_MAX_CLOCK_SKEW_SECONDS),
        NOW,
      ),
    ).toBe(true);
  });

  test("rejects timestamps outside the window", () => {
    expect(
      isWebhookTimestampFresh(
        String(Math.floor(NOW.getTime() / 1_000) + WEBHOOK_MAX_CLOCK_SKEW_SECONDS + 1),
        NOW,
      ),
    ).toBe(false);
    expect(
      isWebhookTimestampFresh(
        String(Math.floor(NOW.getTime() / 1_000) - WEBHOOK_MAX_CLOCK_SKEW_SECONDS - 1),
        NOW,
      ),
    ).toBe(false);
  });

  test("rejects unparseable timestamps", () => {
    expect(isWebhookTimestampFresh("", NOW)).toBe(false);
    expect(isWebhookTimestampFresh("not-a-number", NOW)).toBe(false);
    expect(isWebhookTimestampFresh("12.5", NOW)).toBe(false);
    expect(isWebhookTimestampFresh("   ", NOW)).toBe(false);
    expect(isWebhookTimestampFresh("123abc", NOW)).toBe(false);
  });
});

describe("assertValidProvider / assertValidEventId", () => {
  test("accepts lowercase provider names with digits and dashes, up to 64 chars", () => {
    expect(() => assertValidProvider("stripe")).not.toThrow();
    expect(() => assertValidProvider("github-2")).not.toThrow();
    expect(() => assertValidProvider("a".repeat(64))).not.toThrow();
  });

  test.each(["", "Stripe", "stripe!", "stripe_app", "a".repeat(65), " stripe "])(
    "rejects %j",
    (provider) => {
      expect(() => assertValidProvider(provider)).toThrow(InvalidWebhookProviderError);
    },
  );

  test("accepts event ids up to 256 chars, rejects blank or longer", () => {
    expect(() => assertValidEventId("evt_1")).not.toThrow();
    expect(() => assertValidEventId("a".repeat(256))).not.toThrow();
    expect(() => assertValidEventId("")).toThrow(IncomingWebhookEventIdError);
    expect(() => assertValidEventId("a".repeat(257))).toThrow(IncomingWebhookEventIdError);
  });
});

describe("parseIncomingWebhookPayload", () => {
  test("parses JSON objects", () => {
    expect(parseIncomingWebhookPayload(BODY)).toEqual({
      id: "evt_1",
      type: "payment.succeeded",
      data: { amount: 100 },
    });
  });

  test("retains truncated raw text for unparseable bodies", () => {
    const raw = "not json at all";
    expect(parseIncomingWebhookPayload(raw)).toEqual({ raw });
    const huge = "x".repeat(10_000);
    const retained = parseIncomingWebhookPayload(huge);
    expect(retained).toEqual({ raw: "x".repeat(4096) });
  });

  test("treats JSON arrays and scalars as non-objects (retained raw)", () => {
    expect(parseIncomingWebhookPayload("[1,2,3]")).toEqual({ raw: "[1,2,3]" });
    expect(parseIncomingWebhookPayload("42")).toEqual({ raw: "42" });
    expect(parseIncomingWebhookPayload("null")).toEqual({ raw: "null" });
  });
});

describe("createReceiveIncomingWebhookUseCase", () => {
  test("valid signature: stores the webhook (redacted, signatureValid true), audits, and enqueues", async () => {
    const { useCase, incomingWebhookStore, records, jobs } = setup();

    const body = JSON.stringify({ id: "evt_1", apiKey: "sk_test_123", name: "Acme" });
    const result = await useCase(makeInput({ rawBody: body }));

    expect(result.status).toBe("accepted");
    expect(result.webhook).toMatchObject({
      provider: "stripe",
      eventId: "evt_1",
      signatureValid: true,
      status: "received",
    });
    const stored = incomingWebhookStore.get(result.webhook.id);
    expect(stored?.signatureValid).toBe(true);
    // Sensitive keys are redacted before storage.
    expect(stored?.payload).toEqual({ id: "evt_1", apiKey: "[redacted]", name: "Acme" });
    expect(stored?.status).toBe("received");

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      action: "webhook.received",
      resourceType: "webhook",
      resourceId: result.webhook.id,
      outcome: "success",
      metadata: { provider: "stripe", eventId: "evt_1", signatureValid: true },
    });
    expect(JSON.stringify(records[0])).not.toContain("sk_test_123");

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      type: INCOMING_WEBHOOK_JOB_TYPE,
      payload: {
        webhookId: result.webhook.id,
        provider: "stripe",
        eventId: "evt_1",
      },
    });
  });

  test("without a queue the webhook is marked processed immediately", async () => {
    const { useCase, incomingWebhookStore } = setup({ queue: null });

    const result = await useCase(makeInput());

    expect(result.status).toBe("accepted");
    expect(incomingWebhookStore.get(result.webhook.id)?.status).toBe("processed");
    expect(incomingWebhookStore.get(result.webhook.id)?.processedAt).not.toBeNull();
  });

  test("a duplicate (provider + event id) returns duplicate and is not re-enqueued", async () => {
    const { useCase, incomingWebhookStore, jobs } = setup();
    const first = await useCase(makeInput());
    const second = await useCase(makeInput());

    expect(second.status).toBe("duplicate");
    expect(second.webhook.id).toBe(first.webhook.id);
    expect(incomingWebhookStore.size).toBe(1);
    expect(jobs).toHaveLength(1);
  });

  test("an invalid signature throws InvalidWebhookSignatureError and stores nothing", async () => {
    const { useCase, incomingWebhookStore } = setup();

    await expect(
      useCase(makeInput({ signatureHeader: signWebhookPayload("wrong", TIMESTAMP, BODY) })),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
    await expect(useCase(makeInput({ signatureHeader: null }))).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
    await expect(useCase(makeInput({ timestampHeader: "not-a-timestamp" }))).rejects.toBeInstanceOf(
      InvalidWebhookSignatureError,
    );
    expect(incomingWebhookStore.size).toBe(0);
  });

  test("a stale timestamp is rejected as an invalid signature (replay prevention)", async () => {
    const { useCase, incomingWebhookStore } = setup();

    const stale = String(Math.floor(NOW.getTime() / 1_000) - WEBHOOK_MAX_CLOCK_SKEW_SECONDS - 1);
    await expect(
      useCase(
        makeInput({
          timestampHeader: stale,
          signatureHeader: signWebhookPayload(SECRET, stale, BODY),
        }),
      ),
    ).rejects.toBeInstanceOf(InvalidWebhookSignatureError);
    expect(incomingWebhookStore.size).toBe(0);
  });

  test("an unknown provider throws ProviderNotConfiguredError", async () => {
    const { useCase, incomingWebhookStore } = setup();

    await expect(useCase(makeInput({ provider: "n8n" }))).rejects.toBeInstanceOf(
      ProviderNotConfiguredError,
    );
    expect(incomingWebhookStore.size).toBe(0);
  });

  test("an invalid provider name throws InvalidWebhookProviderError", async () => {
    const { useCase } = setup();
    await expect(useCase(makeInput({ provider: "Stripe!" }))).rejects.toBeInstanceOf(
      InvalidWebhookProviderError,
    );
  });

  test("an unparseable body is stored with a { raw } payload", async () => {
    const { useCase, incomingWebhookStore } = setup();
    const rawBody = "this is not json";
    const signature = signWebhookPayload(SECRET, TIMESTAMP, rawBody);

    const result = await useCase(makeInput({ rawBody, signatureHeader: signature }));

    expect(result.status).toBe("accepted");
    expect(incomingWebhookStore.get(result.webhook.id)?.payload).toEqual({ raw: rawBody });
  });

  test("the event id falls back to the body, then to a synthetic id", async () => {
    const { useCase, incomingWebhookStore } = setup();

    const bodyWithId = JSON.stringify({ event_id: "evt-from-body", type: "x" });
    const fromBody = await useCase(
      makeInput({
        eventIdHeader: null,
        rawBody: bodyWithId,
        signatureHeader: signWebhookPayload(SECRET, TIMESTAMP, bodyWithId),
      }),
    );
    expect(fromBody.webhook.eventId).toBe("evt-from-body");

    const bodyWithoutId = JSON.stringify({ type: "x" });
    const synthetic = await useCase(
      makeInput({
        eventIdHeader: null,
        rawBody: bodyWithoutId,
        signatureHeader: signWebhookPayload(SECRET, TIMESTAMP, bodyWithoutId),
      }),
    );
    expect(synthetic.webhook.eventId).toMatch(/^synthetic-/);
    expect(incomingWebhookStore.size).toBe(2);
  });

  test("an oversized event id header is rejected", async () => {
    const { useCase } = setup();
    await expect(useCase(makeInput({ eventIdHeader: "a".repeat(257) }))).rejects.toBeInstanceOf(
      IncomingWebhookEventIdError,
    );
  });
});

describe("createIncomingWebhookProcessor", () => {
  test("marks the webhook processing then processed with a default no-op handler", async () => {
    const { incomingWebhooks, incomingWebhookStore } = createFakeIncomingWebhookRepository();
    const received = (
      await incomingWebhooks.createIfAbsent({
        provider: "stripe",
        eventId: "evt_1",
        payload: {},
        signatureValid: true,
      })
    ).webhook;
    const processor = createIncomingWebhookProcessor({ incomingWebhooks });

    await processor.process(received.id);

    expect(incomingWebhookStore.get(received.id)?.status).toBe("processed");
  });

  test("runs the injected handler with the webhook and marks processed", async () => {
    const { incomingWebhooks, incomingWebhookStore } = createFakeIncomingWebhookRepository();
    const received = (
      await incomingWebhooks.createIfAbsent({
        provider: "stripe",
        eventId: "evt_1",
        payload: {},
        signatureValid: true,
      })
    ).webhook;
    const seen: string[] = [];
    const processor = createIncomingWebhookProcessor({
      incomingWebhooks,
      onEvent: async (webhook) => {
        seen.push(webhook.id);
      },
    });

    await processor.process(received.id);

    expect(seen).toEqual([received.id]);
    expect(incomingWebhookStore.get(received.id)?.status).toBe("processed");
  });

  test("a handler error marks the webhook failed", async () => {
    const { incomingWebhooks, incomingWebhookStore } = createFakeIncomingWebhookRepository();
    const received = (
      await incomingWebhooks.createIfAbsent({
        provider: "stripe",
        eventId: "evt_1",
        payload: {},
        signatureValid: true,
      })
    ).webhook;
    const processor = createIncomingWebhookProcessor({
      incomingWebhooks,
      onEvent: async () => {
        throw new Error("handler exploded");
      },
    });

    await processor.process(received.id);

    expect(incomingWebhookStore.get(received.id)?.status).toBe("failed");
  });

  test("an unknown webhook id is a no-op", async () => {
    const { incomingWebhooks, incomingWebhookStore } = createFakeIncomingWebhookRepository();
    const processor = createIncomingWebhookProcessor({ incomingWebhooks });

    await processor.process("missing");

    expect(incomingWebhookStore.size).toBe(0);
  });
});
