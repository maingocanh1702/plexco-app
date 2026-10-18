import { runWithLang, t } from "@plexco/core/i18n";
import { joinSession, resolveDiscoveryListing } from "@plexco/db";
import { err, ok } from "../../../../../lib/api-envelope";
import { isPublicListingId } from "../../../../../lib/discovery-cursor";
import { discoveryNotFound, discoveryPool } from "../../../../../lib/discovery-route-support";
import { readBoundedBody } from "../../../../../lib/read-bounded-body";
import {
  actorThrottled,
  isUnsafeCommandKey,
  mapSessionCommandError,
  personThrottled,
  SESSION_JOIN_PERSON_LIMIT,
} from "../../../../../lib/session-command-route";
import { appDb, csrfOk, currentSession } from "../../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../../lib/tenant-lang";

const MAX_BODY_BYTES = 64 * 1024;

/**
 * POST /api/public-listings/<publicListingId>/join -- a signed-in VISITOR joins a public listing
 * (readiness 4.6; web process only, the discovery process 404s it). Every refusal writes nothing:
 * session + CSRF, the actor and per-person `session-join` buckets, the body (`commandId` only; the
 * person is the session cookie's, HARD RULE 4), then the listing id resolves to (tenant, session)
 * server-side on the readonly handle, a miss being the detail route's ONE 404. joinSession then
 * revalidates the canonical live state under the tenant (DD-73: the resolve grants nothing). The
 * response carries the outcome only: no session, tenant, player or request id.
 *
 * Language (DD-118 bucket a; amends the readiness file's P-14 default): every refusal up to and
 * including the resolve's 404 is pre-tenant and keeps t()'s default. The resolve is the first
 * point where the tenant is known (the visitor is already signed in), so the join, its error
 * mapping and its success run inside runWithLang in the club's language. The listing is already
 * public, so no tenant id becomes an existence oracle; a signed-in visitor learns only the club's
 * configured language.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ publicListingId: string }> },
): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (!csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  if (
    (await actorThrottled(session.accountId)) ||
    (await personThrottled(SESSION_JOIN_PERSON_LIMIT, session.personId))
  ) {
    return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  }

  // The body and commandId rules of resolveSessionCommandContext (session-command-route.ts),
  // restated here because RD-5 / RD-8 forbid a new helper there: keep the two in step.
  const bodyRead = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) {
    return bodyRead.reason === "too_large"
      ? err("INVALID_BODY", t("Dữ liệu quá lớn.", "Payload too large."), 413)
      : err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  let body: unknown;
  try {
    body = JSON.parse(bodyRead.text);
  } catch {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);
  }
  const { commandId } = body as Record<string, unknown>;
  if (
    typeof commandId !== "string" ||
    commandId.trim().length === 0 ||
    commandId.length > 200 ||
    isUnsafeCommandKey(commandId)
  ) {
    return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
  }

  const { publicListingId } = await params;
  if (!isPublicListingId(publicListingId)) return discoveryNotFound();
  const target = await resolveDiscoveryListing(await discoveryPool(), publicListingId);
  if (!target) return discoveryNotFound();

  return runWithLang(await resolveTenantLang(appDb().db, target.tenantId), async () => {
    try {
      const result = await joinSession(appDb().db, {
        tenantId: target.tenantId,
        personId: session.personId,
        sessionId: target.sessionId,
        commandId,
        allowGuestMembership: true,
      });
      return ok({
        join: { outcome: result.outcome, waitlistPosition: result.waitlistPosition },
        replayed: result.replayed,
      });
    } catch (error) {
      const mapped = mapSessionCommandError(error);
      if (mapped) return mapped;
      throw error;
    }
  });
}
