import {
  SESSION_STATUSES,
  createSession,
  decodeSessionCursor,
  listSessions,
  type CreateSessionInputPayload,
} from "@plexco/db";
import { t } from "@plexco/core/i18n";
import { err, ok } from "../../../lib/api-envelope";
import { handleSessionCommand, shapeCreateFields } from "../../../lib/session-command-route";
import { handleSessionRead } from "../../../lib/session-read-route";
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
    // differed from the retry (codex round-02 [P1]). shapeCreateFields carries venueAddress
    // (DD-128 OD-4a) like every other create field; the command validates it (max 200 characters)
    // only after dedup.
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

const invalidQuery = () =>
  err("INVALID_BODY", t("Tham số không hợp lệ.", "Invalid query parameter."), 400);

/**
 * GET /api/sessions — host list, newest first (BE tech spec §3, 60/min per tenant). Query:
 * `status` (draft|open|closed|cancelled), `cursor` (opaque, from pageInfo.nextCursor), `limit`
 * (1..50, default 20). Authorized by authorize(session.manage) in the read gate.
 */
export async function GET(request: Request): Promise<Response> {
  return handleSessionRead(request, { bucket: "session-read", limit: 60 }, async (context) => {
    const status = context.query.get("status") ?? undefined;
    const cursor = context.query.get("cursor") ?? undefined;
    const rawLimit = context.query.get("limit");
    if (status !== undefined && !(SESSION_STATUSES as readonly string[]).includes(status)) {
      return invalidQuery();
    }
    if (cursor !== undefined && decodeSessionCursor(cursor) === null) return invalidQuery();
    let limit: number | undefined;
    if (rawLimit !== null) {
      if (!/^\d{1,4}$/.test(rawLimit)) return invalidQuery();
      limit = Number(rawLimit);
      if (limit < 1 || limit > 50) return invalidQuery();
    }
    const page = await listSessions(appDb().db, {
      tenantId: context.tenantId,
      status,
      cursor,
      limit,
    });
    return ok({ sessions: page.sessions, pageInfo: page.pageInfo });
  });
}
