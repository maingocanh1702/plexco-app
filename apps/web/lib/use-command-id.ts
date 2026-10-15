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
 * Sticky uncertainty: once an attempt under the key was uncertain it may have committed, so from then
 * on only a 2xx, `reset()` or a different payload drops the key. A later 4xx (RATE_LIMITED,
 * CSRF_INVALID, any gate refusal) is answered BEFORE the route's replay lookup, so it proves nothing
 * about the earlier attempt; dropping the key there would turn the next identical retry into a second
 * command (a second Zalo connect rotates the webhook secret and resets verification). The keeper
 * learns of the uncertainty only through `settle(error)`: a caller that never settles an uncertain
 * failure (#53's useRosterCommand tracks it itself and skips `settle` for it) sees the plain rule.
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
  let current: { id: string; payload: string | undefined; uncertain: boolean } | null = null;
  return {
    get: (payload) => {
      if (current === null || current.payload !== payload) {
        current = { id: mint(), payload, uncertain: false };
      }
      return current.id;
    },
    settle: (error) => {
      if (current === null) return; // reset() while the attempt was in flight: a new command anyway
      if (error === undefined) current = null;
      else if (!isDefiniteFailure(error)) current.uncertain = true;
      else if (!current.uncertain) current = null; // definite, and no attempt under it was uncertain
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
