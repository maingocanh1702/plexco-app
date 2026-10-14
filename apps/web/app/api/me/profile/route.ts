import { t } from "@plexco/core/i18n";
import { DisplayNameError, readMyProfile, updateMyProfile } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { resolveMeGate, validCommandId } from "../../../../lib/me-route-gate";
import { readBoundedBody } from "../../../../lib/read-bounded-body";
import { appDb } from "../../../../lib/session-cookies";

/**
 * GET/PATCH /api/me/profile -- the signed-in user's minimal profile (display name only; every other
 * persons column stays unreachable). The Person is resolved from the session's ACCOUNT inside the
 * 0055 definers. PATCH is idempotent by value, so commandId is validated but nothing is stored
 * under it (the tenant-bound processed_commands table does not apply to a tenant-less command).
 * Body keys are exactly {displayName, commandId}; unknown keys are rejected.
 */
const MAX_BODY_BYTES = 2 * 1024;
const PATCH_LIMIT = { name: "me-profile", limit: 10, windowSeconds: 60 };

const invalid = () => err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
const notFound = () => err("NOT_FOUND", t("Không tìm thấy hồ sơ.", "Profile not found."), 404);

export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, { csrf: false });
  if (gate instanceof Response) return gate;
  const profile = await readMyProfile(appDb().pool, gate.accountId);
  return profile ? ok({ profile }) : notFound();
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, { csrf: true, bucket: PATCH_LIMIT });
  if (gate instanceof Response) return gate;

  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return invalid();
  }
  const read = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!read.ok) return invalid();
  let raw: unknown;
  try {
    raw = JSON.parse(read.text);
  } catch {
    return invalid();
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid();
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some((k) => k !== "displayName" && k !== "commandId")) return invalid();
  if (!validCommandId(body.commandId)) {
    return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
  }
  try {
    const profile = await updateMyProfile(appDb().pool, gate.accountId, body.displayName);
    return profile ? ok({ profile }) : notFound();
  } catch (error) {
    if (error instanceof DisplayNameError) {
      return err(
        "INVALID_BODY",
        t("Tên hiển thị phải từ 1 đến 120 ký tự.", "Display name must be 1-120 characters."),
        400,
      );
    }
    throw error;
  }
}
