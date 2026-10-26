import { cancelSession } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import {
  handleSessionCommand,
  readExpectedVersion,
} from "../../../../../lib/session-command-route";
import { appDb } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/cancel — draft OR open → cancelled (BE tech spec §3: status-only,
 * `commandId` + `expectedVersion`). Already-cancelled is an idempotent no-op, not an error.
 *
 * Accepting BOTH source statuses is the command's contract (draft discard, spec v2.15), and so is
 * the past-guard that applies to `open` but never to `draft` (edge #31 vs edge #25). None of that
 * is re-stated here: this route resolves the actor and hands over, exactly like its four siblings.
 *
 * The spec's Rate Limits table pins create (10/min) and update (20/min) per tenant but not cancel;
 * this takes the more conservative pinned neighbour rather than inventing a looser one — the same
 * choice the publish route already made and for the same reason.
 *
 * `id` is passed through unvalidated on purpose: cancelSession fails a non-UUID closed as
 * SESSION_NOT_FOUND before any cast could raise a raw 22P02, so re-checking here would only
 * duplicate the rule and risk drifting from it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(request, { bucket: "session-cancel", limit: 10 }, async (context) => {
    // Passed through unvalidated: dedup precedes validation inside the command (DD-117 D5), so a
    // retry of an already-committed cancel must replay rather than 400.
    const expectedVersion = readExpectedVersion(context.body);

    const { id } = await params;
    const result = await cancelSession(appDb().db, {
      tenantId: context.tenantId,
      commandId: context.commandId,
      actorPersonId: context.personId,
      input: { sessionId: id, expectedVersion },
    });
    return ok({
      session: { id: result.sessionId, status: result.status, version: result.version },
    });
  });
}
