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
 * Client-side mirror of the display-name rule (validateDisplayName in @plexco/db me-settings.ts and
 * 0055 enforce it; same set, same order): trimmed, 1..120 code points, no hidden character anywhere:
 * control (Cc), format (Cf), line / paragraph separator (Zl, Zp), a default-ignorable code point that
 * is not a variation selector (the marks U+034F, U+17B4, U+17B5 and the Hangul fillers U+115F,
 * U+1160, U+3164, U+FFA0) or U+2800 BRAILLE PATTERN BLANK. Returns the first problem or null.
 */
export function displayNameProblem(raw: string): DisplayNameProblem | null {
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1) return "empty";
  if (length > 120) return "too_long";
  return /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\u034f\u17b4\u17b5\u115f\u1160\u3164\uffa0\u2800]/u.test(name)
    ? "invalid_chars"
    : null;
}
