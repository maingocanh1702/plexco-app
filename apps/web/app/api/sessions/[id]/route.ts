import { t } from "@plexco/core/i18n";
import { getSessionDetail, updateSession } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import {
  handleSessionCommand,
  readExpectedVersion,
  shapeSessionFields,
} from "../../../../lib/session-command-route";
import { appDb } from "../../../../lib/session-cookies";
import { handleSessionRead } from "../../../../lib/session-read-route";

/**
 * PUT /api/sessions/:id — edit a session (BE tech spec §3, 20/min per tenant). PUT, not PATCH:
 * that is the method the spec's endpoint table pins.
 *
 * Only PROVIDED fields are forwarded, and a provided `null` is forwarded as a real value —
 * updateSession treats absent as "leave alone" and null as "clear", so readSessionFields
 * preserves that distinction rather than collapsing it.
 *
 * The response mirrors the publish DTO. The spec's endpoint table pins the method and path for
 * PUT but carries no Request/Response block for it, so this reuses the pinned sibling shape
 * instead of inventing fields; `visibility` and `replayed` stay internal (DD-60 HARD RULE 2).
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(request, { bucket: "session-update", limit: 20 }, async (context) => {
    // Nothing about the patch is validated before dispatch: dedup on (tenant_id, command_id) runs
    // BEFORE patch validation (DD-117 D5, pinned by DED2), so a retry of an already-committed
    // update — even one whose payload got mangled in transit — must replay the stored result
    // rather than receive a 400 for work that already succeeded. codex round-01 [P1].
    const fields = shapeSessionFields(context.body);
    const expectedVersion = readExpectedVersion(context.body);

    const { id } = await params;
    const result = await updateSession(appDb().db, {
      tenantId: context.tenantId,
      commandId: context.commandId,
      input: { sessionId: id, expectedVersion, ...fields },
    });
    return ok({
      session: { id: result.sessionId, status: result.status, version: result.version },
    });
  });
}

/**
 * GET /api/sessions/:id — host detail (BE tech spec §3, 60/min per tenant): session fields,
 * roster with charge summary, guest notes, counts. 404 SESSION_NOT_FOUND when the id does not
 * exist in the caller's tenant (RLS makes another tenant's id indistinguishable from a missing one).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionRead(request, { bucket: "session-read", limit: 60 }, async (context) => {
    const { id } = await params;
    const session = await getSessionDetail(appDb().db, {
      tenantId: context.tenantId,
      sessionId: id,
    });
    if (!session) {
      return err("SESSION_NOT_FOUND", t("Buổi chơi không tồn tại.", "Session not found."), 404);
    }
    return ok({ session });
  });
}
