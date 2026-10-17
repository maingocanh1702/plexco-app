import { rejectJoinRequest } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/join-requests/:id/reject -- a HOST rejects a pending join request (L8, M9; readiness
 * 4.5, P-10, P-14, DT-8). Body: `commandId`; no other key is read.
 *
 * Same gate as approve: session.manage in `?tenant=` (a plain member gets the one FORBIDDEN 403),
 * actor from the session cookie, tenant from `?tenant=` (HARD RULES 1, 4). The service owns
 * REQUEST_DECIDED / REQUEST_EXPIRED / JOIN_REQUEST_NOT_FOUND / TENANT_SUSPENDED. No roster or money
 * write: the request only becomes 'rejected'.
 *
 * Quota (P-13): `join-request-decide` 30/60 s per tenant.
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
      const result = await rejectJoinRequest(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        requestId: id,
        commandId: context.commandId,
      });
      return ok({
        request: { id: result.requestId, status: result.status },
        replayed: result.replayed,
      });
    },
  );
}
