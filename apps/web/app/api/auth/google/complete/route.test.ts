import { consumeOauthCompletionHandoff } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as session from "../../../../../lib/session-cookies";
import { hashToken } from "../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  consumeOauthCompletionHandoff: vi.fn(),
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

/** Same-site auto-submitted POST from the M3 landing (carries Origin). */
function completeReq(
  handoff: string | null = "raw-handoff",
  opts: { origin?: string | null } = {},
): Request {
  const body = new URLSearchParams();
  if (handoff !== null) body.set("handoff", handoff);
  const headers: Record<string, string> = {
    host: "plexco.app",
    "content-type": "application/x-www-form-urlencoded",
  };
  const origin = opts.origin === undefined ? "https://plexco.app" : opts.origin;
  if (origin !== null) headers.origin = origin;
  return new Request("https://plexco.app/api/auth/google/complete", {
    method: "POST",
    headers,
    body: body.toString(),
  });
}

beforeEach(() => {
  vi.mocked(consumeOauthCompletionHandoff).mockReset();
  vi.mocked(session.issueSession).mockReset();
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
