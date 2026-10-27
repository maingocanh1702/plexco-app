"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { isDefiniteFailure } from "./session-error-ui";
import { createUncertainCommandIdSessionStore } from "./uncertain-command-id-session-store";
import { isCommandIdConflict, useCommandId } from "./use-command-id";
import { useSessionPersonId } from "./use-session";

export type RosterCommandKind = "mark-paid" | "add" | "remove" | "reverse";

/** What one roster command is about: the persisted key's scope (with the session person) + payload. */
type RosterCommandIntent = {
  tenantId: string;
  kind: RosterCommandKind;
  targets: readonly string[];
  fingerprint: string;
};

/** One store for every roster screen; it resolves sessionStorage per call, so module scope is safe. */
const store = createUncertainCommandIdSessionStore();

/**
 * One host command attempt: busy flag, the last error, and the idempotency key rule (DD-117 D5):
 * the key is kept across an uncertain failure so a retry replays, and dropped on success or a
 * definite 4xx. Every failure is settled into the keeper (`useCommandId`), which owns that rule.
 * `locked` is sticky: once ANY attempt of this mount was uncertain it may have committed, so the
 * key stays and the inputs freeze until a 2xx (`replayed: true` included) or `reset()` (the host
 * cancels and refetches). A definite 4xx after that proves nothing about the earlier attempt (the
 * entry gate answers RATE_LIMITED / CSRF_INVALID before the replay lookup): it shows its error but
 * keeps the key and the lock. COMMAND_ID_CONFLICT is the exception: the key belongs to another
 * command, so the keeper drops it and the inputs unlock (the next submit is a new command, no loop).
 * `run` resolves to the result, or `undefined` when it failed (the error is then in `error`).
 *
 * Persistence (L49 D4): with an `intent` and a signed-in person (`useSessionPersonId`), the key of an
 * uncertain attempt is also saved in sessionStorage under {tenant, person, kind, targets} + the
 * intent's fingerprint, so the identical intent after a reload or a Cancel (`reset()` clears memory
 * only) restores the same key and the server replays it. A restored key is sticky in the keeper but
 * does not lock by itself: `locked` derives from this mount's attempts only. No intent (the preview)
 * or no person (no SessionProvider): memory only, as before.
 *
 * `onAbandon` (the caller's refetch) covers an unmount while an attempt may have committed, e.g.
 * the host switched tabs: the lock dies with the component, so the screen refetches instead and
 * shows whether the command landed. It runs at the unmount, or, for an attempt still in flight
 * then, once that attempt settles uncertain.
 */
export function useRosterCommand(onAbandon?: () => void) {
  const id = useCommandId(store);
  const personId = useSessionPersonId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [locked, setLocked] = useState(false);
  // `run` is created once, so it reads the sticky flag and the person from refs; `locked` re-renders the inputs.
  const uncertain = useRef(false);
  const inFlight = useRef(false);
  const gone = useRef(false);
  const abandon = useRef(onAbandon);
  const person = useRef(personId);
  useEffect(() => {
    abandon.current = onAbandon;
    person.current = personId;
  });
  useEffect(() => {
    gone.current = false; // a StrictMode remount
    return () => {
      gone.current = true;
      if (uncertain.current && !inFlight.current) abandon.current?.();
    };
  }, []);

  const run = useCallback(
    async <T>(
      call: (commandId: string) => Promise<T>,
      intent?: RosterCommandIntent,
    ): Promise<T | undefined> => {
      const personNow = person.current;
      const scope =
        intent && personNow
          ? {
              tenantId: intent.tenantId,
              personId: personNow,
              kind: intent.kind,
              targets: intent.targets,
            }
          : undefined;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const result = await call(id.get(intent?.fingerprint, scope));
        id.settle();
        uncertain.current = false;
        setLocked(false);
        return result;
      } catch (e) {
        id.settle(e); // every failure, the uncertain ones too: the keeper saves or drops the record
        if (!isDefiniteFailure(e)) uncertain.current = true;
        else if (isCommandIdConflict(e)) uncertain.current = false; // the keeper dropped the key
        setLocked(uncertain.current);
        setError(e);
        return undefined;
      } finally {
        inFlight.current = false;
        setBusy(false);
        if (gone.current && uncertain.current) abandon.current?.(); // settled after the unmount
      }
    },
    // the `id` methods only close over a ref, so the first render's copy is always current
    [],
  );
  /** A new intent (dialog reopened for someone else, or the host cancelled and refetched). */
  const reset = useCallback(() => {
    id.reset(); // memory only: a persisted uncertain key survives the Cancel
    uncertain.current = false;
    setLocked(false);
    setError(null);
  }, []);
  return { busy, error, locked, run, reset };
}
