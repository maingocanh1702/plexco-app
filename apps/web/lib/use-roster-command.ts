"use client";

import { useCallback, useState } from "react";
import { useCommandId } from "./use-command-id";

/**
 * One host command attempt: busy flag, the last error, and the idempotency key rule (kept across an
 * uncertain failure so a retry replays, dropped on success or a definite 4xx). `run` resolves to the
 * result, or `undefined` when it failed (the error is then in `error`).
 */
export function useRosterCommand() {
  const id = useCommandId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = useCallback(
    async <T>(call: (commandId: string) => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await call(id.get());
        id.settle();
        return result;
      } catch (e) {
        id.settle(e);
        setError(e);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // the `id` methods only close over a ref, so the first render's copy is always current
    [],
  );
  /** A new intent (dialog reopened for someone else): fresh key, no stale error. */
  const reset = useCallback(() => {
    id.reset();
    setError(null);
  }, []);
  return { busy, error, run, reset };
}
