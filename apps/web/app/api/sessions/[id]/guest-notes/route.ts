import { createGuestNote } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand, present } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";
import { withGuestNoteErrors } from "../../../../../lib/session-guest-note-route";

/**
 * POST /api/sessions/:id/guest-notes — an active player records a non-member guest
 * (BE tech spec §4 "Guest Note management", SES-UC-17). Body: `commandId`, `guestName`,
 * optional `note`.
 *
 * There is deliberately NO GET on this path in this slice. A list endpoint is body-less, and the
 * shared choke-point resolves its tenant and language from a command envelope it would not have;
 * giving it one is its own slice (PLAN.md Milestone 2 / Deferred D5), not a side effect of this
 * one.
 *
 * BE spec §3 Rate Limits (feature_session_management_tech.md:600) pins this row to 10/min
 * **per user per session** — NOT per tenant. The choke-point (session-command-route.ts:265)
 * appends only `:tenantId` to whatever bucket string it is given, so the actor and target session
 * are folded into the bucket string HERE, before handleSessionCommand runs, which is the only
 * point this route can reach `currentSession()` before the rate-limit check fires inside the
 * choke-point. Without this, every player in a tenant shares one counter and one abusive/buggy
 * actor can 429 every peer (codex review finding — session-command-route.ts is out of scope for
 * this slice, so the fix lives entirely in the bucket string this route constructs).
 *
 * `id` is passed through unvalidated on purpose: createGuestNote fails a non-UUID closed as
 * SESSION_NOT_FOUND before any cast could raise a raw 22P02, so re-checking here would only
 * duplicate the rule and risk drifting from it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  // Read BEFORE the choke-point runs, solely to scope the rate-limit bucket per (actor, session)
  // — see the docstring above. A null actor (no/invalid cookie) still reaches
  // resolveSessionCommandContext's OWN currentSession() check immediately after and gets
  // AUTH_REQUIRED before this bucket is ever consumed, so the placeholder below is never live.
  const bucketActor = (await currentSession())?.personId ?? "unauthenticated";
  const { id } = await params;
  return handleSessionCommand(
    request,
    { bucket: `session-guest-note-create:${bucketActor}:${id}`, limit: 10 },
    async (context) =>
      withGuestNoteErrors(async () => {
        // The AUTHOR, read from the session cookie exactly where the choke-point itself reads it.
        // It is never taken from the body: created_by_person_id is what the delete path's
        // ownership check trusts, so a body-supplied author would let a caller write a note in
        // someone else's name. `resolveSessionCommandContext` has already proven a session exists
        // by the time this handler runs.
        const session = await currentSession();
        if (!session) {
          throw new Error("session vanished between the entry gate and the command");
        }

        // Forwarded UNVALIDATED, both of them: dedup precedes validation inside the command
        // (DD-117 D5), so a retry of an already-committed note must replay rather than 400. An
        // ABSENT note is left absent — the command fills the spec's default only in that case,
        // and an explicit null must survive as a real null.
        const result = await createGuestNote(appDb().db, {
          tenantId: context.tenantId,
          commandId: context.commandId,
          actorPersonId: session.personId,
          input: {
            sessionId: id,
            guestName: context.body.guestName as string,
            ...(present(context.body, "note") ? { note: context.body.note as string | null } : {}),
          },
        });
        // Ids plus remainingNotes — the DTO never echoes guestName/note, because a REPLAY cannot
        // produce them (the idempotency ledger stores no request content, DD-117 D5) and one
        // command must not have two response shapes. remainingNotes CAN be replayed (it is stored
        // in the ledger for exactly that reason), and BE unit row #78 makes it part of this
        // command's result: the author needs to know how many of their three notes are left
        // without issuing a second request to find out.
        return ok({
          guestNote: {
            id: result.noteId,
            sessionId: result.sessionId,
            remainingNotes: result.remainingNotes,
          },
        });
      }),
  );
}
