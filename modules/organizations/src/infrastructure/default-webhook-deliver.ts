import type { WebhookDeliverInput, WebhookDeliverResult } from "../application/deliver-webhook";

/**
 * Production deliver function: POSTs the payload with the HMAC headers and a
 * 10s timeout, then returns the HTTP status. Network-level failures
 * (unreachable host, TLS error, timeout) are wrapped in an Error with a
 * readable message; HTTP statuses are NOT errors here — the deliverer decides
 * what to record based on the status.
 */
export async function defaultWebhookDeliver(
  input: WebhookDeliverInput,
): Promise<WebhookDeliverResult> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`webhook delivery network error: ${message}`);
  }
  return { status: response.status };
}
