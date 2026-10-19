import {
  getChatMessage,
  hasLiveMembership,
  listChatChannels,
  readSessionRealtimeEvent,
  resolveWebSession,
  withChatActor,
  withTenant,
} from "@plexco/db";
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

/** The chat topic's ONLY wire shape (D-12): ids only; content comes through the authorized GET. */
export interface ChatFrame {
  type: "chat.message";
  channelId: string;
  messageId: string;
}

/** As encodeFrame (R-5): one `data:` line of exactly these three keys; no row field rides along. */
export function encodeChatFrame(frame: ChatFrame): string {
  const { type, channelId, messageId } = frame;
  return `data: ${JSON.stringify({ type, channelId, messageId })}\n\n`;
}

/**
 * Who receives chat message `messageId`: per event, each subscribed person re-reads the untrusted
 * id through chat_get_message under their own tenant, person and RLS. Null or an error: nothing sent.
 */
export async function planChatDelivery<S extends RealtimeAudience>(
  messageId: string,
  groups: ReadonlyMap<string, ReadonlySet<S>>,
): Promise<Array<[S, ChatFrame]>> {
  const snapshot = [...groups].map(([tenantId, subs]) => [tenantId, [...subs]] as const);
  // ponytail: one read per distinct subscribed (tenant, person) per NOTIFY, until the owner's group;
  // upgrade path: a tenant in the NOTIFY payload (an L14 contract change) reads one group only.
  for (const [tenantId, subs] of snapshot) {
    const reads = new Map<string, ReturnType<typeof getChatMessage>>();
    const planned: Array<[S, ChatFrame]> = [];
    for (const sub of subs) {
      let read = reads.get(sub.personId);
      if (!read) {
        read = withChatActor(appDb().db, { tenantId, personId: sub.personId }, (tx) =>
          getChatMessage(tx, { messageId }),
        ).catch(() => null);
        reads.set(sub.personId, read);
      }
      const row = await read;
      if (row)
        planned.push([sub, { type: "chat.message", channelId: row.channelId, messageId: row.id }]);
    }
    // chat_get_message filters ch.tenant_id = app.tenant_id (0063:616): no other tenant gets a row.
    if (planned.length > 0) return planned;
  }
  return [];
}

/**
 * Chat heartbeat re-check (D-3: admission minus the buckets and the cap): the same live session,
 * account and person, a live membership (D-19), then a readable club channel now. Errors deny.
 */
export async function recheckChatSubscriber(a: RealtimeAudience): Promise<boolean> {
  try {
    const { tenantId, personId } = a;
    const session = await resolveWebSession(appDb().pool, a.tokenHash);
    if (session?.accountId !== a.accountId || session.personId !== personId) return false;
    const member = await withTenant(appDb().db, tenantId, (tx) =>
      hasLiveMembership(tx, tenantId, personId),
    );
    if (!member) return false;
    await withChatActor(appDb().db, { tenantId, personId }, listChatChannels);
    return true;
  } catch {
    return false;
  }
}
