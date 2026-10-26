import type pg from "pg";
import {
  encryptPersonGender,
  GENDER_OPEN_FAILED,
  openPersonGender,
  type Gender,
} from "./gender-crypto.js";
import {
  DISPLAY_NAME_MAX,
  hasHiddenChar,
  hasVisibleChar,
  stripInvisibleChars,
} from "./text-safety.js";

/**
 * Signed-in user's own settings (lane M4): profile display name + linked channels + unlink, plus the
 * DD-39 self-declared gender and pricing consent through the 0062 self definers (same account key).
 * Tenant-less and account-scoped: `persons` / `channel_identities` are global protected tables, so
 * everything goes through the 0055 SECURITY DEFINER functions keyed by the ACCOUNT id taken from the
 * session. No function takes a person id; no encrypted platform id, username or lookup hash is ever
 * selected. Detach is naturally idempotent: a repeat finds the identity owned by the fresh Person the
 * first call minted (not "inactive": detach leaves the status as it was) and answers `invalid` (the
 * route maps it to 409), so no command id is stored.
 */
export { DISPLAY_NAME_MAX };

export class DisplayNameError extends Error {
  constructor() {
    super(`display name must be 1-${DISPLAY_NAME_MAX} printable characters`);
    this.name = "DisplayNameError";
  }
}

/**
 * Same rule as 0069 person_profile_update (L27): strip first (stripInvisibleChars, the one shared list
 * in text-safety.ts), then trim, then 1..120 CODE POINTS measured on the stripped value, no hidden
 * character (hasHiddenChar), at least one visible one (hasVisibleChar). Returns the stripped, trimmed
 * value or throws: a value with nothing visible left after the strip is refused like an empty one.
 */
export function validateDisplayName(raw: unknown): string {
  if (typeof raw !== "string") throw new DisplayNameError();
  const name = stripInvisibleChars(raw).trim();
  const length = [...name].length;
  if (length < 1 || length > DISPLAY_NAME_MAX || hasHiddenChar(name) || !hasVisibleChar(name)) {
    throw new DisplayNameError();
  }
  return name;
}

/** The stored gender could not be opened (U-12): a fixed message, never a guessed value. */
export class GenderOpenError extends Error {
  constructor() {
    super(GENDER_OPEN_FAILED);
    this.name = "GenderOpenError";
  }
}

/** A gender outside the DD-39 value set; the message never echoes the input. */
export class InvalidGenderError extends Error {
  constructor() {
    super("gender must be one of the declared values");
    this.name = "InvalidGenderError";
  }
}

const GENDER_VALUES: Record<Gender, true> = {
  male: true,
  female: true,
  other: true,
  undisclosed: true,
};

export interface MyProfile {
  displayName: string | null;
  /** Plaintext exists only in this self-read DTO (DD-39): never logged, never in another DTO. */
  gender: Gender | null;
  genderConsent: boolean;
}

/** DD-39 fields of a profile update: undefined = absent (keep the stored value), gender null = erase. */
export interface MyGenderFields {
  gender?: Gender | null;
  genderConsent?: boolean;
}

export interface MyChannel {
  channelIdentityId: string;
  platform: string;
  status: "active" | "inactive";
  createdAt: Date;
}

export type DetachOutcome = "detached" | "invalid";

interface GenderRow {
  person_id: string;
  gender_enc: Buffer | null;
  gender_key_version: string | null;
  gender_pricing_consent: boolean;
}

/**
 * The account's Person profile; null when the account has no active Person. A stored gender that
 * cannot be opened throws GenderOpenError (generic 500), never `gender: null`.
 */
export async function readMyProfile(
  db: pg.Pool | pg.PoolClient,
  accountId: string,
): Promise<MyProfile | null> {
  const { rows } = await db.query(
    `SELECT r.display_name, g.person_id, g.gender_enc, g.gender_key_version, g.gender_pricing_consent
       FROM person_profile_read($1::uuid) r
       JOIN person_gender_read($1::uuid) g ON g.person_id = r.person_id`,
    [accountId],
  );
  const row = rows[0] as (GenderRow & { display_name: string | null }) | undefined;
  if (!row) return null;
  let gender: Gender | null = null;
  if (row.gender_enc !== null) {
    const opened = await openPersonGender(row.person_id, row.gender_enc, row.gender_key_version);
    if (!opened.ok) throw new GenderOpenError();
    gender = opened.gender;
  }
  return { displayName: row.display_name, gender, genderConsent: row.gender_pricing_consent };
}

/**
 * ONE transaction: the display name (when sent) through person_profile_update, then the gender triple
 * through person_gender_update pinned to the Person read in this transaction. An absent field keeps
 * its stored value, gender null erases, and consent never outlives the ciphertext. null (route 404)
 * when the account has no active Person, was relinked meanwhile, or a concurrent PATCH of it
 * committed between this snapshot and the write (40001, nothing written). The reply is the in-transaction
 * re-read, so a stored blob that cannot be opened rolls everything back (GenderOpenError).
 */
export async function updateMyProfile(
  pool: pg.Pool,
  accountId: string,
  displayName: unknown,
  fields: MyGenderFields = {},
): Promise<MyProfile | null> {
  const name = displayName === undefined ? undefined : validateDisplayName(displayName);
  const { gender } = fields;
  if (gender != null && (typeof gender !== "string" || !Object.hasOwn(GENDER_VALUES, gender))) {
    throw new InvalidGenderError();
  }
  const client = await pool.connect();
  let broken: Error | undefined;
  try {
    // REPEATABLE READ: the triple read below is written back for absent fields, so a PATCH of this
    // account committed after our snapshot must fail ours (40001), never be silently overwritten.
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
    const profile = await writeProfile(client, accountId, name, fields);
    await client.query(profile ? "COMMIT" : "ROLLBACK");
    return profile;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackError) {
      broken = rollbackError as Error; // a dead connection must not go back to the pool
    }
    // serialization_failure: a concurrent PATCH or a relink won; rolled back whole => route 404.
    if ((error as { code?: string }).code === "40001") return null;
    throw error;
  } finally {
    client.release(broken);
  }
}

async function writeProfile(
  client: pg.PoolClient,
  accountId: string,
  name: string | undefined,
  fields: MyGenderFields,
): Promise<MyProfile | null> {
  if (name !== undefined) {
    const named = await client.query(`SELECT 1 FROM person_profile_update($1::uuid, $2::text)`, [
      accountId,
      name,
    ]);
    if (named.rows.length === 0) return null;
  }
  const read = await client.query(
    `SELECT person_id, gender_enc, gender_key_version, gender_pricing_consent
       FROM person_gender_read($1::uuid)`,
    [accountId],
  );
  const stored = read.rows[0] as GenderRow | undefined;
  if (!stored) return null;
  const sealed =
    fields.gender === undefined
      ? { enc: stored.gender_enc, keyVersion: stored.gender_key_version }
      : fields.gender === null
        ? { enc: null, keyVersion: null }
        : await encryptPersonGender(stored.person_id, fields.gender);
  const consent = sealed.enc !== null && (fields.genderConsent ?? stored.gender_pricing_consent);
  const written = await client.query(
    `SELECT person_id FROM person_gender_update($1::uuid, $2::uuid, $3::bytea, $4::text, $5::boolean)`,
    [accountId, stored.person_id, sealed.enc, sealed.keyVersion, consent],
  );
  if (written.rows.length === 0) return null;
  return readMyProfile(client, accountId);
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
