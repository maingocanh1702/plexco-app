import { t } from "@plexco/core/i18n";
import { deleteGuestNote } from "@plexco/db";
import { err, ok } from "../../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../../lib/session-command-route";
import { appDb, currentSession, rateLimited } from "../../../../../../lib/session-cookies";
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
 * BE spec §3 Rate Limits (feature_session_management_tech.md:601) pins this row to 10/min
 * **per user** — NOT per tenant, and (unlike the POST sibling's explicit "per user per session")
 * with no narrower qualifier at all. That absence is deliberate, not an omission: it is the
 * WIDEST scope in the table's own vocabulary (session < tenant < global), so an actor who belongs
 * to several tenants must share ONE delete quota across all of them, not get a fresh one per
 * tenant. The choke-point (session-command-route.ts:265, out of scope) cannot express this by
 * itself — it always appends `:tenantId` to whatever bucket string it is given, which is
 * STRUCTURALLY per-tenant. This route therefore layers a second, genuinely global check directly
 * on `rateLimited()` (the same underlying utility the choke-point itself calls, independently
 * exported from session-cookies.ts) INSIDE the handler, after handleSessionCommand has already
 * resolved tenant/lang and is running inside runWithLang — so `t()` below resolves correctly, and
 * a 429 from either layer still answers in the tenant's language. The per-tenant choke-point check
 * still runs first (unchanged) and may consume its own bucket even when this global layer then
 * rejects; that ordering imperfection already exists between the choke-point's own per-tenant and
 * per-actor-ceiling checks (session-command-route.ts:220-227), so this does not introduce a new
 * inconsistency.
 *
 * Both path ids are passed through unvalidated for the same reason as the POST route: the command
 * fails a malformed id closed with the spec's code before it can reach SQL.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; noteId: string }> },
): Promise<Response> {
  // Read BEFORE the choke-point runs, solely to scope the (per-tenant) rate-limit bucket per
  // actor — see the docstring above. A null actor still reaches resolveSessionCommandContext's
  // OWN currentSession() check immediately after and gets AUTH_REQUIRED before this bucket is
  // ever consumed, so the placeholder below is never live.
  const bucketActor = (await currentSession())?.personId ?? "unauthenticated";
  const { id, noteId } = await params;
  return handleSessionCommand(
    request,
    { bucket: `session-guest-note-delete:${bucketActor}`, limit: 10 },
    async (context) =>
      withGuestNoteErrors(async () => {
        // The actor, from the session cookie — this is the identity the ownership check compares
        // against created_by_person_id, so it can never come from the body.
        const session = await currentSession();
        if (!session) {
          throw new Error("session vanished between the entry gate and the command");
        }

        // The GLOBAL per-actor layer — see the docstring above. A distinct bucket prefix from the
        // per-tenant one above, so the two counters never collide.
        if (await rateLimited(`session-guest-note-delete-global:${session.personId}`, 10, 60)) {
          return err(
            "RATE_LIMITED",
            t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."),
            429,
          );
        }

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
    { guestNoteSessionId: id },
  );
}
