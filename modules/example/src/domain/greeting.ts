export interface Greeting {
  name: string;
}

/**
 * Domain use case: builds a Greeting from a raw name.
 * Policy: the name is trimmed and capped at 50 characters. Pure function
 * with zero imports — the HTTP layer validates before this ever runs.
 */
export function createGreeting(name: string): Greeting {
  return { name: name.trim().slice(0, 50) };
}
