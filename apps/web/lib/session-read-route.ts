import { runWithLang, t, type Lang } from "@plexco/core/i18n";
import { SessionReadError } from "@plexco/db";
import { err } from "./api-envelope";
import { actorThrottled, mayManageSessions, readTenantParam } from "./session-command-route";
import { appDb, currentSession, rateLimited } from "./session-cookies";
import { resolveTenantLang } from "./tenant-lang";

/**
 * Entry gate for body-less host READ routes (`GET /api/sessions`, `GET /api/sessions/:id`).
 *
 * Sibling of resolveSessionCommandContext and deliberately built from the same helpers
 * (tenant param, actor ceiling, authorize) so the two can never disagree about who is admitted.
 * Differences, all intentional: no CSRF (a GET changes nothing and carries no body), no
 * guest-note opt-in (reads here are the HOST view; a guest-note reader is a different, later
 * route), and no body parsing.
 *
 * Authority: `authorize(session.manage)`. The registry is closed (17 keys, migration 0047) and the
 * BE spec marks these endpoints TenantAdmin, so the host reads share the routine-session-CRUD
 * capability instead of minting a `session.read` key nobody ratified.
 *
 * ORDER (same rationale as the command gate, codex round-01 [P1]): session -> tenant param ->
 * ACTOR ceiling -> authorize -> language -> per-tenant bucket. The per-tenant bucket is spent only
 * by an authorized actor, so a stranger cannot drive a victim tenant's admins into 429s, and the
 * tenant's language is resolved only AFTER authorization (DD-118), so every response from the
 * per-tenant 429 onward is in the tenant's language while earlier ones stay Vietnamese.
 *
 * Threat model: defends against an authenticated person reading a tenant's sessions, rosters,
 * charges and guest notes without a current `session.manage` capability, and against cross-tenant
 * quota exhaustion. It does NOT defend against a compromised cookie or an admin reading within
 * their own tenant, and the authorize decision is a point-in-time read (a read has no mutation
 * for a recheck-under-lock to protect). It must be rewritten if a non-session principal (bot,
 * public link, service token) ever reaches these routes. HR2: the response carries money fields,
 * which is acceptable ONLY because this gate is authenticated + tenant-authorized; never reuse
 * this DTO on a public route.
 */

export interface SessionReadContext {
  tenantId: string;
  lang: Lang;
  query: URLSearchParams;
}

const forbidden = () =>
  err("FORBIDDEN", t("Bạn không có quyền với CLB này.", "Not permitted for this club."), 403);

/** Returns an already-enveloped error Response, or the trusted read context. */
export async function resolveSessionReadContext(
  request: Request,
  rateLimit: { bucket: string; limit: number },
): Promise<Response | SessionReadContext> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);

  const tenantId = readTenantParam(request);
  if (tenantId === null) {
    return err("INVALID_BODY", t("Thiếu hoặc sai mã CLB.", "Missing or invalid club id."), 400);
  }
  if (await actorThrottled(session.accountId)) {
    return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  }
  // One indistinguishable 403 for non-member / foreign tenant / no capability (no existence oracle).
  if (!(await mayManageSessions(tenantId, session.personId))) return forbidden();

  const lang: Lang = await resolveTenantLang(appDb().db, tenantId);
  if (await rateLimited(`${rateLimit.bucket}:${tenantId}`, rateLimit.limit, 60)) {
    return runWithLang(lang, async () =>
      err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429),
    );
  }
  return { tenantId, lang, query: new URL(request.url).searchParams };
}

/**
 * Request boundary for a read: resolve, set the language context, run the handler, map the one
 * typed read error to the pinned 400. Anything else is rethrown (a fault is never a client error).
 */
export async function handleSessionRead(
  request: Request,
  rateLimit: { bucket: string; limit: number },
  handler: (context: SessionReadContext) => Promise<Response>,
): Promise<Response> {
  // The read gate skips CSRF on purpose, so it must never serve a mutation. HEAD is allowed:
  // Next serves it through GET.
  if (request.method !== "GET" && request.method !== "HEAD") {
    const response = err(
      "INVALID_BODY",
      t("Phương thức không được hỗ trợ.", "Method not supported."),
      405,
    );
    response.headers.set("allow", "GET");
    return response;
  }
  const context = await resolveSessionReadContext(request, rateLimit);
  if (context instanceof Response) return context;
  return runWithLang(context.lang, async () => {
    try {
      return await handler(context);
    } catch (error) {
      if (error instanceof SessionReadError) {
        return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
      }
      throw error;
    }
  });
}
