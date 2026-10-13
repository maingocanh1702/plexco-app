"use client";

import { useCallback, useRef, useState } from "react";
import { isDefiniteFailure } from "./session-error-ui";
import { useCommandId } from "./use-command-id";

/**
 * One host command attempt: busy flag, the last error, and the idempotency key rule (DD-117 D5):
 * the key is kept across an uncertain failure so a retry replays, and dropped on success or a
 * definite 4xx. `locked` is sticky: once ANY attempt was uncertain it may have committed, so the
 * key stays and the inputs freeze until a 2xx (`replayed: true` included) or `reset()` (the host
 * cancels and refetches). A definite 4xx after that proves nothing about the earlier attempt (the
 * entry gate answers RATE_LIMITED / CSRF_INVALID before the replay lookup): it shows its error but
 * keeps the key and the lock. `run` resolves to the result, or `undefined` when it failed (the
 * error is then in `error`).
 */
export function useRosterCommand() {
  const id = useCommandId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [locked, setLocked] = useState(false);
  // `run` is created once, so it reads the sticky flag from a ref; `locked` re-renders the inputs.
  const uncertain = useRef(false);

  const run = useCallback(
    async <T>(call: (commandId: string) => Promise<T>): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      try {
        const result = await call(id.get());
        id.settle();
        uncertain.current = false;
        setLocked(false);
        return result;
      } catch (e) {
        if (!isDefiniteFailure(e)) uncertain.current = true;
        else if (!uncertain.current) id.settle(e); // definite, and no earlier attempt was uncertain
        setLocked(uncertain.current);
        setError(e);
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    // the `id` methods only close over a ref, so the first render's copy is always current
    [],
  );
  /** A new intent (dialog reopened for someone else, or the host cancelled and refetched). */
  const reset = useCallback(() => {
    id.reset();
    uncertain.current = false;
    setLocked(false);
    setError(null);
  }, []);
  return { busy, error, locked, run, reset };
}
