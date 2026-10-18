import { GENDER_VALUES } from "@plexco/core";
import { t } from "@plexco/core/i18n";
import { DisplayNameError, readMyProfile, updateMyProfile } from "@plexco/db";
import { err, NO_STORE, ok } from "../../../../lib/api-envelope";
import { resolveMeGate, validCommandId } from "../../../../lib/me-route-gate";
import { readBoundedBody } from "../../../../lib/read-bounded-body";
import { appDb } from "../../../../lib/session-cookies";

/**
 * GET/PATCH /api/me/profile -- the signed-in user's own profile: display name plus the DD-39
 * self-declared gender and pricing consent (every other persons column stays unreachable). This
 * self-read is the ONLY plaintext exit of gender: never logged, never echoed in an error; a fault
 * logs only the error name and answers an empty 500 (an unreadable blob is never shown as "not
 * set"). The Person is resolved from the session's ACCOUNT inside the 0055 / 0062 definers. PATCH
 * is idempotent by value, so commandId is validated but nothing is stored under it (the
 * tenant-bound processed_commands table does not apply to a tenant-less command).
 * Body keys are within {displayName, gender, genderConsent, commandId}: commandId and at least one
 * other key are required; unknown keys are rejected. GENDER_COLLECTION_ENABLED (DD-54, only "true"
 * enables, read per call): OFF rejects a non-null gender or genderConsent true with INVALID_BODY;
 * erase (gender null) and withdraw (genderConsent false) always pass. Value checks run first.
 */
const MAX_BODY_BYTES = 2 * 1024;
const PATCH_LIMIT = { name: "me-profile", limit: 10, windowSeconds: 60 };
const KEYS = new Set(["displayName", "gender", "genderConsent", "commandId"]);
const GENDERS = new Set<unknown>(GENDER_VALUES);

const invalid = () => err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
const notFound = () => err("NOT_FOUND", t("Không tìm thấy hồ sơ.", "Profile not found."), 404);
const invalidGender = () =>
  err("INVALID_GENDER", t("Giá trị giới tính không hợp lệ.", "Invalid gender value."), 400);
/** Read at call time, like the CSP_SCRIPT_NONCE_ENABLED reader (request-policy.ts): only "true". */
const genderCollection = () => process.env.GENDER_COLLECTION_ENABLED === "true";
const failed = (method: string, error: unknown) => {
  console.error(
    `${method} /api/me/profile failed`,
    error instanceof Error ? error.name : "unknown",
  );
  return new Response(null, { status: 500, headers: { "cache-control": NO_STORE } });
};

export async function GET(request: Request): Promise<Response> {
  const gate = await resolveMeGate(request, { csrf: false });
  if (gate instanceof Response) return gate;
  try {
    const profile = await readMyProfile(appDb().pool, gate.accountId);
    return profile ? ok({ profile, genderCollection: genderCollection() }) : notFound();
  } catch (error) {
    return failed("GET", error);
  }
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
  if (Object.keys(body).some((k) => !KEYS.has(k))) return invalid();
  if (!validCommandId(body.commandId)) {
    return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
  }
  const { displayName, gender, genderConsent } = body;
  if (displayName === undefined && gender === undefined && genderConsent === undefined) {
    return invalid();
  }
  if (gender !== undefined && gender !== null && !GENDERS.has(gender)) return invalidGender();
  if (genderConsent !== undefined && typeof genderConsent !== "boolean") return invalid();
  if (gender === null && genderConsent === true) return invalid();
  const collecting = (gender !== undefined && gender !== null) || genderConsent === true;
  if (collecting && !genderCollection()) return invalid();
  // The checks above already narrowed both values; the cast only restates them for the compiler.
  const fields = { gender, genderConsent } as Parameters<typeof updateMyProfile>[3];
  try {
    const profile = await updateMyProfile(appDb().pool, gate.accountId, displayName, fields);
    return profile ? ok({ profile, genderCollection: genderCollection() }) : notFound();
  } catch (error) {
    if (error instanceof DisplayNameError) {
      return err(
        "INVALID_BODY",
        t("Tên hiển thị phải từ 1 đến 120 ký tự.", "Display name must be 1-120 characters."),
        400,
      );
    }
    return failed("PATCH", error);
  }
}
