import { announceSession, type AnnounceSessionInputPayload } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../lib/session-command-route";
import { appDb } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/announce — asks for the one host DM announcing an open session (BE tech
 * spec §3; DD-134 (f), local-only MVP). Its only observable effect is delivery, so the success
 * body is sent ONLY after announceSession returned: the command checks DB truth (a fresh worker
 * heartbeat with the dispatch schedule live, and zalo_dm enabled) inside its own transaction and
 * otherwise refuses with ANNOUNCE_DELIVERY_DISABLED (409), writing nothing. No process env is
 * read for that decision anywhere (A-D2).
 *
 * The requester is the verified cookie session's person, never the body (A-D5). `id` and
 * `channel` pass through unvalidated: the command fails a non-UUID id closed as SESSION_NOT_FOUND
 * and every channel except "zalo" as INVALID_CHANNEL (A-D4); re-checking here would only
 * duplicate those rules. Bucket "session-announce", 10/min per tenant, the publish precedent:
 * the spec's Rate Limits table has no announce row (A-D7).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-announce", limit: 10 },
    async (context) => {
      const { id } = await params;
      const result = await announceSession(appDb().db, {
        tenantId: context.tenantId,
        commandId: context.commandId,
        requestedByPersonId: context.personId,
        input: {
          sessionId: id,
          channel: context.body.channel as AnnounceSessionInputPayload["channel"],
        },
      });
      // Exactly {announced, channel} for a first write and a replay alike: no `replayed` key (A-D6).
      return ok({ announced: true, channel: result.channel });
    },
  );
}
