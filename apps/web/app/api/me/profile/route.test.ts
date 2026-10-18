import { readMyProfile, updateMyProfile } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../lib/session-cookies";
import { GET, PATCH } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return { ...actual, readMyProfile: vi.fn(), updateMyProfile: vi.fn() };
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
const patch = (body: unknown, contentType = "application/json") =>
  new Request("https://plexco.app/api/me/profile", {
    method: "PATCH",
    headers: { "content-type": contentType, "x-csrf-token": "secret" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = () => new Request("https://plexco.app/api/me/profile");
const env = async (r: Response) =>
  (await r.json()) as { data: unknown; error: { code: string } | null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: ACCOUNT,
    personId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(readMyProfile).mockResolvedValue({ displayName: "Lan", ...NO_GENDER });
  vi.mocked(updateMyProfile).mockResolvedValue({ displayName: "Lan 2", ...NO_GENDER });
});

const NO_GENDER = { gender: null, genderConsent: false };

describe("GET /api/me/profile", () => {
  it("401 without a session, no DB work", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(401);
    expect(readMyProfile).not.toHaveBeenCalled();
  });

  it("returns the profile, resolved from the session account", async () => {
    const res = await GET(get());
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ profile: { displayName: "Lan", ...NO_GENDER } });
    expect(readMyProfile).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT);
  });

  it("404 when the account has no active Person", async () => {
    vi.mocked(readMyProfile).mockResolvedValue(null);
    const res = await GET(get());
    expect(res.status).toBe(404);
  });
});

describe("PATCH /api/me/profile", () => {
  const good = { displayName: "Lan 2", commandId: "c1" };

  it("401 first, 403 CSRF before the bucket is spent", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    const res = await PATCH(patch(good));
    expect(res.status).toBe(403);
    expect((await env(res)).error?.code).toBe("CSRF_INVALID");
    expect(rateLimited).not.toHaveBeenCalled();
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("429 when the 10/min per-account bucket is spent", async () => {
    vi.mocked(rateLimited).mockImplementation(async (key) => String(key).startsWith("me-profile:"));
    const res = await PATCH(patch(good));
    expect(res.status).toBe(429);
    expect(rateLimited).toHaveBeenCalledWith(`me-profile:${ACCOUNT}`, 10, 60);
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it.each([
    ["not JSON content type", "{}", "text/plain"],
    ["malformed JSON", "{nope", "application/json"],
    ["array body", "[]", "application/json"],
    ["unknown key (accountId must never be read)", { ...good, accountId: "x" }, "application/json"],
    ["unknown key (personId)", { ...good, personId: "x" }, "application/json"],
    ["missing commandId", { displayName: "Lan" }, "application/json"],
    ["unsafe commandId", { displayName: "Lan", commandId: "a\u0000b" }, "application/json"],
    ["oversized body", { displayName: "x".repeat(4000), commandId: "c" }, "application/json"],
  ])("400 INVALID_BODY: %s", async (_label, body, contentType) => {
    const res = await PATCH(patch(body, contentType));
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("INVALID_BODY");
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it("400 INVALID_BODY when the display name fails validation", async () => {
    const { DisplayNameError } = await import("@plexco/db");
    vi.mocked(updateMyProfile).mockRejectedValue(new DisplayNameError());
    const res = await PATCH(patch({ displayName: "  ", commandId: "c1" }));
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("INVALID_BODY");
  });

  it("200 returns only the profile and uses the SESSION account", async () => {
    const res = await PATCH(patch(good));
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ profile: { displayName: "Lan 2", ...NO_GENDER } });
    expect(updateMyProfile).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT, "Lan 2");
  });

  it("non-validation errors propagate (never swallowed into a 4xx)", async () => {
    vi.mocked(updateMyProfile).mockRejectedValue(new Error("db down"));
    await expect(PATCH(patch(good))).rejects.toThrow("db down");
  });
});
