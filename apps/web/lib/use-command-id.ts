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
 * Persistence (L49 D3, optional): with a `store` AND a `scope` (tenant, person, command kind, targets)
 * AND a payload, a `get` that would mint first restores a saved key, sticky, and otherwise saves the
 * minted `{key}` for that scope + payload, i.e. BEFORE the request is sent (an uncertain failure saves
 * it again). A reload while the request is in flight, a reload after an uncertain failure and a dialog
 * Cancel thus all restore the same key, so the identical intent replays instead of applying twice. A
 * 2xx drops the record, and so does a definite failure of a fresh key (its only attempt was refused:
 * nothing is stored under it). COMMAND_ID_CONFLICT drops the record but, like any definite failure,
 * keeps a sticky key: the server also answers it for THIS intent when its stored result is unusable
 * (`replayOrNull`), so a new key now could apply twice; after a reload, which refetches, the next
 * attempt is a new command (no 24 h conflict loop). Another definite failure keeps a sticky key's
 * record. `reset()` clears memory ONLY. No store or no scope or no payload: memory only, as above.
 * Accepted edge: a Cancel (`reset()`) in flight, then a late 2xx, leaves the record (that settle is a
 * no-op), so the next identical intent within the TTL replays once (the replayed notice), then mints:
 * never a double apply, never a silent loss.
 *
 * A caller whose body carries a secret (the Zalo bot token) must not use the body as the fingerprint:
 * it calls `get()` with no payload and `reset()` on every edit instead, which is equivalent.
 */
export interface CommandIdKeeper {
  get(payload?: string, scope?: CommandIdScope): string;
  settle(error?: unknown): void;
  reset(): void;
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
      const p = restored === null ? persisted(current) : null; // a restored key has its record
      p?.store.save(p.scope, p.payload, current.id); // minted: saved BEFORE the request is sent
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
      } else {
        // The record goes on COMMAND_ID_CONFLICT (a sticky key stays, see above) and for a fresh
        // entry: it was saved before the send, and a definite refusal of the only attempt proves no
        // result is stored under this id.
        const conflict = error instanceof ApiClientError && error.code === "COMMAND_ID_CONFLICT";
        if (conflict || !current.uncertain) p?.store.drop(p.scope, p.payload);
        if (!current.uncertain) current = null; // definite, and no attempt under it was uncertain
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
