import { t } from "@plexco/core/i18n";
import { tenantsForPerson } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { appDb, currentSession } from "../../../../lib/session-cookies";

/** GET /api/auth/session — who am I + my web-admin tenants. */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  }
  const tenants = await tenantsForPerson(appDb().pool, session.personId);
  return ok({
    personId: session.personId,
    expiresAt: session.expiresAt,
    csrfToken: session.csrfSecret,
    tenants,
  });
}
