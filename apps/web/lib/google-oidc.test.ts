import { createHash } from "node:crypto";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { verifyGoogleIdToken } from "./google-oidc";

/**
 * D1-5 — the Google OIDC proof matrix, fully OFFLINE: a locally-generated RS256
 * key signs test id_tokens and the JWKS resolver is a local key set, so every
 * proof cell (signature, iss, aud, azp, exp, nonce, sub, email_verified) is
 * exercised without touching the network. Table-driven — one row per failing
 * cell (B0 §2/§4, DD-50).
 */

const CLIENT_ID = "test-client.apps.googleusercontent.com";
const RAW_NONCE = "nonce-raw-9f3c";
const NONCE_HASH = createHash("sha256").update(RAW_NONCE).digest("hex");
const KID = "test-kid-1";

let signingKey: KeyLike;
let otherKey: KeyLike;
let jwks: JWTVerifyGetKey;

beforeAll(async () => {
  const kp = await generateKeyPair("RS256");
  signingKey = kp.privateKey;
  const pubJwk = await exportJWK(kp.publicKey);
  pubJwk.kid = KID;
  pubJwk.alg = "RS256";
  jwks = createLocalJWKSet({ keys: [pubJwk] });
  // a second key whose public half is NOT in the JWKS — for the bad-signature cell.
  otherKey = (await generateKeyPair("RS256")).privateKey;
});

interface Claims {
  iss?: string;
  aud?: string | string[];
  azp?: string;
  sub?: string;
  email?: string;
  email_verified?: unknown;
  nonce?: string;
}

function validClaims(overrides: Partial<Claims> = {}): Claims {
  return {
    iss: "https://accounts.google.com",
    aud: CLIENT_ID,
    azp: CLIENT_ID,
    sub: "google-sub-123",
    email: "user@example.com",
    email_verified: true,
    nonce: RAW_NONCE,
    ...overrides,
  };
}

async function sign(
  claims: Claims,
  opts: { key?: KeyLike; expSeconds?: number | null; iatSeconds?: number | null } = {},
): Promise<string> {
  // Drop undefined keys so `sub: undefined` etc. produce an ABSENT claim.
  const payload = Object.fromEntries(Object.entries(claims).filter(([, v]) => v !== undefined));
  const nowSec = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT(payload).setProtectedHeader({ alg: "RS256", kid: KID });
  // iat: default now; `null` = omit; number = exact.
  if (opts.iatSeconds !== null) jwt = jwt.setIssuedAt(opts.iatSeconds ?? nowSec);
  // exp: default now+1h; `null` = omit; number = exact.
  if (opts.expSeconds !== null) jwt = jwt.setExpirationTime(opts.expSeconds ?? nowSec + 3600);
  return jwt.sign(opts.key ?? signingKey);
}

const verify = (idToken: string) =>
  verifyGoogleIdToken({ idToken, clientId: CLIENT_ID, expectedNonceHash: NONCE_HASH }, jwks);

describe("verifyGoogleIdToken — happy path", () => {
  it("D1-5: a fully-valid id_token passes and returns the subject + email", async () => {
    const res = await verify(await sign(validClaims()));
    expect(res).toEqual({ ok: true, subject: "google-sub-123", email: "user@example.com" });
  });

  it("D1-5: azp ABSENT is allowed for a SINGLE-audience token", async () => {
    const res = await verify(await sign(validClaims({ azp: undefined })));
    expect(res.ok).toBe(true);
  });

  it("D1-5: a MULTI-audience token WITH the correct azp is accepted", async () => {
    const res = await verify(
      await sign(
        validClaims({ aud: [CLIENT_ID, "other.apps.googleusercontent.com"], azp: CLIENT_ID }),
      ),
    );
    expect(res).toEqual({ ok: true, subject: "google-sub-123", email: "user@example.com" });
  });
});

