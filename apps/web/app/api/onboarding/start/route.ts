import { t } from "@plexco/core/i18n";
import { checkTypedName, provisionTenant, SlugTakenError, stripInvisibleChars } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { readBoundedBody } from "../../../../lib/read-bounded-body";
import {
  appDb,
  csrfOk,
  currentSession,
  issueSession,
  rateLimited,
  SessionReauthRequiredError,
} from "../../../../lib/session-cookies";

/**
 * POST /api/onboarding/start — WAO-UC-2: create the tenant on the FREE plan
 * (active immediately, BL-BIL-1) + open the onboarding run. Idempotent by
 * slug for the same owner.
 */
const MAX_START_BODY_BYTES = 4096;
const MAX_TENANT_NAME_CHARS = 120;

export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  if (await rateLimited(`tenant-create:${session.accountId}`, 3, 3600)) {
    return err("RATE_LIMITED", t("Quá nhiều lần thử — đợi.", "Too many attempts — wait."), 429);
  }

  // Bounded, typed body (audit 2026-09-06 W-8): `request.json()` had no ceiling. The real
  // payload is four short strings; 4 KiB is ~30× that. Declared length is checked first, then
  // the bytes actually read — a missing or lying Content-Length must not bypass the cap.
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  let body: { slug?: unknown; name?: unknown; timezone?: unknown; locale?: unknown };
  try {
    const bodyRead = await readBoundedBody(request, MAX_START_BODY_BYTES);
    if (!bodyRead.ok) {
      return bodyRead.reason === "too_large"
        ? err("INVALID_BODY", t("Dữ liệu quá lớn.", "Payload too large."), 413)
        : err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
    }
    const raw: unknown = JSON.parse(bodyRead.text);
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
    }
    body = raw as typeof body;
  } catch {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  if (
    typeof body.slug !== "string" ||
    typeof body.name !== "string" ||
    (body.timezone !== undefined && typeof body.timezone !== "string") ||
    (body.locale !== undefined && typeof body.locale !== "string")
  ) {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  const slug = body.slug.trim().toLowerCase();
  // L27 strip first, then the L29 shared check: a refused name is "" and fails the 400 below.
  const name = checkTypedName(stripInvisibleChars(body.name)) ?? "";
  const locale = body.locale === undefined ? undefined : String(body.locale);
  if (locale !== undefined && locale !== "vi" && locale !== "en") {
    return err("INVALID_BODY", t("Ngôn ngữ không hỗ trợ.", "Unsupported locale."), 400);
  }
  const timezone = body.timezone === undefined ? undefined : String(body.timezone);
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    return err("INVALID_BODY", t("Múi giờ không hợp lệ.", "Invalid timezone."), 400);
  }
  // MAX_TENANT_NAME_CHARS mirrors tenants_name_len_chk (0039): reject here with a 400 rather
  // than let the CHECK surface as a 500 from tenant_provision.
  if (
    !/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) ||
    name.length === 0 ||
    name.length > MAX_TENANT_NAME_CHARS
  ) {
    return err(
      "INVALID_BODY",
      t("Tên CLB hoặc slug không hợp lệ.", "Invalid club name or slug."),
      400,
    );
  }

  try {
    const tenantId = await provisionTenant(appDb().pool, {
      slug,
      name,
      timezone,
      locale,
      personId: session.personId,
    });
    // Privilege change (owner grant) → rotate the session (transition table).
    const { csrfToken } = await issueSession(session.accountId);
    return ok({ tenantId, plan: "free", status: "active", csrfToken });
  } catch (error) {
    // Issuance fence (D0-12): the session was revoked mid-onboarding (a
    // concurrent logout-all won the rotate race) — generic 401, no internal
    // reason leaked.
    if (error instanceof SessionReauthRequiredError) {
      return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 401);
    }
    if (error instanceof SlugTakenError) {
      return err("SLUG_TAKEN", t("Slug đã được dùng bởi CLB khác.", "Slug is taken."), 409);
    }
    throw error;
  }
}

/** IANA zone check — Intl throws on unknown zones. */
function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
