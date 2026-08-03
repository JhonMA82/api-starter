import { ProblemDetailsSchema } from "@consulting/contracts";
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import type { ReceiveIncomingWebhookUseCase } from "../application/receive-incoming-webhook";
import {
  WEBHOOK_EVENT_ID_HEADER,
  WEBHOOK_SIGNATURE_HEADER,
  WEBHOOK_TIMESTAMP_HEADER,
} from "../application/webhook-signature";
import { toHttpException } from "./errors";

const problem = { "application/problem+json": { schema: resolver(ProblemDetailsSchema) } };

const IncomingWebhookResponse = z.object({
  status: z.enum(["accepted", "duplicate"]),
});

export interface IncomingWebhookRoutesDeps {
  receive: ReceiveIncomingWebhookUseCase;
}

/**
 * Incoming webhook receiver (spec §14.6). PUBLIC by design — no session, no
 * tenant middleware: the HMAC signature IS the authentication. The router is
 * mounted at /api/v1 WITHOUT the tenant/session middleware chain, so a
 * provider needs no credentials other than its signing secret.
 */
export function createIncomingWebhookRoutes(deps: IncomingWebhookRoutesDeps): Hono {
  const app = new Hono();

  app.post(
    "/webhooks/incoming/:provider",
    describeRoute({
      description:
        "Receives a signed incoming webhook from an external provider. The signature is " +
        "verified over the raw body (x-webhook-signature: sha256=HMAC-SHA256(secret, " +
        'timestamp + "." + body)) within a 5-minute freshness window; the event id ' +
        "(x-webhook-event-id or the body's id) dedupes replays. The response returns " +
        "immediately; the payload is processed asynchronously.",
      responses: {
        202: {
          description:
            "Accepted. Duplicates of an already-received event are not re-processed and also return 202",
          content: { "application/json": { schema: resolver(IncomingWebhookResponse) } },
        },
        400: { description: "Invalid provider or event id", content: problem },
        401: { description: "Invalid or missing signature", content: problem },
        404: { description: "Provider not configured", content: problem },
        500: { description: "Internal error", content: problem },
      },
    }),
    async (c) => {
      const provider = c.req.param("provider") as string;
      // Read the RAW body first: the signature covers the exact bytes sent.
      const rawBody = await c.req.text();
      try {
        const result = await deps.receive({
          provider,
          signatureHeader: c.req.header(WEBHOOK_SIGNATURE_HEADER) ?? null,
          timestampHeader: c.req.header(WEBHOOK_TIMESTAMP_HEADER) ?? null,
          eventIdHeader: c.req.header(WEBHOOK_EVENT_ID_HEADER) ?? null,
          rawBody,
        });
        return c.json({ status: result.status }, 202);
      } catch (error) {
        throw toHttpException(error);
      }
    },
  );

  return app;
}
