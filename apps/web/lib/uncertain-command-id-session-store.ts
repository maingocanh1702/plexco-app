/**
 * Per-tab memory of command ids whose outcome is UNCERTAIN (L49 D1/D2), so an identical retry after a
 * reload or a dialog Cancel goes out under the SAME commandId and the server replays it instead of
 * applying it twice (DD-117 D5). sessionStorage: a fresh tab starts empty, a duplicated tab starts with
 * a copy (both re-send one id; the server applies once).
 *
 * Key = `plx-cmd:v1:` + tenantId:personId:kind:targets:hash(fingerprint), so another tenant or another
 * person signed in on the same tab never restores a record. It holds only opaque ids and the hash; the
 * value is exactly `{"id","at"}`: no body field, no fingerprint text. A record lives 24 h (server
 * retention is indefinite, so a long life is the fail-closed side), at most 50 live under the prefix.
 *
 * Storage is resolved per call (null on the server, in a locked-down browser, or when the getter
 * throws) and every access is guarded: a missing, full or throwing storage degrades to today's
 * in-memory behaviour and never blocks the command.
 */
export type CommandIdScope = {
  tenantId: string;
  personId: string;
  kind: string;
  targets: readonly string[];
};

export type UncertainCommandIdStore = {
  find(scope: CommandIdScope, fingerprint: string): string | null;
  save(scope: CommandIdScope, fingerprint: string, id: string): void;
  drop(scope: CommandIdScope, fingerprint: string): void;
};

const PREFIX = "plx-cmd:v1:";
const TTL_MS = 86_400_000;
const CAP = 50;

const defaultStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

// ponytail: cyrb53, a sync 53-bit non-cryptographic hash: equality only, not collision-resistant
// against a crafted input (a page-level attacker is outside the threat model). Upgrade = SHA-256 via
// crypto.subtle (async) if that changes.
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const keyOf = (scope: CommandIdScope, fingerprint: string): string =>
  PREFIX +
  [scope.tenantId, scope.personId, scope.kind, scope.targets.join(","), hash53(fingerprint)].join(
    ":",
  );

/** The stored record when it is well formed and still live at `now` (not expired, not from the future). */
function liveRecord(raw: string | null, now: number): { id: string; at: number } | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { id, at } = value as { id?: unknown; at?: unknown };
    if (typeof id !== "string" || id === "" || typeof at !== "number" || !Number.isFinite(at)) {
      return null;
    }
    return now - at > TTL_MS || at > now ? null : { id, at };
  } catch {
    return null;
  }
}

export function createUncertainCommandIdSessionStore(
  options: { storage?: Storage | null; now?: () => number } = {},
): UncertainCommandIdStore {
  const storage = (): Storage | null =>
    options.storage === undefined ? defaultStorage() : options.storage;
  const now = options.now ?? (() => Date.now());

  return {
    find: (scope, fingerprint) => {
      try {
        const s = storage();
        if (!s) return null;
        const key = keyOf(scope, fingerprint);
        const raw = s.getItem(key);
        if (raw === null) return null;
        const record = liveRecord(raw, now());
        if (record) return record.id;
        s.removeItem(key); // malformed, expired or from the future
      } catch {
        // unavailable: behave as "no record"
      }
      return null;
    },
    save: (scope, fingerprint, id) => {
      try {
        const s = storage();
        if (!s) return;
        const key = keyOf(scope, fingerprint);
        const t = now();
        const live: { key: string; at: number }[] = [];
        const doomed: string[] = [];
        for (let i = 0; i < s.length; i += 1) {
          const k = s.key(i);
          if (k === null || !k.startsWith(PREFIX) || k === key) continue; // own key: overwritten below
          const record = liveRecord(s.getItem(k), t);
          if (record) live.push({ key: k, at: record.at });
          else doomed.push(k);
        }
        doomed.forEach((k) => s.removeItem(k));
        // Oldest first, until the new record fits under the cap.
        live.sort((a, b) => a.at - b.at);
        live.slice(0, Math.max(0, live.length - CAP + 1)).forEach((r) => s.removeItem(r.key));
        s.setItem(key, JSON.stringify({ id, at: t }));
      } catch {
        // quota / unavailable: the in-memory keeper still holds the id for this mount
      }
    },
    drop: (scope, fingerprint) => {
      try {
        storage()?.removeItem(keyOf(scope, fingerprint));
      } catch {
        // unavailable
      }
    },
  };
}
