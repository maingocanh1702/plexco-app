/** Shape of `GET /api/auth/session` data, shared by the route and the browser client (types only). */
export interface SessionTenantDto {
  tenantId: string;
  role: string;
  /** Club profile fields (M1b reader, 0052); null when that read failed (shell falls back). */
  name?: string | null;
  slug?: string | null;
  timezone?: string | null;
  locale?: string | null;
}

export interface SessionDto {
  personId: string;
  expiresAt: string;
  csrfToken: string;
  tenants: SessionTenantDto[];
}
