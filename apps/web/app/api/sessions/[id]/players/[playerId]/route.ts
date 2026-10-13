import { removePlayerFromSession } from "@plexco/db";
import { ok } from "../../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../../lib/session-cookies";

/**
 * DELETE /api/sessions/:id/players/:playerId -- the host removes an UNPAID player. Carries a body
 * (`commandId`) like the guest-note DELETE, so a retry replays instead of answering "not found" for a
 * removal it already did. A player with any effective payment is refused (REMOVE_REQUIRES_REVIEW):
 * reverse the payment first. Both path ids are forwarded unvalidated (the command fails them closed).
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; playerId: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-roster-remove", limit: 30 },
    async (context) => {
      const session = await currentSession();
      if (!session) throw new Error("session vanished between the entry gate and the command");
      const { id, playerId } = await params;
      const result = await removePlayerFromSession(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId: session.personId,
        commandId: context.commandId,
        sessionId: id,
        playerId,
      });
      return ok({ player: { id: result.playerId, status: "left" }, replayed: result.replayed });
    },
  );
}
