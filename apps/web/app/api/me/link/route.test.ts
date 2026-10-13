import { linkZaloToAccount } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return { ...actual, linkZaloToAccount: vi.fn() };
});
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: { tag: "pool" }, db: {} })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PERSON_ID = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";
const req = (body: unknown, init: { contentType?: string } = {}) =>
  new Request("https://plexco.app/api/me/link", {
    method: "POST",
    headers: {
      "content-type": init.contentType ?? "application/json",
      "x-csrf-token": "secret",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const good = { code: "abcd-efgh-jkmnp", commandId: "c1" };
const env = async (r: Response) =>
  (await r.json()) as { data: { outcome: string } | null; error: { code: string } | null };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.LINK_CODE_LOOKUP_HMAC_KEY = Buffer.from("k".repeat(32)).toString("base64");
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: ACCOUNT,
    personId: PERSON_ID,
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(linkZaloToAccount).mockResolvedValue({ outcome: "linked" });
});

describe("POST /api/me/link gates", () => {
  it("401 without a session, before any bucket or DB work", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const res = await POST(req(good));
    expect(res.status).toBe(401);
    expect(rateLimited).not.toHaveBeenCalled();
    expect(linkZaloToAccount).not.toHaveBeenCalled();
  });

  it("403 CSRF_INVALID before the buckets are spent", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    const res = await POST(req(good));
    expect(res.status).toBe(403);
    expect((await env(res)).error?.code).toBe("CSRF_INVALID");
    expect(rateLimited).not.toHaveBeenCalled();
  });

  it("429 when the per-account bucket is spent; the consume never runs", async () => {
    vi.mocked(rateLimited).mockImplementation(async (key) => String(key).startsWith("me-link:"));
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect((await env(res)).error?.code).toBe("LINK_CODE_RATE_LIMITED");
    expect(linkZaloToAccount).not.toHaveBeenCalled();
  });

  it("429 when the per-IP bucket is spent; the consume never runs", async () => {
    vi.mocked(rateLimited).mockImplementation(async (key) => String(key).startsWith("me-link-ip:"));
    const res = await POST(req(good));
    expect(res.status).toBe(429);
    expect(linkZaloToAccount).not.toHaveBeenCalled();
  });

  it("spends both buckets with the documented sizes before linking", async () => {
    await POST(req(good));
    expect(rateLimited).toHaveBeenCalledWith(`me-link:${ACCOUNT}`, 5, 600);
    expect(rateLimited).toHaveBeenCalledWith(expect.stringMatching(/^me-link-ip:/), 20, 600);
  });

  it.each([
    ["not JSON content type", "{}", "text/plain"],
    ["malformed JSON", "{nope", "application/json"],
    ["array body", "[]", "application/json"],
    ["missing commandId", JSON.stringify({ code: "x" }), "application/json"],
    ["unsafe commandId", JSON.stringify({ code: "x", commandId: "a\u0000b" }), "application/json"],
    ["missing code", JSON.stringify({ commandId: "c" }), "application/json"],
    ["empty code", JSON.stringify({ code: "  ", commandId: "c" }), "application/json"],
    [
      "oversized code",
      JSON.stringify({ code: "A".repeat(41), commandId: "c" }),
      "application/json",
    ],
    ["non-string code", JSON.stringify({ code: 12345, commandId: "c" }), "application/json"],
    [
      "oversized body",
      JSON.stringify({ code: "A", commandId: "c", pad: "x".repeat(2000) }),
      "application/json",
    ],
  ])("400 INVALID_BODY: %s", async (_name, body, contentType) => {
    const res = await POST(req(body, { contentType }));
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("INVALID_BODY");
    expect(linkZaloToAccount).not.toHaveBeenCalled();
  });

  it("503 LINK_UNAVAILABLE when the lookup key is not configured", async () => {
    delete process.env.LINK_CODE_LOOKUP_HMAC_KEY;
    const res = await POST(req(good));
    expect(res.status).toBe(503);
    expect((await env(res)).error?.code).toBe("LINK_UNAVAILABLE");
    expect(linkZaloToAccount).not.toHaveBeenCalled();
  });
});

describe("POST /api/me/link outcomes", () => {
  it.each([
    ["linked", 200, null],
    ["already_linked", 200, null],
    ["requires_review", 409, "MERGE_REQUIRES_REVIEW"],
    ["invalid", 400, "LINK_CODE_INVALID"],
    ["unsupported", 400, "LINK_CODE_INVALID"],
    ["rate_limited", 429, "LINK_CODE_RATE_LIMITED"],
  ] as const)("%s -> %i %s", async (outcome, status, code) => {
    vi.mocked(linkZaloToAccount).mockResolvedValue({ outcome });
    const res = await POST(req(good));
    expect(res.status).toBe(status);
    const body = await env(res);
    if (code === null) expect(body.data).toEqual({ outcome });
    else expect(body.error?.code).toBe(code);
  });

  it("acts as the SESSION account; a smuggled body accountId is refused as an unknown key", async () => {
    const res = await POST(req({ ...good, accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }));
    expect(res.status).toBe(400);
    expect(linkZaloToAccount).not.toHaveBeenCalled();
    await POST(req(good));
    expect(linkZaloToAccount).toHaveBeenCalledWith(
      { tag: "pool" },
      good.code,
      ACCOUNT,
      expect.objectContaining({ lookupHmacKey: expect.any(Buffer) }),
    );
  });

  it("an account with no active person is LINK_CODE_INVALID (the service maps consume's target raise)", async () => {
    vi.mocked(linkZaloToAccount).mockResolvedValue({ outcome: "invalid" });
    const res = await POST(req(good));
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("LINK_CODE_INVALID");
  });

  it("a 42501 the service did not map (ACL / row-security) propagates as a failure, never invalid", async () => {
    vi.mocked(linkZaloToAccount).mockRejectedValue(
      Object.assign(new Error("x"), { code: "42501" }),
    );
    await expect(POST(req(good))).rejects.toMatchObject({ code: "42501" });
  });

  it("any other database error still propagates", async () => {
    vi.mocked(linkZaloToAccount).mockRejectedValue(new Error("boom"));
    await expect(POST(req(good))).rejects.toThrow("boom");
  });

  it("never echoes person ids, counters or blocking tables", async () => {
    for (const outcome of ["linked", "requires_review", "invalid", "rate_limited"] as const) {
      vi.mocked(linkZaloToAccount).mockResolvedValue({ outcome });
      const text = await (await POST(req(good))).text();
      expect(text).not.toContain(PERSON_ID);
      expect(text).not.toMatch(/failed_attempts|blocking|memberships|source_person/);
    }
  });

  it("responses are no-store", async () => {
    const res = await POST(req(good));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
