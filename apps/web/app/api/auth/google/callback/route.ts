import { randomUUID } from "node:crypto";
import { t } from "@plexco/core/i18n";
import { armOauthCompletionHandoff, deriveEmailArtifacts, InvalidEmailError } from "@plexco/db";
import { err } from "../../../../../lib/api-envelope";
import { log } from "../../../../../lib/log";
import { resolveAuthSecretKey, keyedHash } from "../../../../../lib/auth-secrets";
import { exchangeGoogleCode, verifyGoogleIdToken } from "../../../../../lib/google-oidc";
import {
  authKeyVersion,
  claimOauthTransaction,
  clearOauthBindingCookie,
  decryptPkceVerifier,
  deriveAesKey,
  EMAIL_ENC_KEY_INFO,
  loginGoogle,
  PKCE_ENC_KEY_INFO,
  readOauthBindingCookie,
  sha256Hex,
} from "../../../../../lib/oauth-transaction";
import {
  appDb,
  buildCompletionLanding,
  clientIp,
  HANDOFF_TTL_SECONDS,
  newHandoffToken,
  rateLimited,
} from "../../../../../lib/session-cookies";

/**
 * GET /api/auth/google/callback — the top-level cross-site redirect back from
 * Google (B0 §4.1, tech §4). It is NOT same-origin, so it deliberately does
 * NOT call `sameOriginRequest()` and does not require Origin/Referer (D1-13);
 * browser continuity is proven instead by the one-time state + the path-scoped
 * Lax binding cookie + the single-use transaction claim + PKCE/nonce.
 *
 * Order (§8.2/§4.1): independent `oauth-callback` trusted-IP bucket (10/min,
 * distinct from `oauth-state` — D1-11) → config gate → match query state to the
 * cookie state → atomically CLAIM the transaction (single-use — D1-3; missing/
 * mismatched binding → D1-4) → decrypt the PKCE verifier → exchange the code →
 * verify the FULL OIDC proof matrix (cell 8 rejects here, BEFORE any DB write,
 * no audit — D1-5) → derive the keyed subject + email artifacts (app-preallocated
 * id) → run the §4 collision finalizer. On `login_success` the callback does NOT
 * mint here (the Strict cookie is absent cross-site so it could not rotate a
 * pre-existing session — auth-s4-d1b): it ARMS a single-use handoff and returns
 * the M3 completion landing that hops same-site to /complete, where issueSession()
 * runs its rotate branch. `identity_conflict` fails closed to AUTH_IDENTITY_CONFLICT
 * (→ DD-53 — D1-8). Every response is `Referrer-Policy: no-referrer` and loads
 * nothing third-party; the code/state/nonce/verifier/handoff are never logged.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    return await handleGoogleCallback(request);
  } catch (error) {
    // Never let Next emit a 500 without the leakage fence while the request URL
    // still carries the OAuth code/state (§4.1 — codex round-01 [P2]). Any
    // unexpected dependency failure (rate-limit store down, KMS/DB throw) fails
    // closed to the home page with a generic error and no referrer.
    // The RESPONSE stays generic; the LOG says which dependency failed (audit
    // 2026-09-06 W-11: an outage was indistinguishable from bad input). The
    // logger reduces the error to name/message and never sees the request.
    log.error("auth.google.callback.unhandled", { error });
    const base = process.env.APP_BASE_URL?.trim() ?? "";
    return new Response(null, {
      status: 302,
      headers: {
        location: `${base}/?auth_error=AUTH_UNAVAILABLE`,
        "referrer-policy": "no-referrer",
      },
    });
  }
}

async function handleGoogleCallback(request: Request): Promise<Response> {
  const provider = "google" as const;
  const ip = clientIp(request);
  if (await rateLimited(`oauth-callback:${ip}`)) {
    return noReferrer(
      err(
        "LOGIN_RATE_LIMITED",
        t("Quá nhiều lần thử — đợi một phút.", "Too many attempts — wait a minute."),
        429,
      ),
    );
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!clientId || !clientSecret || !baseUrl) {
    return noReferrer(
      err(
        "AUTH_UNAVAILABLE",
        t("Đăng nhập Google chưa được cấu hình.", "Google login is not configured."),
        503,
      ),
    );
  }
  // Failures redirect to the home page (an IMPLEMENTED surface — there is no
  // /login route yet) with a generic error param (codex round-01 [P2]).
  const fail = (code: string): Response =>
    redirect(`${baseUrl}/?auth_error=${encodeURIComponent(code)}`);

  const url = new URL(request.url);
  const queryState = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const cookie = await readOauthBindingCookie(provider);

  // Browser continuity: the cookie and query state must both be present and the
  // query state must equal the cookie state (missing/mismatched binding — D1-4).
  // Do NOT clear the cookie on a mismatch: a stale or foreign top-level callback
  // (e.g. flow A's callback arriving after flow B overwrote this browser's
  // cookie, or an arbitrary attacker GET) must not cancel the in-progress login
  // whose binding this cookie holds (codex round-03 [P2]).
  if (!cookie || !queryState || !code || queryState !== cookie.state) {
    return fail("AUTH_INVALID");
  }
  // The cookie belongs to THIS flow (state matches) — consume it single-use so a
  // used/failed binding is never retried.
  await clearOauthBindingCookie(provider);

  const stateHash = sha256Hex(cookie.state);
  const bindingHash = sha256Hex(cookie.binding);

  // Single-use claim: exact state + provider + binding + unexpired + unconsumed.
  // A replay (D1-3) or a binding mismatch returns null → zero mutation.
  const claim = await claimOauthTransaction(appDb().pool, {
    stateHash,
    provider,
    browserBindingHash: bindingHash,
  });
  if (!claim || !claim.pkceVerifierEnc || !claim.kmsKeyVersion || !claim.nonceHash) {
    return fail("AUTH_INVALID");
  }

  let verifier: string;
  try {
    const encKey = deriveAesKey(await resolveAuthSecretKey(), PKCE_ENC_KEY_INFO);
    verifier = decryptPkceVerifier(claim.pkceVerifierEnc, {
      encKey,
      stateHash,
      provider,
      kmsKeyVersion: claim.kmsKeyVersion,
    });
  } catch {
    return fail("AUTH_INVALID"); // tampered/corrupt ciphertext
  }

  const redirectUri = `${baseUrl}/api/auth/google/callback`;
  const idToken = await exchangeGoogleCode({
    code,
    codeVerifier: verifier,
    clientId,
    clientSecret,
    redirectUri,
  });
  if (!idToken) return fail("AUTH_INVALID");

  // Full OIDC proof matrix (cell 8 — pre-DB reject, no audit row — D1-5).
  const proof = await verifyGoogleIdToken({
    idToken,
    clientId,
    expectedNonceHash: claim.nonceHash,
  });
  if (!proof.ok) return fail(proof.reason);

  // Keyed identity subject (SI-2: version+provider+subject) and email artifacts.
  // account_emails.id is PREALLOCATED so the ciphertext AAD binds to it (v1.86).
  const subjectHash = await keyedHash(`plexco:web-auth:v1:google:${proof.subject}`);
  const authSecret = await resolveAuthSecretKey();
  const kmsKeyVersion = authKeyVersion();
  const accountEmailId = randomUUID();
  let artifacts;
  try {
    artifacts = deriveEmailArtifacts(proof.email, accountEmailId, {
      // HMAC key: the raw auth secret (any length is fine, and order-4 email
      // login must resolve the identical lookup hash). Enc key: a fixed 32-byte
      // HKDF key (deriveEmailArtifacts requires exactly 32 — codex round-02 [P1]).
      lookupHmacKey: authSecret,
      encKey: deriveAesKey(authSecret, EMAIL_ENC_KEY_INFO),
      kmsKeyVersion,
    });
  } catch (error) {
    // Google should never return a malformed address, but fail closed if so.
    if (error instanceof InvalidEmailError) return fail("AUTH_INVALID");
    throw error;
  }

  // §4 collision finalizer (cells 1-6 login_success / cell 7 identity_conflict).
  const login = await loginGoogle(appDb().pool, {
    subjectHash,
    emailLookupHash: artifacts.emailLookupHash,
    emailEnc: artifacts.emailEnc,
    kmsKeyVersion,
    accountEmailId,
    displayName: null, // DD-26: no silent name persist from a provider claim
    requestRef: `oauth_${randomUUID()}`,
  });

  if (login.outcome === "identity_conflict") {
    return fail("AUTH_IDENTITY_CONFLICT"); // → DD-53, no session, no handoff (D1-8)
  }

  // M3 completion hop (auth-s4-d1b, D1B-1): the Strict plx_session is NOT sent on
  // this cross-site callback, so we CANNOT read/rotate a pre-existing session
  // here — the callback does not mint. Arm a single-use, short-TTL handoff bound
  // to THIS oauth transaction (durable server-side fence, 0018), then return a
  // first-party landing that auto-submits a same-origin POST to /complete, where
  // the Strict cookie IS present and issueSession() takes its existing rotate
  // branch. A bare 302 would NOT carry the cookie (probe M1) — return a document.
  const handoff = newHandoffToken();
  const armed = await armOauthCompletionHandoff(appDb().pool, {
    stateHash,
    handoffHash: handoff.tokenHash,
    resolvedAccountId: login.accountId,
    ttlSeconds: HANDOFF_TTL_SECONDS,
  });
  // Should never fail — we just single-use claimed this exact row above — but
  // fail closed rather than emit a landing with no live handoff behind it.
  if (!armed) return fail("AUTH_INVALID");
  const landing = buildCompletionLanding(handoff.token);
  return new Response(landing.body, { status: 200, headers: landing.headers });
}

/** 302 redirect that leaks no referrer (the callback URL carries code/state). */
function redirect(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location, "referrer-policy": "no-referrer" },
  });
}

function noReferrer(response: Response): Response {
  response.headers.set("referrer-policy", "no-referrer");
  return response;
}
