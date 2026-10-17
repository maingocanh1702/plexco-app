import { approveJoinRequest } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/join-requests/:id/approve -- a HOST approves a pending join request (L8, M9; readiness
 * 4.5, P-10, P-14, DT-8). Body: `commandId`; no other key is read.
 *
 * Host gate only: session.manage in `?tenant=` at the entry gate, no association option, so a
 * plain member gets the one FORBIDDEN 403 (A-10). The actor is the session cookie's person and the
 * tenant is `?tenant=`, never a body value (HARD RULES 1, 4). The service re-derives under the
 * session row lock (free seat -> active + one charge, full -> waitlisted) and owns
 * REQUEST_DECIDED / REQUEST_EXPIRED / JOIN_REQUEST_NOT_FOUND / TENANT_SUSPENDED (P-14).
 *
 * Quota (P-13): `join-request-decide` 30/60 s per tenant. DTO built key by key: no amount.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "join-request-decide", limit: 30 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id } = await params;
      const result = await approveJoinRequest(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        requestId: id,
        commandId: context.commandId,
      });
      return ok({
        request: {
          id: result.requestId,
          status: result.status,
          outcome: result.outcome,
          playerId: result.playerId,
          waitlistPosition: result.waitlistPosition,
        },
        replayed: result.replayed,
      });
    },
  );
}
