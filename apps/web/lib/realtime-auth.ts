import { readSessionRealtimeEvent, resolveWebSession, withTenant } from "@plexco/db";
import { cookies } from "next/headers";
import { mayManageSessions } from "./session-command-route";
import { appDb, hashToken, SESSION_COOKIE } from "./session-cookies";

/**
 * Re-authorization for the web live-sync stream (lane L5, readiness R-4, R-5, R-8, R-10). A NOTIFY
 * carries a bare event id and any role may NOTIFY on the channel, so an id is untrusted until it is
 * read back under the subscriber's own tenant (RLS) and session.manage still holds there NOW; only
 * {type, sessionId, version} ever leaves. Threat model: defends against a tenant B subscriber
 * learning anything about tenant A, access that ended after subscribing, and forged NOTIFYs; not
 * against a compromised cookie (same as the read gate). The capability check is point-in-time per
 * event, exactly like GET /api/sessions.
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
 * Who receives `eventId`: one RLS read per distinct subscribed tenant until one returns the row (an
 * event has exactly one tenant, R-4), then session.manage once per person there (R-8). A failed
 * capability read denies (fail closed); a failed event read propagates and the caller drops it.
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
    const { type, sessionId, version } = event;
    const frame: RealtimeFrame = { type, sessionId, version };
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
 * Resolving touches last_seen_at (throttled), so an open live tab counts as activity. Errors deny.
 */
export async function recheckSubscriber(audience: RealtimeAudience): Promise<boolean> {
  try {
    const session = await resolveWebSession(appDb().pool, audience.tokenHash);
    if (session?.accountId !== audience.accountId || session.personId !== audience.personId)
      return false;
    return await mayManageSessions(audience.tenantId, audience.personId);
  } catch {
    return false;
  }
}