describe("verifyGoogleIdToken — proof matrix negatives (D1-5, table-driven)", () => {
  const rows: { name: string; claims: Partial<Claims>; reason: "AUTH_INVALID" | "AUTH_STALE" }[] = [
    { name: "wrong iss", claims: { iss: "https://evil.example.com" }, reason: "AUTH_INVALID" },
    {
      name: "wrong aud",
      claims: { aud: "other-client.apps.googleusercontent.com" },
      reason: "AUTH_INVALID",
    },
    {
      name: "azp mismatch",
      claims: { azp: "other-client.apps.googleusercontent.com" },
      reason: "AUTH_INVALID",
    },
    { name: "wrong nonce", claims: { nonce: "a-different-nonce" }, reason: "AUTH_INVALID" },
    { name: "missing nonce", claims: { nonce: undefined }, reason: "AUTH_INVALID" },
    { name: "email_verified=false", claims: { email_verified: false }, reason: "AUTH_INVALID" },
    {
      name: "email_verified missing",
      claims: { email_verified: undefined },
      reason: "AUTH_INVALID",
    },
    {
      name: 'email_verified string "true" (strict boolean)',
      claims: { email_verified: "true" },
      reason: "AUTH_INVALID",
    },
    { name: "missing sub", claims: { sub: undefined }, reason: "AUTH_INVALID" },
    { name: "missing email", claims: { email: undefined }, reason: "AUTH_INVALID" },
  ];

  for (const row of rows) {
    it(`D1-5: ${row.name} → ${row.reason}, no identity`, async () => {
      const res = await verify(await sign(validClaims(row.claims)));
      expect(res).toEqual({ ok: false, reason: row.reason });
    });
  }

  it("D1-5: an EXPIRED id_token → AUTH_STALE", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const res = await verify(await sign(validClaims(), { expSeconds: nowSec - 60 }));
    expect(res).toEqual({ ok: false, reason: "AUTH_STALE" });
  });

  it("D1-5: a token with NO exp claim → AUTH_INVALID (exp is required)", async () => {
    const res = await verify(await sign(validClaims(), { expSeconds: null }));
    expect(res).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("D1-5: a token with NO iat claim → AUTH_INVALID (iat is required)", async () => {
    const res = await verify(await sign(validClaims(), { iatSeconds: null }));
    expect(res).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("D1-5: a FUTURE-dated iat (beyond skew) → AUTH_INVALID", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const res = await verify(
      await sign(validClaims(), { iatSeconds: nowSec + 3600, expSeconds: nowSec + 7200 }),
    );
    expect(res).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("D1-5: a STALE iat older than the max token age (exp still valid) → AUTH_STALE", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    // iat 20 min ago but exp 40 min out — exp is fine; maxTokenAge (10m) rejects.
    // jose surfaces a too-old token as ERR_JWT_EXPIRED, which maps to AUTH_STALE
    // (a stale token, not a structurally invalid one).
    const res = await verify(
      await sign(validClaims(), { iatSeconds: nowSec - 1200, expSeconds: nowSec + 2400 }),
    );
    expect(res).toEqual({ ok: false, reason: "AUTH_STALE" });
  });

  it("D1-5: a token signed by a key NOT in the JWKS (bad signature) → AUTH_INVALID", async () => {
    const res = await verify(await sign(validClaims(), { key: otherKey }));
    expect(res).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });

  it("D1-5: a MULTI-audience token that OMITS azp → AUTH_INVALID (OIDC requires azp)", async () => {
    const res = await verify(
      await sign(
        validClaims({ aud: [CLIENT_ID, "other.apps.googleusercontent.com"], azp: undefined }),
      ),
    );
    expect(res).toEqual({ ok: false, reason: "AUTH_INVALID" });
  });
});

/**
 * Audit 2026-09-06 W-13 — the verifier pins `algorithms: ["RS256"]`. A token signed with a
 * different family (here PS256 — a real algorithm jose would otherwise accept for an RSA key,
 * unlike the JWKS-refused HS256/none) is rejected as a generic AUTH_INVALID, and the assertion
 * checks the FAILING token's header so the test cannot pass by accident.
 */
describe("verifyGoogleIdToken — algorithm pin (audit W-13)", () => {
  it("rejects a token whose header claims an algorithm other than RS256, even when the key would verify it", async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const psKey = (await generateKeyPair("PS256")).privateKey;
    const token = await new SignJWT(validClaims() as Record<string, unknown>)
      .setProtectedHeader({ alg: "PS256", kid: KID })
      .setIssuedAt(nowSec)
      .setExpirationTime(nowSec + 3600)
      .sign(psKey);
    expect(JSON.parse(Buffer.from(token.split(".")[0]!, "base64url").toString()).alg).toBe("PS256");
    const result = await verify(token);
    expect(result.ok).toBe(false);
    expect((result as { reason: string }).reason).toBe("AUTH_INVALID");
  });
});
