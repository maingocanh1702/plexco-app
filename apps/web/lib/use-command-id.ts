"use client";

import { useRef } from "react";
import { isDefiniteFailure } from "./session-error-ui";

/**
 * One idempotency key per attempt (DD-117 D5, same keep/drop rule as M2b): `get()` mints lazily and
 * keeps the key across an uncertain failure (network loss, 5xx) so a retry replays; `settle(error)`
 * drops it on success or a definite 4xx failure, so the next attempt is a new command.
 */
export function useCommandId() {
  const ref = useRef<string | null>(null);
  return {
    get: (): string => (ref.current ??= crypto.randomUUID()),
    settle: (error?: unknown): void => {
      if (error === undefined || isDefiniteFailure(error)) ref.current = null;
    },
    /** A changed intent (e.g. a newly typed token) is a new command. */
    reset: (): void => {
      ref.current = null;
    },
  };
}
