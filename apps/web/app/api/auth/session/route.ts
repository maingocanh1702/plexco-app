import { t } from "@plexco/core/i18n";
import { tenantsForPerson } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import type { SessionDto } from "../../../../lib/session-dto";
import { appDb, currentSession } from "../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../lib/tenant-lang";

/**
 * GET /api/auth/session — who am I + my web-admin tenants.
 * Each tenant carries its `locale` (DD-118) so the shell can pick the UI language without a
 * second round trip. Every tenant listed is one the caller is a proven member of, so resolving
 * its locale here discloses nothing the caller could not already see. `name`/`slug` are not
 * served: `app` has no privilege on `tenants` (0035) — see lib/session-dto.ts.
 */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  }
  const handle = appDb();
  const memberships = await tenantsForPerson(handle.pool, session.personId);
  const tenants = await Promise.all(
    // Spread, never `m.role`: this route serialises the caller's OWN memberships back to them and
    // must not DECIDE on a role (DD-56 clause 2 allowlist; session-command-route.test.ts scans for it).
    memberships.map(async (m) => ({
      ...m,
      locale: await resolveTenantLang(handle.db, m.tenantId),
    })),
  );
  const dto: SessionDto = {
    personId: session.personId,
    expiresAt: session.expiresAt.toISOString(),
    csrfToken: session.csrfSecret,
    tenants,
  };
  return ok(dto);
}
