import { closeSession } from "@plexco/db";
import { ok } from "../../../../../lib/api-envelope";
import {
  handleSessionCommand,
  readExpectedVersion,
} from "../../../../../lib/session-command-route";
import { appDb } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/close — open → closed (BE tech spec §3: status-only, `commandId` +
 * `expectedVersion`). Already-closed is an idempotent no-op, not an error.
 *
 * Closing a session whose start has passed is the NORMAL completion, so unlike cancel there is no
 * past-guard here. That asymmetry belongs to the command (session-service.ts), not to this route.
 *
 * The spec's Rate Limits table pins create (10/min) and update (20/min) per tenant but not close;
 * this takes the more conservative pinned neighbour rather than inventing a looser one — the same
 * choice the publish route already made and for the same reason.
 *
 * `id` is passed through unvalidated on purpose: closeSession fails a non-UUID closed as
 * SESSION_NOT_FOUND before any cast could raise a raw 22P02, so re-checking here would only
 * duplicate the rule and risk drifting from it.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(request, { bucket: "session-close", limit: 10 }, async (context) => {
    // Passed through unvalidated: dedup precedes validation inside the command (DD-117 D5), so a
    // retry of an already-committed close must replay rather than 400.
    const expectedVersion = readExpectedVersion(context.body);

    const { id } = await params;
    const result = await closeSession(appDb().db, {
      tenantId: context.tenantId,
      commandId: context.commandId,
      input: { sessionId: id, expectedVersion },
    });
    return ok({
      session: { id: result.sessionId, status: result.status, version: result.version },
    });
  });
}
