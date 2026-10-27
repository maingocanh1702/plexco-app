"use client";

import { useState } from "react";
import { ApiClientError } from "./api-client";
import { isDefiniteFailure } from "./session-error-ui";
import type { CommandIdScope, UncertainCommandIdStore } from "./uncertain-command-id-session-store";

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
 * failure sees the plain rule.
 *
 * The one 4xx that DOES prove something is COMMAND_ID_CONFLICT (409): the server holds this key for
 * another command (type, session, actor or target), so this intent was never stored under it and every
 * retry under it would conflict again. It drops the key even when sticky (L49 row 4: a new key, no loop).
 *
 * Persistence (L49 D3, optional): with a `store` AND a `scope` (tenant, person, command kind, targets)
 * AND a payload, an uncertain failure also saves `{key}` for that scope + payload, and a `get` that would
 * mint first restores a saved key, sticky, so the identical intent after a reload or a dialog Cancel
 * replays instead of applying twice. A 2xx or COMMAND_ID_CONFLICT drops the record with the key; another
 * definite failure keeps it when sticky and has none to drop otherwise. `reset()` clears memory ONLY and
 * never removes a record: that is how an uncertain attempt survives a dialog Cancel. No store or no scope
 * or no payload: memory only, exactly the rule above.
 *
 * A caller whose body carries a secret (the Zalo bot token) must not use the body as the fingerprint:
 * it calls `get()` with no payload and `reset()` on every edit instead, which is equivalent.
 */
export interface CommandIdKeeper {
  get(payload?: string, scope?: CommandIdScope): string;
  settle(error?: unknown): void;
  reset(): void;
}

/** The server's proof that a key belongs to another command: drop it, never retry under it. */
export function isCommandIdConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "COMMAND_ID_CONFLICT";
}

const sameScope = (a: CommandIdScope | undefined, b: CommandIdScope | undefined): boolean =>
  a === b ||
  (a !== undefined &&
    b !== undefined &&
    a.tenantId === b.tenantId &&
    a.personId === b.personId &&
    a.kind === b.kind &&
    a.targets.length === b.targets.length &&
    a.targets.every((target, i) => target === b.targets[i]));

export function createCommandIdKeeper(
  mint: () => string = () => crypto.randomUUID(),
  store?: UncertainCommandIdStore,
): CommandIdKeeper {
  type Entry = {
    id: string;
    payload: string | undefined;
    scope: CommandIdScope | undefined;
    uncertain: boolean;
  };
  let current: Entry | null = null;
  /** The store, but only for an entry it may persist: one with a scope and a payload. */
  const persisted = (entry: Entry) =>
    store && entry.scope && entry.payload !== undefined
      ? { store, scope: entry.scope, payload: entry.payload }
      : null;
  return {
    get: (payload, scope) => {
      if (current !== null && current.payload === payload && sameScope(current.scope, scope)) {
        return current.id;
      }
      const restored = store && scope && payload !== undefined ? store.find(scope, payload) : null;
      current =
        restored !== null
          ? { id: restored, payload, scope, uncertain: true } // it may have committed: sticky
          : { id: mint(), payload, scope, uncertain: false };
      return current.id;
    },
    settle: (error) => {
      if (current === null) return; // reset() while the attempt was in flight: a new command anyway
      const p = persisted(current);
      if (error === undefined) {
        p?.store.drop(p.scope, p.payload);
        current = null;
      } else if (!isDefiniteFailure(error)) {
        current.uncertain = true;
        p?.store.save(p.scope, p.payload, current.id);
      } else if (isCommandIdConflict(error)) {
        p?.store.drop(p.scope, p.payload);
        current = null; // even when sticky
      } else if (!current.uncertain) {
        current = null; // definite, and no attempt under it was uncertain (so nothing was saved)
      }
    },
    reset: () => {
      current = null; // memory only: a saved record outlives it
    },
  };
}

/**
 * The same keeper object for the component's whole life, so a callback created once stays current.
 * `store` is read once, at the first render.
 */
export function useCommandId(store?: UncertainCommandIdStore): CommandIdKeeper {
  const [keeper] = useState(() => createCommandIdKeeper(undefined, store));
  return keeper;
}
