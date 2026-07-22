import { randomBytes } from "node:crypto";
import { t } from "@plexco/core/i18n";
import { resolveAuthSecretKey } from "../../../../../lib/auth-secrets";
import { err } from "../../../../../lib/api-envelope";
import { buildGoogleAuthorizeUrl } from "../../../../../lib/google-oidc";
import {
  authKeyVersion,
  deriveAesKey,
  encryptPkceVerifier,
  issueOauthTransaction,
  newOauthContinuity,
  newPkce,
  OAUTH_TXN_TTL_SECONDS,
  PKCE_ENC_KEY_INFO,
  setOauthBindingCookie,
  sha256Hex,
} from "../../../../../lib/oauth-transaction";
import { appDb, clientIp, rateLimited } from "../../../../../lib/session-cookies";

/**
 * GET /api/auth/google/state — start the Google OIDC redirect flow (B0 §4.1,
 * tech §3/§4). The trusted-IP rate bucket runs BEFORE any row/cookie (§8.2:
 * shared `oauth-state:<ip>` 10/min across Google+Facebook, limiter/storage
 * failure creates neither — D1-1). Then: generate one-time state + browser
 * binding + nonce + S256 PKCE; encrypt the verifier at rest; store the
 * transaction row; set a provider-scoped `SameSite=Lax` binding cookie at the
 * exact callback path (NOT the session cookie, NOT the Strict Telegram
 * login-state cookie); and redirect to Google. The raw nonce leaves the server
 * only in the authorization URL — only its hash is stored.
 */
export async function GET(request: Request): Promise<Response> {
  const provider = "google" as const;
  const ip = clientIp(request);
  // Fail closed if the rate-limit store is unavailable: a limiter/storage outage
  // must still return the bounded 429, never a Next 500 that creates neither row
  // nor cookie (§8.2 "limiter/storage failure creates neither" — codex round-06 [P2]).
  let limited: boolean;
  try {
    limited = await rateLimited(`oauth-state:${ip}`);
  } catch {
    limited = true;
  }
  if (limited) {
    return err(
      "LOGIN_RATE_LIMITED",
      t("Quá nhiều lần thử — đợi một phút.", "Too many attempts — wait a minute."),
      429,
    );
  }

  // Require the FULL config up front (incl. the client secret the callback needs
  // — codex round-03 [P2]): partial config must fail here, before creating a
  // transaction/cookie and redirecting the user to Google only for every
  // callback to then return AUTH_UNAVAILABLE.
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();
  const baseUrl = process.env.APP_BASE_URL?.trim();
  if (!clientId || !clientSecret || !baseUrl) {
    return err(
      "AUTH_UNAVAILABLE",
      t("Đăng nhập Google chưa được cấu hình.", "Google login is not configured."),
      503,
    );
  }

  const { state, binding, stateHash, bindingHash } = newOauthContinuity();
  const nonce = randomBytes(32).toString("base64url");
  const { verifier, challenge } = newPkce();

  const encKey = deriveAesKey(await resolveAuthSecretKey(), PKCE_ENC_KEY_INFO);
  const kmsKeyVersion = authKeyVersion();
  const pkceVerifierEnc = encryptPkceVerifier(verifier, {
    encKey,
    stateHash,
    provider,
    kmsKeyVersion,
  });

  await issueOauthTransaction(appDb().pool, {
    stateHash,
    provider,
    browserBindingHash: bindingHash,
    nonceHash: sha256Hex(nonce),
    pkceVerifierEnc,
    kmsKeyVersion,
    ttlSeconds: OAUTH_TXN_TTL_SECONDS,
  });

  await setOauthBindingCookie(provider, { state, binding });

  const authorizeUrl = buildGoogleAuthorizeUrl({
    clientId,
    redirectUri: `${baseUrl}/api/auth/google/callback`,
    state,
    nonce,
    codeChallenge: challenge,
  });
  // 302 top-level redirect to Google; the Lax cookie set above rides along.
  return new Response(null, { status: 302, headers: { location: authorizeUrl } });
}
