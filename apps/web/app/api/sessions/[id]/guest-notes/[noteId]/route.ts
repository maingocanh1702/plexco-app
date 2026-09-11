import { deleteGuestNote } from "@plexco/db";
import { ok } from "../../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../../lib/session-cookies";
import { withGuestNoteErrors } from "../../../../../../lib/session-guest-note-route";

/**
 * DELETE /api/sessions/:id/guest-notes/:noteId — the AUTHOR withdraws their own guest note
 * (BE tech spec §4 "Guest Note management", SES-UC-17).
 *
 * It carries a body (`commandId`), which is why it goes through the same choke-point as the
 * POST siblings: the command is recorded in `processed_commands` like every other member of this
 * family, so a retried delete replays instead of answering "not found" for a note it removed
 * itself.
 *
 * Ownership is NOT decided here. NOT_NOTE_CREATOR (403) and GUEST_NOTE_NOT_FOUND (404) are the
 * command's own codes, raised under the session lock where the note row can actually be read —
 * a route-level check would be a second reading of the same predicate and would drift (DD-56).
 *
 * Both path ids are passed through unvalidated for the same reason as the POST route: the command
 * fails a malformed id closed with the spec's code before it can reach SQL.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-guest-note-delete", limit: 10 },
    async (context) =>
      withGuestNoteErrors(async () => {
        // The actor, from the session cookie — this is the identity the ownership check compares
        // against created_by_person_id, so it can never come from the body.
        const session = await currentSession();
        if (!session) {
          throw new Error("session vanished between the entry gate and the command");
        }

        const { id, noteId } = await params;
        const result = await deleteGuestNote(appDb().db, {
          tenantId: context.tenantId,
          commandId: context.commandId,
          actorPersonId: session.personId,
          input: { sessionId: id, noteId },
        });
        // `deleted: true` is unconditional, and that is the idempotent contract: a replay reports
        // the same thing the original did, because the note is gone either way.
        return ok({
          guestNote: { id: result.noteId, sessionId: result.sessionId, deleted: true },
        });
      }),
  );
}
