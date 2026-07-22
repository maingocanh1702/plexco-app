import { t } from "@plexco/core/i18n";
import { provisionTenant, SlugTakenError } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
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
export async function POST(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  if (await rateLimited(`tenant-create:${session.accountId}`, 3, 3600)) {
    return err("RATE_LIMITED", t("Quá nhiều lần thử — đợi.", "Too many attempts — wait."), 429);
  }

  let body: { slug?: unknown; name?: unknown; timezone?: unknown; locale?: unknown };
  try {
    const raw: unknown = await request.json();
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
  const name = body.name.trim();
  const locale = body.locale === undefined ? undefined : String(body.locale);
  if (locale !== undefined && locale !== "vi" && locale !== "en") {
    return err("INVALID_BODY", t("Ngôn ngữ không hỗ trợ.", "Unsupported locale."), 400);
  }
  const timezone = body.timezone === undefined ? undefined : String(body.timezone);
  if (timezone !== undefined && !isValidTimeZone(timezone)) {
    return err("INVALID_BODY", t("Múi giờ không hợp lệ.", "Invalid timezone."), 400);
  }
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(slug) || name.length === 0) {
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
