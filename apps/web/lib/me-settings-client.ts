import { apiFetch } from "./api-client";

/**
 * Typed browser wrappers for the account-scoped settings routes (FE-INV-3/6). DTOs mirror what
 * /api/me/* serialise; re-declared here, never imported from the db package. No person or
 * platform ids: the account comes from the session cookie.
 */
export interface ProfileDto {
  displayName: string | null;
}

export interface LinkedChannelDto {
  id: string;
  platform: string;
  status: "active" | "inactive";
  createdAt: string;
}

export async function getMyProfile(signal?: AbortSignal): Promise<ProfileDto> {
  const data = await apiFetch<{ profile: ProfileDto }>("/api/me/profile", { signal });
  return data.profile;
}

export async function patchMyProfile(
  csrfToken: string,
  body: { displayName: string; commandId: string },
): Promise<ProfileDto> {
  const data = await apiFetch<{ profile: ProfileDto }>("/api/me/profile", {
    method: "PATCH",
    csrfToken,
    json: body,
  });
  return data.profile;
}

export async function listMyChannels(signal?: AbortSignal): Promise<LinkedChannelDto[]> {
  const data = await apiFetch<{ channels: LinkedChannelDto[] }>("/api/me/channels", { signal });
  return data.channels;
}

export async function detachMyChannel(csrfToken: string, channelId: string): Promise<void> {
  await apiFetch<{ detached: true }>(`/api/me/channels/${encodeURIComponent(channelId)}/detach`, {
    method: "POST",
    csrfToken,
  });
}

/** Display name of a platform; unknown values render as-is (never blank). */
export function platformLabel(platform: string): string {
  switch (platform) {
    case "zalo":
      return "Zalo";
    case "messenger":
      return "Messenger";
    case "telegram":
      return "Telegram";
    default:
      return platform;
  }
}

export type DisplayNameProblem = "empty" | "too_long" | "invalid_chars";

/**
 * Client-side mirror of the display-name rule (the server and 0055 enforce it): trimmed, 1..120
 * code points, no control (Cc) or format (Cf) character. Returns the first problem or null.
 */
export function displayNameProblem(raw: string): DisplayNameProblem | null {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1) return "empty";
  if (length > 120) return "too_long";
  return /[\p{Cc}\p{Cf}]/u.test(name) ? "invalid_chars" : null;
}
