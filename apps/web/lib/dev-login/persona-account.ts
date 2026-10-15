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
 * nothing.
 *
 * AUDIT, precisely. EVERY call appends one durable auth_audit_events row, written by the definer
 * and indistinguishable in shape from a real Google login: event_type 'login_success',
 * outcome_class 'success', actor_class 'google'. ONLY request_ref says it was a dev persona:
 *   dev_login_<uuid>  a dev-login (one per successful POST);
 *   dev_seed_<uuid>   a `pnpm dev:seed` run (one per persona per run, i.e. 3 rows for "logins"
 *                     that never happened). app has no read-only path to an identity (every
 *                     app-callable identity function writes), so the seed cannot skip the call.
 * A dedicated 'auth.dev_login' event type would need a migration (no grant lets app write the
 * table); the owner declined that migration (auth_audit_dev_login) on 2026-10-15, so the shape above
 * is a known limitation.
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
