"use client";

import { useState } from "react";
import { isDefiniteFailure } from "./session-error-ui";

/**
 * One idempotency key per attempt (DD-117 D5, same keep/drop rule as M2b).
 *
 * `get(payload)` mints lazily and keeps the key across an uncertain failure (network loss, 5xx) so an
 * IDENTICAL retry replays. The key is bound to `payload`, a fingerprint of the request body without
 * the commandId: a different payload is a different command and gets a fresh key. Without that, an
 * edit made after an uncertain failure would go out under the old key, and a route that replays a
 * processed key as a no-change 200 (PATCH /api/onboarding/club does) would report "saved" while
 * dropping the edit. `settle(error)` drops the key on success or a definite 4xx failure, so the next
 * attempt is a new command. `reset()` drops it explicitly.
 *
 * A caller whose body carries a secret (the Zalo bot token) must not use the body as the fingerprint:
 * it calls `get()` with no payload and `reset()` on every edit instead, which is equivalent.
 */
export interface CommandIdKeeper {
  get(payload?: string): string;
  settle(error?: unknown): void;
  reset(): void;
}

export function createCommandIdKeeper(
  mint: () => string = () => crypto.randomUUID(),
): CommandIdKeeper {
  let current: { id: string; payload: string | undefined } | null = null;
  return {
    get: (payload) => {
      if (current === null || current.payload !== payload) current = { id: mint(), payload };
      return current.id;
    },
    settle: (error) => {
      if (error === undefined || isDefiniteFailure(error)) current = null;
    },
    reset: () => {
      current = null;
    },
  };
}

/** The same keeper object for the component's whole life, so a callback created once stays current. */
export function useCommandId(): CommandIdKeeper {
  const [keeper] = useState(() => createCommandIdKeeper());
  return keeper;
}
