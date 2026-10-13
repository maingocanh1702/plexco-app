import { addMemberToSession, RosterMoneyError, type AddMemberParams } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand, present } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/players -- the HOST adds a player (DD-41 canonical join choke-point,
 * source `host_add`). Body: `commandId` plus EXACTLY ONE of `membershipId` (existing member,
 * DD-85: the picker submits the id, a name is never resolved to a member) or `displayName` (a NEW
 * member, pay_code stays NULL).
 *
 * Thin by design: the actor is read from the session cookie (never the body), everything else is
 * forwarded UNVALIDATED -- dedup precedes validation inside the command (DD-117 D5), so a retry of
 * an already-committed add replays instead of 400ing. The role gate (session.manage) ran in the
 * shared entry gate; the command re-checks it under lock.
 *
 * Money in the DTO: only the charge id -- amounts live on the authenticated host detail read.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-roster-add", limit: 30 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id } = await params;
      // A present-but-non-string membershipId (e.g. null) is a malformed body, not a missing member.
      if (present(context.body, "membershipId") && typeof context.body.membershipId !== "string") {
        throw new RosterMoneyError("INVALID_INPUT", "membershipId must be a string");
      }
      // Only the keys the client sent are forwarded; the command rejects "both" and "neither".
      const member = {
        ...(present(context.body, "membershipId")
          ? { membershipId: context.body.membershipId }
          : {}),
        ...(present(context.body, "displayName") ? { displayName: context.body.displayName } : {}),
      } as AddMemberParams["member"];
      const result = await addMemberToSession(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        commandId: context.commandId,
        sessionId: id,
        member,
        source: "host_add",
      });
      return ok({
        player: {
          id: result.playerId,
          membershipId: result.membershipId,
          status: result.status,
          waitlistPosition: result.waitlistPosition,
          chargeId: result.chargeId,
        },
        replayed: result.replayed,
      });
    },
  );
}
