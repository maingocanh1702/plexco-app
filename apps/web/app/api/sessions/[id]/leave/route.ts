import { leaveSession } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import {
  SESSION_LEAVE_PERSON_LIMIT,
  handleSessionCommand,
} from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/leave -- a PLAYER leaves a session of their own club (L8, M9). While the
 * session is open and before its start, with zero net money: left, the charge void and the lowest
 * waitlist position promoted in the same transaction; a waitlisted player just leaves (P-5). Any
 * other case is LEAVE_REQUIRES_HOST 409 with zero writes (P-4: "ask the host"). Body: `commandId`.
 *
 * Tenant from `?tenant=` (selfService gate, P-3), person from the session cookie, never the body
 * (HARD RULES 1, 4). Quotas (P-24, replacing P-13's "no per-person bucket"; default applied,
 * pending owner sign-off): the per-person `session-leave` 20/3600 s first, then the tenant bucket
 * `session-self-service` 60/60 s, as join does. The tenant hit lands at the gate before the
 * command runs, so a replayed or empty leave still spends it: the person bucket keeps one member
 * from filling the club-wide bucket (R1B-1, S1-1).
 */
export async function POST(
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
      const result = await leaveSession(appDb().db, {
        tenantId: context.tenantId,
        personId: session.personId,
        sessionId: id,
        commandId: context.commandId,
      });
      return ok({
        player: { id: result.playerId, status: result.status },
        replayed: result.replayed,
      });
    },
    { selfService: true, personLimit: SESSION_LEAVE_PERSON_LIMIT },
  );
}
