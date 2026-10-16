import { and, eq } from "drizzle-orm";
import { outboxEvents } from "../schema.js";
import type { Tx } from "./client.js";

/**
 * Web live sync (lane L5, readiness R-1): event id -> {type, sessionId, version}, the read the web
 * realtime listener re-authorizes every NOTIFY with. The tenant filter is RLS itself (0009
 * tenant_isolation) under the caller's `withTenant`; only these three fields ever leave, never the
 * payload. `version` is the per-session event sequence (R-5).
 */
export interface SessionRealtimeEvent {
  type: string;
  sessionId: string;
  version: number;
}

const EVENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readSessionRealtimeEvent(
  tx: Tx,
  eventId: string,
): Promise<SessionRealtimeEvent | null> {
  // NOTIFY payloads are untrusted: anything but a lowercase canonical uuid never reaches SQL.
  if (typeof eventId !== "string" || !EVENT_ID_RE.test(eventId)) return null;
  const [row] = await tx
    .select({
      type: outboxEvents.type,
      sessionId: outboxEvents.aggregateId,
      version: outboxEvents.sequence,
    })
    .from(outboxEvents)
    .where(and(eq(outboxEvents.id, eventId), eq(outboxEvents.aggregateType, "session")))
    .limit(1);
  return row ? { type: row.type, sessionId: row.sessionId, version: row.version } : null;
}
