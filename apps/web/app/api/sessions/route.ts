import { createSession, type CreateSessionInputPayload } from "@plexco/db";
import { ok } from "../../../lib/api-envelope";
import { handleSessionCommand, shapeCreateFields } from "../../../lib/session-command-route";
import { appDb } from "../../../lib/session-cookies";

/**
 * POST /api/sessions — create a DRAFT session (BE tech spec §3, 10/min per tenant).
 * Thin route per frontend-architecture.md v0.7: authenticate, authorize, shape input, delegate.
 * createSession owns its own withTenant transaction and every domain rule.
 */
export async function POST(request: Request): Promise<Response> {
  return handleSessionCommand(request, { bucket: "session-create", limit: 10 }, async (context) => {
    // NOTHING about the payload is validated before dispatch: dedup on (tenant_id, command_id)
    // precedes patch validation inside the command (DD-117 D5), so any pre-rejection here would
    // fail a retry of an already-committed create — including the case where the ORIGINAL request
    // differed from the retry (codex round-02 [P1]). shapeCreateFields simply does not carry
    // venueAddress, so an unsupported field is ignored like any other unrecognised key rather than
    // parsed-and-dropped or refused.
    const fields = shapeCreateFields(context.body);

    const result = await createSession(appDb().db, {
      tenantId: context.tenantId,
      commandId: context.commandId,
      input: {
        ...fields,
        sportId: context.body.sportId,
        startsAt: fields.startsAt,
        endsAt: fields.endsAt,
        timezone: fields.timezone,
      } as CreateSessionInputPayload,
    });
    return ok({
      session: { id: result.sessionId, status: result.status, version: result.version },
    });
  });
}
