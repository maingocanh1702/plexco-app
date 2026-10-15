import { randomUUID } from "node:crypto";
import { deriveEmailArtifacts, type DbHandle } from "@plexco/db";
import { keyedHash, resolveAuthSecretKey } from "../auth-secrets";
import {
  authKeyVersion,
  deriveAesKey,
  EMAIL_ENC_KEY_INFO,
  loginGoogle,
  type GoogleLoginResult,
} from "../oauth-transaction";
import { devPersonaSubjectInput, type DevPersona } from "./personas";

/**
 * Resolve a dev persona's account -> Person through THE SAME path the Google callback uses
 * (app/api/auth/google/callback/route.ts): keyed subject hash via keyedHash(), email artifacts via
 * deriveEmailArtifacts() with the same HMAC key, the same HKDF email-encryption key
 * (EMAIL_ENC_KEY_INFO) and the same key version, an app-preallocated account_emails id, then the
 * SECURITY DEFINER finalizer auth_login_google through the existing loginGoogle() wrapper. The
 * Google route files are not touched; every helper here is the one they import.
 *
 * Differences from the callback, both deliberate:
 *  - the subject input lives in the disjoint dev namespace (personas.ts);
 *  - displayName is the persona's fake label instead of null. The definer uses it only when it
 *    CREATES the Person (cell 1) and never overwrites an existing name (DD-26), and here it is not
 *    a provider claim but a fixture label.
 *
 * Side effects are the definer's own: the first resolution creates Person + Account + verified
 * account_emails + account_identities(platform 'google', dev-namespace hash); later ones mutate
 * nothing. EVERY call appends one auth_audit_events row: event_type 'login_success', outcome_class
 * 'success', actor_class 'google', request_ref = the caller's requestRef (dev_login_<uuid> from the
 * route, dev_seed_<uuid> from the seed). There is no 'auth.dev_login' event type without a migration.
 */
export async function resolveDevPersonaAccount(
  pool: DbHandle["pool"],
  persona: DevPersona,
  requestRef: string,
): Promise<GoogleLoginResult> {
  const subjectHash = await keyedHash(devPersonaSubjectInput(persona));
  const authSecret = await resolveAuthSecretKey();
  const kmsKeyVersion = authKeyVersion();
  const accountEmailId = randomUUID();
  const artifacts = deriveEmailArtifacts(persona.email, accountEmailId, {
    lookupHmacKey: authSecret,
    encKey: deriveAesKey(authSecret, EMAIL_ENC_KEY_INFO),
    kmsKeyVersion,
  });
  return loginGoogle(pool, {
    subjectHash,
    emailLookupHash: artifacts.emailLookupHash,
    emailEnc: artifacts.emailEnc,
    kmsKeyVersion,
    accountEmailId,
    displayName: persona.displayName,
    requestRef,
  });
}
