import { consumeOauthCompletionHandoff, rateLimitCheck } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../../../../lib/session-cookies";
import { hashToken } from "../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  consumeOauthCompletionHandoff: vi.fn(),
  rateLimitCheck: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

// Keep the real sameOriginRequest/hashToken/HANDOFF_FIELD/appDb + the real
// SessionReauthRequiredError class; stub only issueSession so we drive its
// rotate/create/reauth outcome directly (the DB race itself is proven by the
// deterministic barrier in packages/db/src/auth.test.ts, D1B-8).
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return { ...actual, issueSession: vi.fn() };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.GOOGLE_OAUTH_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_OAUTH_CLIENT_SECRET = "test-secret";
process.env.APP_BASE_URL = "https://plexco.app";
process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";

/** Same-site auto-submitted POST from the M3 landing (carries Origin). */
function completeReq(
  handoff: string | null = "raw-handoff",
  opts: { origin?: string | null; ip?: string; contentType?: string | null; rawBody?: string } = {},
): Request {
  const body = new URLSearchParams();
  if (handoff !== null) body.set("handoff", handoff);
  const headers: Record<string, string> = {
    host: "plexco.app",
    "do-connecting-ip": opts.ip ?? "1.2.3.4",
  };
  const contentType =
    opts.contentType === undefined ? "application/x-www-form-urlencoded" : opts.contentType;
  if (contentType !== null) headers["content-type"] = contentType;
  const origin = opts.origin === undefined ? "https://plexco.app" : opts.origin;
  if (origin !== null) headers.origin = origin;
  return new Request("https://plexco.app/api/auth/google/complete", {
    method: "POST",
    headers,
    body: opts.rawBody ?? body.toString(),
  });
}

beforeEach(() => {
  vi.mocked(consumeOauthCompletionHandoff).mockReset();
  vi.mocked(session.issueSession).mockReset();
  // Allowed by default; the audit W-3 block below flips it.
  vi.mocked(rateLimitCheck).mockReset().mockResolvedValue(true);
});

describe("POST /api/auth/google/complete", () => {
  it("D1B-2/D1B-3: consumes the handoff and runs issueSession(resolved account) → rotate branch, redirects home", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");
    vi.mocked(session.issueSession).mockResolvedValue({ csrfToken: "csrf" });

    const res = await POST(completeReq("raw-handoff"));

    // The handoff is looked up by its sha256, never its raw value.
    expect(consumeOauthCompletionHandoff).toHaveBeenCalledWith(
      expect.anything(),
      hashToken("raw-handoff"),
    );
    // issueSession runs where the Strict cookie is present → its existing rotate
    // branch revokes the pre-existing session (D1B-3).
    expect(session.issueSession).toHaveBeenCalledWith("acc-9");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://plexco.app/");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("D1B-7: a CROSS-SITE POST is rejected before any consume — no session", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");

    const res = await POST(completeReq("raw-handoff", { origin: "https://evil.example.com" }));

    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1B-7: a POST with NO Origin/Referer fails closed (same-origin cannot be proven)", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");

    const res = await POST(completeReq("raw-handoff", { origin: null }));

    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1B-5: a replayed handoff (consume → null) is rejected, no session issued", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue(null); // already consumed

    const res = await POST(completeReq("raw-handoff"));

    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1B-6: an expired handoff (consume → null) is rejected, no session issued", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue(null); // expired

    const res = await POST(completeReq("raw-handoff"));

    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("a missing handoff field is rejected before any consume", async () => {
    const res = await POST(completeReq(null));

    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
  });

  it("D1B-8: the issuance fence (lost logout-all race → SessionReauthRequiredError) maps to a generic reject, no reason leaked", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");
    vi.mocked(session.issueSession).mockRejectedValue(new session.SessionReauthRequiredError());

    const res = await POST(completeReq("raw-handoff"));

    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain("/?auth_error=AUTH_INVALID");
    expect(loc.toLowerCase()).not.toContain("reauth");
  });

  it("D1B-10: returns 503 when Google is not configured — the hop is not a bypass around the enablement gate", async () => {
    const prev = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
    delete process.env.GOOGLE_OAUTH_CLIENT_SECRET;

    const res = await POST(completeReq("raw-handoff"));

    expect(res.status).toBe(503);
    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
    process.env.GOOGLE_OAUTH_CLIENT_SECRET = prev;
  });

  it("an unexpected dependency failure fails closed with a no-referrer redirect (never a bare 500)", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockRejectedValue(new Error("db down"));

    const res = await POST(completeReq("raw-handoff"));

    expect(res.status).toBe(302);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("location")).toContain("auth_error=");
  });
});

