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
 * come from the profile reader (0052 definer; null when a club's profile cannot be read). Its raw
 * `locale` is replaced, never duplicated: the one served value is `resolveTenantLang` (DD-118).
 */
export async function GET(): Promise<Response> {
  const session = await currentSession();
  if (!session) {
    return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);
  }
  const handle = appDb();
  const memberships = await tenantsForPersonWithProfile(handle, session.personId);
  // One at a time, like the profile reads: a person in many clubs must not take the whole pool.
  const tenants: SessionDto["tenants"] = [];
  for (const m of memberships) {
    // Spread, never `m.role`: this route serialises the caller's OWN memberships back to them and
    // must not DECIDE on a role (DD-56; this file is exempt from lib/role-read-guard.test.ts).
    tenants.push({ ...m, locale: await resolveTenantLang(handle.db, m.tenantId) });
  }
  const dto: SessionDto = {
    personId: session.personId,
    expiresAt: session.expiresAt.toISOString(),
    csrfToken: session.csrfSecret,
    tenants,
  };
  return ok(dto);
}
