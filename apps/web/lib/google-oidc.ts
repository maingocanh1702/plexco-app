import { createHash } from "node:crypto";
import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";

/**
 * Google OIDC proof matrix (DD-50 · B0 §2/§4 · tech §4 "Google OIDC proof
 * matrix"). The callback accepts an identity ONLY when EVERY cell passes:
 * provider signature against the rotating JWKS; exact configured `iss`; exact
 * client-id `aud` (and `azp` when the token carries it); `exp`/`iat` freshness;
 * a stable `sub`; the browser-bound `nonce`; and `email_verified === true`.
 *
 * PURE proof — no DB, no session, no app-secret. The JWKS resolver is injected
 * (a module singleton against Google's certs in production; a local key set in
 * tests) so the whole matrix runs offline (D1-5 is table-driven, one row per
 * failing cell). Every failure collapses to a GENERIC reason — `AUTH_STALE`
 * only for an expired/not-yet-valid token, `AUTH_INVALID` for everything else —
 * so the callback never signals WHICH cell failed.
 */

export const GOOGLE_ISSUERS = ["https://accounts.google.com", "accounts.google.com"] as const;
const GOOGLE_JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
/** Hard cap on the server-to-server token exchange (the transaction is already
 * claimed, so a stalled provider must not hold the callback open). */
const TOKEN_EXCHANGE_TIMEOUT_MS = 10_000;
/** Small allowance for clock skew between this server and Google (exp/iat). */
const CLOCK_TOLERANCE = "30s";
/**
 * Max age of the id_token by `iat` — the whole redirect flow lives inside the
 * 10-minute transaction TTL, so a token issued longer ago than this is stale.
 * With `requiredClaims` this also rejects a token whose `iat` is in the FUTURE
 * beyond the clock tolerance (jose validates both bounds under maxTokenAge).
 */
const MAX_TOKEN_AGE = "10m";

export type GoogleProofResult =
  | { ok: true; subject: string; email: string }
  | { ok: false; reason: "AUTH_INVALID" | "AUTH_STALE" };

let cachedJwks: JWTVerifyGetKey | null = null;
/** Lazy singleton JWKS resolver — jose caches + rotates Google's signing keys. */
function googleJwks(): JWTVerifyGetKey {
  if (!cachedJwks) cachedJwks = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));
  return cachedJwks;
}

/**
 * Verify a Google `id_token` against the full proof matrix. `clientId` is the
 * exact configured OAuth client id (checked as `aud`, and as `azp` when
 * present); `expectedNonceHash` is `sha256(nonce)` read back from the claimed
 * transaction row — the raw nonce is NEVER persisted, so verification hashes the
 * token's nonce and compares (the row single-use — D1-3 — makes it one-shot).
 * `jwks` defaults to the Google singleton; tests inject a local key set.
 */
export async function verifyGoogleIdToken(
  input: { idToken: string; clientId: string; expectedNonceHash: string },
  jwks: JWTVerifyGetKey = googleJwks(),
): Promise<GoogleProofResult> {
  let payload: JWTPayload;
  try {
    // Signature + exact iss + exact aud + exp/nbf freshness in one step. A bad
    // signature, wrong issuer, wrong audience, or expired token all throw here.
    // requiredClaims forces exp AND iat to be present (jose does not require
    // them by default), and maxTokenAge enforces iat freshness + rejects a
    // future-dated iat (codex round-01 [P2]).
    ({ payload } = await jwtVerify(input.idToken, jwks, {
      // Google signs ID tokens with RS256 only; pinning it removes the whole "which algorithm
      // does the header claim" surface (audit 2026-09-06 W-13). A JWKS of RSA keys already makes
      // HS256/none unworkable in jose; the explicit list makes that a stated property.
      algorithms: ["RS256"],
      issuer: [...GOOGLE_ISSUERS],
      audience: input.clientId,
      clockTolerance: CLOCK_TOLERANCE,
      requiredClaims: ["exp", "iat"],
      maxTokenAge: MAX_TOKEN_AGE,
    }));
  } catch (error) {
    // Only an EXPIRED token is "stale"; everything else jose throws here
    // (signature, wrong iss, wrong aud — all ERR_JWT_CLAIM_VALIDATION_FAILED /
    // signature errors) is a generic invalid.
    const code = (error as { code?: string }).code;
    return { ok: false, reason: code === "ERR_JWT_EXPIRED" ? "AUTH_STALE" : "AUTH_INVALID" };
  }

  // iat freshness — the future side. jose's maxTokenAge above rejects a token
  // that is too OLD (and requiredClaims forces iat present); this closes the
  // FUTURE side explicitly (codex round-01 [P2]) rather than relying on library
  // internals: an iat beyond the clock-skew tolerance ahead of now is rejected.
  if (typeof payload.iat === "number" && payload.iat > Math.floor(Date.now() / 1000) + 30) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  // azp (authorized party): jwtVerify above already proved `clientId` is in the
  // token's `aud`. OIDC additionally REQUIRES azp when the token is
  // MULTI-audience (aud is an array with more than one value): without it a
  // token minted for another client but also listing us would pass (codex
  // round-02 [P2]). And any azp that IS present must equal the client id.
  const audIsMultiValued = Array.isArray(payload.aud) && payload.aud.length > 1;
  if (audIsMultiValued && payload.azp === undefined) {
    return { ok: false, reason: "AUTH_INVALID" };
  }
  if (payload.azp !== undefined && payload.azp !== input.clientId) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  // nonce: hash the token's nonce and match the stored hash. A missing or
  // mismatched nonce fails closed — no CSRF/replay continuity.
  if (
    typeof payload.nonce !== "string" ||
    createHash("sha256").update(payload.nonce).digest("hex") !== input.expectedNonceHash
  ) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  // stable subject.
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  // email_verified === true (strict boolean — a string "true" or missing flag
  // is NOT proof, DD-50) and a present email.
  if (
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    payload.email.length === 0
  ) {
    return { ok: false, reason: "AUTH_INVALID" };
  }

  return { ok: true, subject: payload.sub, email: payload.email };
}

/**
 * Build the Google authorization redirect URL (OIDC code flow + S256 PKCE).
 * Called by the state route AFTER the transaction row + Lax binding cookie are
 * in place. Scope is the minimal `openid email`; `prompt=select_account` so a
 * returning user can pick the account. Origin/redirect_uri come from fixed
 * config, never the Host header (§8.4).
 */
export function buildGoogleAuthorizeUrl(input: {
  clientId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email");
  url.searchParams.set("state", input.state);
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  return url.toString();
}

/**
 * Exchange the authorization `code` for the `id_token` at Google's token
 * endpoint (server-to-server; carries the PKCE `code_verifier` + client secret).
 * Returns the raw id_token, or null on any non-200 / missing-token response —
 * the caller maps null to a generic reject. Never logs the code/verifier/token.
 */
export async function exchangeGoogleCode(input: {
  code: string;
  codeVerifier: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    code_verifier: input.codeVerifier,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
  });
  let response: Response;
  try {
    response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body,
      // Bounded — a provider that stalls mid-response otherwise holds the
      // already-claimed callback open until a platform timeout (codex round-03
      // [P2]); AbortSignal.timeout rejects the fetch, which we map to null.
      signal: AbortSignal.timeout(TOKEN_EXCHANGE_TIMEOUT_MS),
    });
  } catch {
    return null; // network failure / timeout — fail closed
  }
  if (!response.ok) return null;
  const json = (await response.json().catch(() => null)) as { id_token?: unknown } | null;
  return json && typeof json.id_token === "string" ? json.id_token : null;
}
