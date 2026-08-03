import { describe, expect, test } from "bun:test";
import type { Config } from "@consulting/config";

import { createApp } from "../../../apps/api/src/app";
import { createStaticWebhookSecrets, signWebhookPayload } from "../src";
import { createFakeIncomingWebhookRepository, createFakeRepositories } from "./fakes";

const config: Config = {
  APP_ENV: "test",
  APP_VERSION: "0.1.0",
  API_BASE_URL: "http://localhost:3000",
  LOG_LEVEL: "debug",
  PORT: 3000,
  HOST: "0.0.0.0",
  CORS_ORIGINS: ["https://app.example.com"],
  DATABASE_URL: "postgres://postgres:postgres@localhost:5432/api",
  BETTER_AUTH_SECRET: "test-secret-at-least-32-characters-long",
  TRUSTED_ORIGINS: [],
};

const SECRET = "whsec_stripe-test-secret";
const NOW = Math.floor(Date.now() / 1_000);
const BODY = JSON.stringify({ id: "evt_123", type: "payment.succeeded", data: { amount: 100 } });

function signedRequest(overrides: RequestInit & { body?: string } = {}) {
  const body = overrides.body ?? BODY;
  const headers = {
    "content-type": "application/json",
    "x-webhook-signature": signWebhookPayload(SECRET, String(NOW), body),
    "x-webhook-timestamp": String(NOW),
    "x-webhook-event-id": "evt_123",
    ...(overrides.headers ?? {}),
  };
  return new Request("http://localhost/api/v1/webhooks/incoming/stripe", {
    ...overrides,
    method: "POST",
    headers,
    body,
  });
}

function setupApp() {
  const repos = createFakeRepositories();
  const { incomingWebhooks, incomingWebhookStore } = createFakeIncomingWebhookRepository();
  const app = createApp(config, {
    organizations: {
      repositories: {
        organizations: repos.organizations,
        memberships: repos.memberships,
        invitations: repos.invitations,
        apiKeys: repos.apiKeys,
        webhooks: repos.webhooks,
        uow: null,
      },
      incomingWebhooks: {
        repository: incomingWebhooks,
        secrets: createStaticWebhookSecrets({ stripe: SECRET }),
        queue: null,
      },
    },
  });
  return { app, incomingWebhookStore };
}

describe("POST /api/v1/webhooks/incoming/:provider", () => {
  test("a valid signed webhook is accepted with 202 and stored", async () => {
    const { app, incomingWebhookStore } = setupApp();

    const res = await app.request(signedRequest());

    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: "accepted" });
    expect(incomingWebhookStore.size).toBe(1);
    const stored = [...incomingWebhookStore.values()][0];
    expect(stored).toMatchObject({
      provider: "stripe",
      eventId: "evt_123",
      signatureValid: true,
      status: "processed",
    });
    expect(stored?.payload).toEqual({
      id: "evt_123",
      type: "payment.succeeded",
      data: { amount: 100 },
    });
  });

  test("a replayed event returns 202 with status duplicate and is not stored twice", async () => {
    const { app, incomingWebhookStore } = setupApp();

    const first = await app.request(signedRequest());
    const replay = await app.request(signedRequest());

    expect(first.status).toBe(202);
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual({ status: "duplicate" });
    expect(incomingWebhookStore.size).toBe(1);
  });

  test("an invalid signature returns 401 problem+json and stores nothing", async () => {
    const { app, incomingWebhookStore } = setupApp();

    const res = await app.request(
      signedRequest({
        headers: { "x-webhook-signature": signWebhookPayload("wrong-secret", String(NOW), BODY) },
      }),
    );

    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe(401);
    expect(body.code).toBe("UNAUTHORIZED");
    expect(incomingWebhookStore.size).toBe(0);
  });

  test("an unknown provider returns 404 (provider existence is not revealed)", async () => {
    const { app, incomingWebhookStore } = setupApp();

    const res = await app.request(
      new Request("http://localhost/api/v1/webhooks/incoming/github", {
        method: "POST",
        headers: {
          "x-webhook-signature": signWebhookPayload(SECRET, String(NOW), BODY),
          "x-webhook-timestamp": String(NOW),
        },
        body: BODY,
      }),
    );

    expect(res.status).toBe(404);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("NOT_FOUND");
    expect(incomingWebhookStore.size).toBe(0);
  });

  test("an invalid provider name returns 400", async () => {
    const { app } = setupApp();

    const res = await app.request(
      new Request("http://localhost/api/v1/webhooks/incoming/NotAProvider", {
        method: "POST",
        body: BODY,
      }),
    );

    expect(res.status).toBe(400);
  });

  test("a stale timestamp returns 401 even with a valid signature", async () => {
    const { app, incomingWebhookStore } = setupApp();
    const stale = NOW - 301;

    const res = await app.request(
      signedRequest({
        headers: {
          "x-webhook-signature": signWebhookPayload(SECRET, String(stale), BODY),
          "x-webhook-timestamp": String(stale),
        },
      }),
    );

    expect(res.status).toBe(401);
    expect(incomingWebhookStore.size).toBe(0);
  });
});