/**
 * Audit 2026-09-06 W-3. Until this fix the completion hop was the ONE auth mutation with no
 * rate-limit bucket (its siblings `/state` and `/callback` have had `oauth-*:<ip>` 10/min since
 * D1-1) and it read the body with an unbounded `request.formData()`. Every POST — valid or not —
 * cost one UPDATE against the handoff table. The bucket sits BEFORE the body is read and before
 * `sameOriginRequest()`, so neither a cross-site nor a malformed POST can spend rows.
 */
describe("POST /api/auth/google/complete — rate limit + bounded body (audit W-3)", () => {
  it("consults the `oauth-complete:<trusted-ip>` bucket at 10/min, same shape as the sibling hops", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");
    vi.mocked(session.issueSession).mockResolvedValue({ csrfToken: "csrf" });

    await POST(completeReq("raw-handoff", { ip: "5.6.7.8" }));

    expect(rateLimitCheck).toHaveBeenCalledWith(expect.anything(), "oauth-complete:5.6.7.8", 10, 60);
  });

  it("over the limit → 429 LOGIN_RATE_LIMITED envelope, no-referrer, and the handoff is NOT consumed", async () => {
    vi.mocked(rateLimitCheck).mockResolvedValue(false); // over limit
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");

    const res = await POST(completeReq("raw-handoff"));

    expect(res.status).toBe(429);
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    const body = (await res.json()) as { error: { code: string } | null };
    expect(body.error?.code).toBe("LOGIN_RATE_LIMITED");
    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
  });

  it("limiter store down → fails CLOSED (429), exactly like /state (codex round-06 [P2])", async () => {
    vi.mocked(rateLimitCheck).mockRejectedValue(new Error("pg down"));
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");

    const res = await POST(completeReq("raw-handoff"));

    expect(res.status).toBe(429);
    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
  });

  it("the bucket is checked BEFORE same-origin: a cross-site flood still spends only the limiter, never a row", async () => {
    vi.mocked(rateLimitCheck).mockResolvedValue(false);

    const res = await POST(completeReq("raw-handoff", { origin: "https://evil.example.com" }));

    expect(res.status).toBe(429);
    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
  });

  it("a non-form Content-Type (JSON, multipart, missing) is rejected before the body is read", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");

    for (const contentType of [
      "application/json",
      "multipart/form-data; boundary=x",
      "text/plain",
      null,
    ]) {
      const res = await POST(completeReq("raw-handoff", { contentType }));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
    }
    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
    expect(session.issueSession).not.toHaveBeenCalled();
  });

  it("a charset suffix on the form Content-Type is still accepted (browsers send it)", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");
    vi.mocked(session.issueSession).mockResolvedValue({ csrfToken: "csrf" });

    const res = await POST(
      completeReq("raw-handoff", { contentType: "application/x-www-form-urlencoded; charset=UTF-8" }),
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://plexco.app/");
    expect(consumeOauthCompletionHandoff).toHaveBeenCalledOnce();
  });

  it("a body over 1 KiB is rejected without consuming — the real form is ~51 bytes", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");
    const padding = "x".repeat(2048);

    // Oversized handoff value AND an oversized unrelated field: both are "not this form".
    for (const rawBody of [`handoff=${padding}`, `handoff=raw-handoff&pad=${padding}`]) {
      const res = await POST(completeReq("raw-handoff", { rawBody }));
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toContain("/?auth_error=AUTH_INVALID");
    }
    expect(consumeOauthCompletionHandoff).not.toHaveBeenCalled();
  });

  it("a body exactly at the cap still parses (the cap is a ceiling, not a trap for real traffic)", async () => {
    vi.mocked(consumeOauthCompletionHandoff).mockResolvedValue("acc-9");
    vi.mocked(session.issueSession).mockResolvedValue({ csrfToken: "csrf" });
    const prefix = "handoff=raw-handoff&pad=";
    const rawBody = prefix + "y".repeat(1024 - prefix.length);
    expect(Buffer.byteLength(rawBody, "utf8")).toBe(1024);

    const res = await POST(completeReq("raw-handoff", { rawBody }));

    expect(res.headers.get("location")).toBe("https://plexco.app/");
    expect(consumeOauthCompletionHandoff).toHaveBeenCalledWith(
      expect.anything(),
      hashToken("raw-handoff"),
    );
  });
});
