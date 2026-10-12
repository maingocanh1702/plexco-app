import { t } from "@plexco/core/i18n";
import { listActiveSports } from "@plexco/db";
import { err, ok } from "../../../lib/api-envelope";
import { appDb, currentSession, rateLimited } from "../../../lib/session-cookies";

/**
 * GET /api/sports — active sports for the session form's picker. The `sports` table is a global
 * directory (no tenant, no money, no PII), so any signed-in account may read it; the only gates
 * are a session and a per-ACCOUNT bucket (60/min). No tenant param: nothing here is tenant data.
 */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  if (await rateLimited(`sports:${session.accountId}`, 60, 60)) {
    return err("RATE_LIMITED", t("Quá nhiều yêu cầu — đợi.", "Too many requests — wait."), 429);
  }
  return ok({ sports: await listActiveSports(appDb().db) });
}
