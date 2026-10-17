import type { PendingJoinRequestDto } from "@plexco/core";
import { listPendingJoinRequests } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { mapSessionCommandError } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";
import { handleSessionRead } from "../../../../../lib/session-read-route";

/**
 * GET /api/sessions/:id/join-requests -- the HOST reads a session's pending join requests (L8, M9;
 * readiness 4.5, P-12, A-10).
 *
 * The read gate requires session.manage in `?tenant=` (the one FORBIDDEN 403 for a plain member,
 * a foreign tenant or no capability) and runs this handler inside runWithLang; the actor is the
 * session cookie's person, never a query value (HARD RULES 1, 4). Quota: the host session read's
 * `session-read` 60/60 s per tenant (P-13 pins none for this read).
 *
 * DTO (PendingJoinRequestDto): requestId, displayName and createdAt ONLY, built key by key, so
 * money or contact data can never ride along even if the service row grows. A domain error from
 * the service (its own session.manage re-check, an unknown session) maps through the command
 * route's table here, inside the language context, instead of surfacing as a 500.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionRead(request, { bucket: "session-read", limit: 60 }, async (context) => {
    const session = await currentSession();
    if (!session) throw new Error("session vanished between the read gate and the query");
    const { id } = await params;
    try {
      const rows = await listPendingJoinRequests(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        sessionId: id,
      });
      const requests = rows.map((row): PendingJoinRequestDto => ({
        requestId: row.requestId,
        displayName: row.displayName,
        createdAt: row.createdAt,
      }));
      return ok({ requests });
    } catch (error) {
      const mapped = mapSessionCommandError(error);
      if (mapped) return mapped;
      throw error;
    }
  });
}
