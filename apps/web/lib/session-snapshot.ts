import type { SessionListItemDto } from "./sessions-api";

/**
 * Offline fallback for the session LIST only: the last first page the host already saw, kept in
 * localStorage so a refresh while offline is not a blank screen. Holds exactly the list DTO
 * (sport, time, venue, price, slot cap, status) -- no roster, no charges, no player names. Wiped on
 * sign-out and whenever the API answers AUTH_REQUIRED. Storage failures (private mode, quota) are
 * swallowed: the snapshot is a convenience, never a dependency.
 */
const PREFIX = "plx-snap:sessions:";

export interface SessionSnapshot {
  savedAt: number;
  sessions: SessionListItemDto[];
}

const defaultStorage = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const key = (tenantId: string, tab: string) => `${PREFIX}${tenantId}:${tab}`;

export function saveSnapshot(
  tenantId: string,
  tab: string,
  sessions: SessionListItemDto[],
  storage: Storage | null = defaultStorage(),
): void {
  try {
    const value: SessionSnapshot = { savedAt: Date.now(), sessions };
    storage?.setItem(key(tenantId, tab), JSON.stringify(value));
  } catch {
    // quota / unavailable
  }
}

export function loadSnapshot(
  tenantId: string,
  tab: string,
  storage: Storage | null = defaultStorage(),
): SessionSnapshot | null {
  try {
    const raw = storage?.getItem(key(tenantId, tab));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SessionSnapshot;
    return typeof parsed.savedAt === "number" && Array.isArray(parsed.sessions) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSessionSnapshots(storage: Storage | null = defaultStorage()): void {
  try {
    if (!storage) return;
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i);
      if (k?.startsWith(PREFIX)) doomed.push(k);
    }
    doomed.forEach((k) => storage.removeItem(k));
  } catch {
    // ignore
  }
}
