import { withIdempotencyKey } from "./mobile";

export interface OfflineMutation<TPayload> {
  idempotencyKey: string;
  path: string;
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  payload: TPayload;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
}

export interface OfflineMutationStore<TPayload> {
  enqueue(mutation: OfflineMutation<TPayload>): void;
  peekDue(now: number, limit: number): OfflineMutation<TPayload>[];
  markAttempt(id: string, nextAttemptAt: number): void;
  remove(id: string): void;
}

export interface RetryDelayOptions {
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitter?: (delayMs: number, attempt: number) => number;
}

const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_DELAY_MS = 60 * 60 * 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;

function assertDelay(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TypeError(`${name} must be a finite non-negative number`);
  }
}

function assertAttempt(attempt: number): void {
  if (!Number.isInteger(attempt) || attempt < 0) {
    throw new TypeError("attempt must be a non-negative integer");
  }
}

function assertMaxAttempts(maxAttempts: number): void {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer");
  }
}

/**
 * Computes bounded exponential backoff. `attempt` zero is the first retry
 * delay. Jitter receives the capped delay and may lower or raise it, but the
 * final result remains within the configured cap.
 */
export function computeRetryDelay(attempt: number, options: RetryDelayOptions = {}): number {
  assertAttempt(attempt);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  assertDelay("baseDelayMs", baseDelayMs);
  assertDelay("maxDelayMs", maxDelayMs);

  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * 2 ** attempt);
  const jitteredDelay = options.jitter?.(exponentialDelay, attempt) ?? exponentialDelay;
  assertDelay("jitter result", jitteredDelay);
  return Math.min(maxDelayMs, jitteredDelay);
}

/** Returns whether another send is allowed after `attempts` total attempts. */
export function shouldRetry(attempts: number, maxAttempts: number): boolean {
  assertAttempt(attempts);
  assertMaxAttempts(maxAttempts);
  return attempts < maxAttempts;
}

function copyMutation<TPayload>(mutation: OfflineMutation<TPayload>): OfflineMutation<TPayload> {
  return { ...mutation };
}

/**
 * In-memory store for tests and small deterministic examples. Duplicate
 * idempotency keys are ignored, and Map insertion order is the queue order.
 */
export function createInMemoryOfflineMutationStore<TPayload>(): OfflineMutationStore<TPayload> {
  const mutations = new Map<string, OfflineMutation<TPayload>>();

  return {
    enqueue: (mutation) => {
      if (!mutations.has(mutation.idempotencyKey)) {
        mutations.set(mutation.idempotencyKey, copyMutation(mutation));
      }
    },
    peekDue: (now, limit) => {
      if (!Number.isInteger(limit) || limit < 0) {
        throw new TypeError("limit must be a non-negative integer");
      }
      if (limit === 0) {
        return [];
      }
      const due: OfflineMutation<TPayload>[] = [];
      for (const mutation of mutations.values()) {
        if (mutation.nextAttemptAt <= now) {
          due.push(copyMutation(mutation));
          if (due.length === limit) {
            break;
          }
        }
      }
      return due;
    },
    markAttempt: (id, nextAttemptAt) => {
      const mutation = mutations.get(id);
      if (mutation !== undefined) {
        mutations.set(id, {
          ...mutation,
          attempts: mutation.attempts + 1,
          nextAttemptAt,
        });
      }
    },
    remove: (id) => {
      mutations.delete(id);
    },
  };
}

export type OfflineMutationSender<TPayload> = (
  mutation: OfflineMutation<TPayload>,
  headers: Headers,
) => Promise<unknown> | unknown;

export interface OfflineMutationRunnerOptions<TPayload> {
  store: OfflineMutationStore<TPayload>;
  send: OfflineMutationSender<TPayload>;
  now?: () => number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export interface OfflineMutationRunResult {
  processed: number;
  succeeded: number;
  failed: number;
  retried: number;
  exhausted: number;
  shouldRetry: boolean;
}

export interface OfflineMutationRunner {
  (): Promise<OfflineMutationRunResult>;
  run(): Promise<OfflineMutationRunResult>;
}

/**
 * Creates a one-pass runner. It has no timers: an application decides when to
 * call it, typically after connectivity changes or during an app foreground
 * event. Exhausted mutations remain inspectable but are never due again.
 */
export function createOfflineMutationRunner<TPayload>(
  options: OfflineMutationRunnerOptions<TPayload>,
): OfflineMutationRunner {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  assertMaxAttempts(maxAttempts);
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  assertDelay("baseDelayMs", baseDelayMs);
  assertDelay("maxDelayMs", maxDelayMs);

  const run = async (): Promise<OfflineMutationRunResult> => {
    const currentTime = options.now?.() ?? Date.now();
    if (!Number.isFinite(currentTime)) {
      throw new TypeError("now must return a finite number");
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    let retried = 0;
    let exhausted = 0;
    const due = options.store.peekDue(currentTime, Number.MAX_SAFE_INTEGER);

    for (const mutation of due) {
      processed += 1;
      try {
        await options.send(mutation, withIdempotencyKey({}, mutation.idempotencyKey));
        options.store.remove(mutation.idempotencyKey);
        succeeded += 1;
      } catch {
        failed += 1;
        const attemptsAfterFailure = mutation.attempts + 1;
        if (shouldRetry(attemptsAfterFailure, maxAttempts)) {
          const delay = computeRetryDelay(mutation.attempts, { baseDelayMs, maxDelayMs });
          options.store.markAttempt(mutation.idempotencyKey, currentTime + delay);
          retried += 1;
        } else {
          options.store.markAttempt(mutation.idempotencyKey, Number.POSITIVE_INFINITY);
          exhausted += 1;
        }
      }
    }

    return {
      processed,
      succeeded,
      failed,
      retried,
      exhausted,
      shouldRetry: retried > 0,
    };
  };

  return Object.assign(run, { run }) as OfflineMutationRunner;
}
