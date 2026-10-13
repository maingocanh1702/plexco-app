import { t } from "@plexco/core/i18n";
import { tenantsForPersonWithProfile } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import type { SessionDto } from "../../../../lib/session-dto";
import { appDb, currentSession } from "../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../lib/tenant-lang";

/**
 * GET /api/auth/session — who am I + my web-admin tenants.
 * Each tenant carries its `locale` (DD-118) so the shell can pick the UI language without a
 * second round trip. Every tenant listed is one the caller is a proven member of, so resolving
 * its locale here discloses nothing the caller could not already see. `name`/`slug`/`timezone`
 * come from M1b's `tenant_profile_read` definer (0052), fail-open per tenant (null on failure).
 */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  }
  const handle = appDb();
  const profiled = await tenantsForPersonWithProfile(handle, session.personId);
  const tenants = await Promise.all(
    // Spread, never `m.role`: this route serialises the caller's OWN memberships back to them and
    // must not DECIDE on a role (DD-56 clause 2 allowlist; session-command-route.test.ts scans for it).
    // M1b's profile read is fail-open per tenant (locale null) -> fall back to the DD-118 seam.
    profiled.map(async (m) => ({
      ...m,
      locale: m.locale ?? (await resolveTenantLang(handle.db, m.tenantId)),
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
