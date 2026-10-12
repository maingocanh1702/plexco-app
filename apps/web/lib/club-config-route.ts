import { runWithLang, t, type Lang } from "@plexco/core/i18n";
import { authorize, CLUB_ACTION, withTenant } from "@plexco/db";
import { err } from "./api-envelope";
import { actorThrottled, readTenantParam } from "./session-command-route";
import { appDb, csrfOk, currentSession, rateLimited } from "./session-cookies";
import { resolveTenantLang } from "./tenant-lang";

/**
 * Entry gate shared by the club-configuration routes (PATCH/GET /api/onboarding/club and GET
 * /api/onboarding/readiness) so they can never disagree about who is admitted.
 *
 * ORDER (same rationale as session-command-route): session -> [CSRF] -> tenant param -> ACTOR
 * ceiling -> authorize(content.manage) -> language (DD-118, only after authz) -> optional
 * per-tenant bucket (spent only by an authorized actor). One indistinguishable 403 for
 * non-member / foreign tenant / missing capability (no existence oracle).
 *
 * Threat model: defends against an authenticated person configuring or reading another club's
 * setup, and against cross-tenant quota exhaustion. Authorize is a point-in-time read here; the
 * mutation re-runs it under the transaction lock (updateClubConfig).
 */
export interface ClubGateContext {
  tenantId: string;
  personId: string;
  lang: Lang;
}

export async function resolveClubGate(
  request: Request,
  options: { csrf: boolean; tenantBucket?: { bucket: string; limit: number } },
): Promise<Response | ClubGateContext> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (options.csrf && !csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  const tenantId = readTenantParam(request);
  if (tenantId === null) {
    return err("INVALID_BODY", t("Thiếu hoặc sai mã CLB.", "Missing or invalid club id."), 400);
  }
  if (await actorThrottled(session.accountId)) {
    return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  }
  const decision = await withTenant(appDb().db, tenantId, (tx) =>
    authorize(tx, { tenantId, action: CLUB_ACTION, actorPersonId: session.personId }),
  );
  if (!decision.allowed) {
    return err(
      "FORBIDDEN",
      t("Bạn không có quyền với CLB này.", "Not permitted for this club."),
      403,
    );
  }
  // DD-118 SEAM: language is resolvable HERE and no earlier — the tenant is proven authorized for
  // this actor. Every `err(` above stays Vietnamese (ratified), never an oracle for tenant locale.
  const lang = await resolveTenantLang(appDb().db, tenantId);
  if (options.tenantBucket) {
    const { bucket, limit } = options.tenantBucket;
    if (await rateLimited(`${bucket}:${tenantId}`, limit, 60)) {
      return runWithLang(lang, async () =>
        err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429),
      );
    }
  }
  return { tenantId, personId: session.personId, lang };
}
