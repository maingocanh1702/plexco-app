import { apiFetch } from "./api-client";

/**
 * Typed browser wrappers for the club settings screen. They use the EXISTING routes only:
 * GET/PATCH /api/onboarding/club and GET /api/onboarding/zalo + POST .../zalo/connect.
 * The bot token is write-only: it goes out in the connect body and never comes back.
 */
export interface ClubConfigDto {
  slug: string | null;
  name: string | null;
  timezone: string | null;
  locale: string | null;
  defaultSportKey: string | null;
  defaultPriceAmount: number | null;
  defaultVisibility: string | null;
}

export interface ClubPatchBody {
  name?: string;
  timezone?: string;
  locale?: "vi" | "en";
  defaultSportKey?: string;
  defaultPriceAmount?: number;
  defaultVisibility?: "private" | "public";
}

export type ZaloStatus =
  "not_connected" | "connecting" | "registered" | "active" | "drift" | "error" | "revoked";

export interface ZaloStateDto {
  status: ZaloStatus;
  verifiedAt: string | null;
  lastSetwebhookAt: string | null;
  webhookUrl: string | null;
}

const q = (tenantId: string) => `tenant=${encodeURIComponent(tenantId)}`;

export async function getClubConfig(
  tenantId: string,
  signal?: AbortSignal,
): Promise<ClubConfigDto> {
  const data = await apiFetch<{ club: ClubConfigDto }>(`/api/onboarding/club?${q(tenantId)}`, {
    signal,
  });
  return data.club;
}

export async function patchClubConfig(
  ctx: { tenantId: string; csrfToken: string },
  body: ClubPatchBody & { commandId: string },
): Promise<ClubConfigDto> {
  const data = await apiFetch<{ club: ClubConfigDto }>(`/api/onboarding/club?${q(ctx.tenantId)}`, {
    method: "PATCH",
    csrfToken: ctx.csrfToken,
    json: body,
  });
  return data.club;
}

export function getZaloState(tenantId: string, signal?: AbortSignal): Promise<ZaloStateDto> {
  return apiFetch<ZaloStateDto>(`/api/onboarding/zalo?${q(tenantId)}`, { signal });
}

export function connectZalo(
  ctx: { tenantId: string; csrfToken: string },
  body: { botToken: string; commandId: string },
): Promise<ZaloStateDto> {
  return apiFetch<ZaloStateDto>(`/api/onboarding/zalo/connect?${q(ctx.tenantId)}`, {
    method: "POST",
    csrfToken: ctx.csrfToken,
    json: body,
  });
}
