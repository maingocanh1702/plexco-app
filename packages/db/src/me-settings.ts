import type pg from "pg";
import { hasHiddenChar, hasVisibleChar } from "./text-safety.js";

/**
 * Signed-in user's own settings (lane M4): profile display name + linked channels + unlink.
 * Tenant-less and account-scoped: `persons` / `channel_identities` are global protected tables, so
 * everything goes through the 0055 SECURITY DEFINER functions keyed by the ACCOUNT id taken from the
 * session. No function takes a person id; no encrypted platform id, username or lookup hash is ever
 * selected. Detach is naturally idempotent: a repeat finds the identity owned by the fresh Person the
 * first call minted (not "inactive": detach leaves the status as it was) and answers `invalid` (the
 * route maps it to 409), so no command id is stored.
 */
export const DISPLAY_NAME_MAX = 120;

export class DisplayNameError extends Error {
  constructor() {
    super("display name must be 1-120 printable characters");
    this.name = "DisplayNameError";
  }
}

/**
 * Same rule as 0055 person_profile_update: trimmed, 1..120 CODE POINTS, no hidden character
 * (hasHiddenChar), at least one visible one (hasVisibleChar), both from text-safety.ts. Returns the trimmed value or throws.
 */
export function validateDisplayName(raw: unknown): string {
  if (typeof raw !== "string") throw new DisplayNameError();
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > DISPLAY_NAME_MAX || hasHiddenChar(name) || !hasVisibleChar(name)) {
    throw new DisplayNameError();
  }
  return name;
}

export interface MyProfile {
  displayName: string | null;
}

export interface MyChannel {
  channelIdentityId: string;
  platform: string;
  status: "active" | "inactive";
  createdAt: Date;
}

export type DetachOutcome = "detached" | "invalid";

/** The account's Person profile; null when the account has no active Person. */
export async function readMyProfile(pool: pg.Pool, accountId: string): Promise<MyProfile | null> {
  const { rows } = await pool.query<{ display_name: string | null }>(
    `SELECT display_name FROM person_profile_read($1::uuid)`,
    [accountId],
  );
  const row = rows[0];
  return row ? { displayName: row.display_name } : null;
}

/** Writes ONLY persons.display_name; null when the account has no active Person. */
export async function updateMyProfile(
  pool: pg.Pool,
  accountId: string,
  displayName: unknown,
): Promise<MyProfile | null> {
  const name = validateDisplayName(displayName);
  const { rows } = await pool.query<{ display_name: string | null }>(
    `SELECT display_name FROM person_profile_update($1::uuid, $2::text)`,
    [accountId, name],
  );
  const row = rows[0];
  return row ? { displayName: row.display_name } : null;
}

/**
 * Every identity of the account's Person (active and inactive), newest first. Inactive rows are
 * listed so the account sees everything still tied to it, but `detachMyChannel` refuses them (the
 * signed unlink rule moves active identities only; 0055 header, INACTIVE IDENTITIES).
 */
export async function listMyChannels(pool: pg.Pool, accountId: string): Promise<MyChannel[]> {
  const { rows } = await pool.query<{
    channel_identity_id: string;
    platform: string;
    status: "active" | "inactive";
    created_at: Date;
  }>(
    `SELECT channel_identity_id, platform, status, created_at FROM account_linked_channels($1::uuid)`,
    [accountId],
  );
  return rows.map((r) => ({
    channelIdentityId: r.channel_identity_id,
    platform: r.platform,
    status: r.status,
    createdAt: r.created_at,
  }));
}

/**
 * UNLINK: moves the identity onto a fresh empty Person with no name (the Zalo user becomes a nameless
 * stranger to the bot; nothing is copied from the account's Person). Never merges, tombstones or
 * deletes the Person that owns memberships/charges. `invalid` covers "not yours", "unknown",
 * "already detached" (now owned by that fresh Person) and "inactive" alike (no existence oracle).
 */
export async function detachMyChannel(
  pool: pg.Pool,
  accountId: string,
  channelIdentityId: string,
): Promise<{ outcome: DetachOutcome }> {
  const { rows } = await pool.query<{ outcome: string }>(
    `SELECT outcome FROM channel_identity_detach($1::uuid, $2::uuid)`,
    [accountId, channelIdentityId],
  );
  return { outcome: rows[0]?.outcome === "detached" ? "detached" : "invalid" };
}
