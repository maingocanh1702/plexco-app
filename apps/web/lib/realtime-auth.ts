import { readSessionRealtimeEvent, resolveWebSession, withTenant } from "@plexco/db";
import { cookies } from "next/headers";
import { mayManageSessions } from "./session-command-route";
import { appDb, hashToken, SESSION_COOKIE } from "./session-cookies";

/**
 * Re-authorization for the web live-sync stream (lane L5, readiness R-4, R-5, R-8, R-10).
 *
 * A NOTIFY carries an event id and nothing else, and any database role can NOTIFY on the channel,
 * so an id is untrusted until it has been read back under a subscriber's own tenant (RLS) and the
 * subscriber still holds session.manage there NOW. Only {type, sessionId, version} ever leaves.
 *
 * Threat model: defends against a subscriber of tenant B learning anything about tenant A, against
 * a subscriber whose access ended after subscribing, and against a forged NOTIFY. It does not
 * defend against a compromised cookie (same as the read gate) and the capability check is
 * point-in-time per event, exactly like GET /api/sessions.
 */
export interface RealtimeFrame {
  type: string;
  sessionId: string;
  version: number;
}

export interface RealtimePrincipal {
  accountId: string;
  personId: string;
  /** sha256 of the session cookie, captured at subscribe time for the heartbeat re-check. */
  tokenHash: string;
}

export interface RealtimeAudience extends RealtimePrincipal {
  tenantId: string;
}

/** The principal behind this request's session cookie, or null (no cookie, expired, revoked). */
export async function resolveRealtimePrincipal(): Promise<RealtimePrincipal | null> {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const tokenHash = hashToken(raw);
  const session = await resolveWebSession(appDb().pool, tokenHash);
  if (!session) return null;
  return { accountId: session.accountId, personId: session.personId, tokenHash };
}

/** The ONLY wire shape (R-5): one `data:` line of exactly these three keys, then a blank line. */
export function encodeFrame(frame: RealtimeFrame): string {
  const { type, sessionId, version } = frame;
  return `data: ${JSON.stringify({ type, sessionId, version })}\n\n`;
}

/**
 * Who receives event `eventId`. Reads the event once per distinct subscribed tenant, stopping at
 * the first tenant whose RLS read returns the row (an event has exactly one tenant, R-4); then
 * re-checks session.manage once per person of that tenant (R-8). A failed capability read denies
 * that person (fail closed); a failed event read propagates and the caller drops the event.
 */
export async function planEventDelivery<S extends RealtimeAudience>(
  eventId: string,
  groups: ReadonlyMap<string, ReadonlySet<S>>,
): Promise<Array<[S, RealtimeFrame]>> {
  // Snapshot first: subscribers may come and go while the reads await.
  const snapshot = [...groups].map(([tenantId, subs]) => [tenantId, [...subs]] as const);
  for (const [tenantId, subs] of snapshot) {
    if (subs.length === 0) continue;
    const event = await withTenant(appDb().db, tenantId, (tx) =>
      readSessionRealtimeEvent(tx, eventId),
    );
    if (!event) continue;
    const frame: RealtimeFrame = {
      type: event.type,
      sessionId: event.sessionId,
      version: event.version,
    };
    const allowed = new Map<string, Promise<boolean>>();
    const planned: Array<[S, RealtimeFrame]> = [];
    for (const sub of subs) {
      let decision = allowed.get(sub.personId);
      if (!decision) {
        decision = mayManageSessions(tenantId, sub.personId).catch(() => false);
        allowed.set(sub.personId, decision);
      }
      if (await decision) planned.push([sub, frame]);
    }
    return planned;
  }
  return [];
}

/**
 * Heartbeat re-check (R-10, R-18): the cookie's session must still resolve (TTL, 14-day idle
 * window, logout, revocation) to the same account and person, and session.manage must still hold.
 * Resolving touches last_seen_at (throttled), so an open live tab counts as activity. Any error
 * is a denial.
 */
export async function recheckSubscriber(audience: RealtimeAudience): Promise<boolean> {
  try {
    const session = await resolveWebSession(appDb().pool, audience.tokenHash);
    if (!session) return false;
    if (session.accountId !== audience.accountId || session.personId !== audience.personId) {
      return false;
    }
    return await mayManageSessions(audience.tenantId, audience.personId);
  } catch {
    return false;
  }
}
