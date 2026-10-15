import { t } from "@plexco/core/i18n";
import { err } from "./api-envelope";
import { actorThrottled, isUnsafeCommandKey } from "./session-command-route";
import { csrfOk, currentSession, rateLimited } from "./session-cookies";

/**
 * Entry gate shared by the account-scoped /api/me/* routes (profile, channels, detach) so they can
 * never disagree about who is admitted. ORDER: session -> [CSRF] -> actor ceiling -> optional
 * per-account bucket (spent only after the cheaper gates passed). The acting account comes ONLY from
 * the session: no route reads an account or person id from the body or the URL. Pre-tenant surface
 * (no club is routed), so every message stays Vietnamese (DD-118 bucket b).
 */
export async function resolveMeGate(
  request: Request,
  options: { csrf: boolean; bucket?: { name: string; limit: number; windowSeconds: number } },
): Promise<Response | { accountId: string }> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (options.csrf && !csrfOk(request, session)) {
    return err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }
  const tooMany = () =>
    err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  if (await actorThrottled(session.accountId)) return tooMany();
  if (options.bucket) {
    const { name, limit, windowSeconds } = options.bucket;
    if (await rateLimited(`${name}:${session.accountId}`, limit, windowSeconds)) return tooMany();
  }
  return { accountId: session.accountId };
}

/** commandId is validated for parity with the other command routes; PATCH profile is idempotent by value. */
export function validCommandId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 200 &&
    !isUnsafeCommandKey(value)
  );
}
