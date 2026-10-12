/**
 * Shape of `GET /api/auth/session` data, shared by the route and the browser client.
 * Types only: importing this from a Client Component pulls in no server code.
 *
 * `name` / `slug` are intentionally absent: the `app` DB role holds zero privileges on `tenants`
 * (migration 0035), and a profile reader needs its own SECURITY DEFINER migration (see the M1a
 * report). `locale` is available through the existing `tenant_locale()` reader (DD-118).
 */
export interface SessionTenantDto {
  tenantId: string;
  role: string;
  locale: "vi" | "en";
}

export interface SessionDto {
  personId: string;
  expiresAt: string;
  csrfToken: string;
  tenants: SessionTenantDto[];
}
