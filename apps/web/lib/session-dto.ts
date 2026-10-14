/** Shape of `GET /api/auth/session` data, shared by the route and the browser client (types only). */
export interface SessionTenantDto {
  tenantId: string;
  role: string;
  /** Club profile from M1b's reader: null when unreadable (the shell falls back). */
  name?: string | null;
  slug?: string | null;
  timezone?: string | null;
  locale?: string;
}

export interface SessionDto {
  personId: string;
  expiresAt: string;
  csrfToken: string;
  tenants: SessionTenantDto[];
}
