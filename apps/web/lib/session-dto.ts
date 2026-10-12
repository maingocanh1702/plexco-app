/** Shape of `GET /api/auth/session` data, shared by the route and the browser client (types only). */
export interface SessionTenantDto {
  tenantId: string;
  role: string;
  /** Club profile fields arrive from lane M1b's reader; absent until then (shell falls back). */
  name?: string;
  slug?: string;
  timezone?: string;
  locale?: string;
}

export interface SessionDto {
  personId: string;
  expiresAt: string;
  csrfToken: string;
  tenants: SessionTenantDto[];
}
