import { openAesGcm, sealAesGcm } from "./connector-crypto.js";
import { authKeyVersion, deriveAesKey, resolveAuthSecretKey } from "./secret-key-root.js";

/**
 * Person gender crypto (DD-39; readiness p3-m9-gender-pricing 4.3). The self-declared value is stored
 * only as ciphertext in persons.gender_enc, next to persons.gender_key_version.
 *
 * Key: HKDF(auth secret root, info `plexco:person-gender-enc:v1`): the shared ENCRYPTION_KEY / KMS auth
 * root, never the DD-122 O4 connector root, no new secret; the distinct label keeps it apart from the
 * PKCE, email and connector keys. Envelope: the shared `iv(12) || tag(16) || ct` of connector-crypto.ts.
 * AAD `plexco:person-gender-aad:v1:<person_id>`, so a blob copied onto another person fails GCM auth.
 *
 * openPersonGender never throws: every failure is `{ ok: false }`, which the charge path turns into
 * CHARGE_DERIVATION_UNAVAILABLE (never a fallback price) and the self-read into a generic 500. No
 * message, log line or return value carries the plaintext, the ciphertext or the key version.
 */
export type Gender = "male" | "female" | "other" | "undisclosed";

// Mirrors GENDER_VALUES in packages/core/src/api-contract.ts: packages/db does not depend on @plexco/core.
const GENDERS: ReadonlySet<string> = new Set(["male", "female", "other", "undisclosed"]);
const GENDER_KEY_INFO = "plexco:person-gender-enc:v1";
const MIN_BLOB_BYTES = 12 + 16 + 1;

/** The fixed message of the Error the self-read raises on `{ ok: false }` (U-12): no person data. */
export const GENDER_OPEN_FAILED = "gender ciphertext could not be opened";

const aad = (personId: string) => Buffer.from(`plexco:person-gender-aad:v1:${personId}`, "utf8");

async function genderKey(): Promise<Buffer> {
  return deriveAesKey(await resolveAuthSecretKey(), GENDER_KEY_INFO);
}

export async function encryptPersonGender(
  personId: string,
  gender: Gender,
): Promise<{ enc: Buffer; keyVersion: string }> {
  const enc = sealAesGcm(await genderKey(), Buffer.from(gender, "utf8"), aad(personId));
  return { enc, keyVersion: authKeyVersion() };
}

/** Checks the stored key version BEFORE any open (a NULL version never matches); KMS errors fail too. */
export async function openPersonGender(
  personId: string,
  enc: Buffer,
  keyVersion: string | null,
): Promise<{ ok: true; gender: Gender } | { ok: false }> {
  if (keyVersion !== authKeyVersion() || enc.length < MIN_BLOB_BYTES) return { ok: false };
  try {
    const value = openAesGcm(await genderKey(), enc, aad(personId)).toString("utf8");
    return GENDERS.has(value) ? { ok: true, gender: value as Gender } : { ok: false };
  } catch {
    return { ok: false };
  }
}
