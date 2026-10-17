import { cancelJoinRequest } from "@plexco/db";
import { ok } from "../../../../lib/api-envelope";
import {
  handleSessionCommand,
  JOIN_REQUEST_CANCEL_PERSON_LIMIT,
} from "../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../lib/session-cookies";

/**
 * DELETE /api/join-requests/:id -- the REQUESTER cancels their own pending join request (L8, M9;
 * readiness 4.5, P-10, P-11). Body: `commandId`; no other key is read.
 *
 * Neither identity nor tenant is client-supplied (HARD RULES 1, 4): the tenant is `?tenant=` as the
 * entry gate resolved it (selfService, P-3: a live member of that club, anyone else the one
 * FORBIDDEN 403) and the person is the session cookie's. Ownership is the service's: an unknown,
 * foreign or not-own request id is the one JOIN_REQUEST_NOT_FOUND 404 (P-11), a decided one
 * REQUEST_DECIDED 409, an expired one REQUEST_EXPIRED 409.
 *
 * Quotas (P-13): the player routes' tenant bucket `session-self-service` 60/60 s and the per-person
 * `join-request-cancel` 20/3600 s.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-self-service", limit: 60 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id } = await params;
      const result = await cancelJoinRequest(appDb().db, {
        tenantId: context.tenantId,
        personId: session.personId,
        requestId: id,
        commandId: context.commandId,
      });
      return ok({
        request: { id: result.requestId, status: result.status },
        replayed: result.replayed,
      });
    },
    { selfService: true, personLimit: JOIN_REQUEST_CANCEL_PERSON_LIMIT },
  );
}
