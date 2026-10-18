import { readMyProfile, updateMyProfile } from "@plexco/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  vi.stubEnv("GENDER_COLLECTION_ENABLED", "false");
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
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const NO_GENDER = { gender: null, genderConsent: false };
const ON = () => vi.stubEnv("GENDER_COLLECTION_ENABLED", "true");
const quiet = (m: "error" | "warn" | "log" | "info") =>
  vi.spyOn(console, m).mockImplementation(() => {});

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
    expect((await env(res)).data).toEqual({
      profile: { displayName: "Lan", ...NO_GENDER },
      genderCollection: false,
    });
    expect(readMyProfile).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT);
  });

  it.each(["TRUE", "1", "yes", ""])(
    'only "true" enables collection: %j reports OFF',
    async (flag) => {
      vi.stubEnv("GENDER_COLLECTION_ENABLED", flag);
      expect((await env(await GET(get()))).data).toMatchObject({ genderCollection: false });
    },
  );

  it("ON: the caller's own gender comes back only in this self-read", async () => {
    ON();
    vi.mocked(readMyProfile).mockResolvedValue({
      displayName: "Lan",
      gender: "female",
      genderConsent: true,
    });
    expect((await env(await GET(get()))).data).toEqual({
      profile: { displayName: "Lan", gender: "female", genderConsent: true },
      genderCollection: true,
    });
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
    [
      "unknown key next to gender",
      { gender: "male", dob: "x", commandId: "c1" },
      "application/json",
    ],
    ["missing commandId", { displayName: "Lan" }, "application/json"],
    ["unsafe commandId", { displayName: "Lan", commandId: "a\u0000b" }, "application/json"],
    ["only commandId", { commandId: "c1" }, "application/json"],
    ["genderConsent not a boolean", { genderConsent: "yes", commandId: "c1" }, "application/json"],
    [
      "erase with consent on",
      { gender: null, genderConsent: true, commandId: "c1" },
      "application/json",
    ],
    ["oversized body", { displayName: "x".repeat(4000), commandId: "c" }, "application/json"],
  ])("400 INVALID_BODY (even with collection ON): %s", async (_label, body, contentType) => {
    ON();
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
    expect((await env(res)).data).toEqual({
      profile: { displayName: "Lan 2", ...NO_GENDER },
      genderCollection: false,
    });
    expect(updateMyProfile).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT, "Lan 2", {});
  });

  it("an unexpected fault => generic 500 with an empty body, logging only the error name", async () => {
    const error = quiet("error");
    vi.mocked(updateMyProfile).mockRejectedValue(new Error("db down"));
    const res = await PATCH(patch(good));
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("");
    expect(error.mock.calls).toEqual([["PATCH /api/me/profile failed", "Error"]]);
  });
});

describe("GENDER_COLLECTION_ENABLED rows of 4.7 (T-18)", () => {
  it.each([
    ["a gender", { gender: "male" }],
    ["consent on", { genderConsent: true }],
    ["a gender next to a display name", { displayName: "Lan 2", gender: "female" }],
  ])("OFF: %s => 400 INVALID_BODY, nothing written", async (_label, fields) => {
    const res = await PATCH(patch({ ...fields, commandId: "c1" }));
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("INVALID_BODY");
    expect(updateMyProfile).not.toHaveBeenCalled();
  });

  it.each([
    ["erase", { gender: null }],
    ["withdraw", { genderConsent: false }],
  ])("OFF: %s is always accepted", async (_label, fields) => {
    const res = await PATCH(patch({ ...fields, commandId: "c1" }));
    expect(res.status).toBe(200);
    expect(updateMyProfile).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT, undefined, fields);
  });

  it("ON: a mixed body is ONE updateMyProfile call (one transaction in me-settings)", async () => {
    ON();
    const body = { displayName: "Lan 2", gender: "female", genderConsent: true, commandId: "c1" };
    const res = await PATCH(patch(body));
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({
      profile: { displayName: "Lan 2", ...NO_GENDER },
      genderCollection: true,
    });
    expect(updateMyProfile).toHaveBeenCalledTimes(1);
    expect(updateMyProfile).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT, "Lan 2", {
      gender: "female",
      genderConsent: true,
    });
  });

  it("relink race: no active Person at write time => 404, never a 200", async () => {
    ON();
    vi.mocked(updateMyProfile).mockResolvedValue(null);
    const res = await PATCH(patch({ gender: "male", commandId: "c1" }));
    expect(res.status).toBe(404);
    expect((await env(res)).error?.code).toBe("NOT_FOUND");
  });
});

describe.each(["false", "true"])("INVALID_GENDER (T-9), collection %s", (flag) => {
  it.each([[""], ["Nam"], ["MALE"], [1], [{}]])("%j => 400 with the fixed pair", async (gender) => {
    vi.stubEnv("GENDER_COLLECTION_ENABLED", flag);
    const res = await PATCH(patch({ gender, commandId: "c1" }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    // Exact err() envelope (api-envelope.ts): no field can carry the input back.
    expect(body).toEqual({
      data: null,
      error: { code: "INVALID_GENDER", message: expect.any(String), statusCode: 400 },
      meta: { requestId: expect.stringMatching(/^req_[0-9a-f-]{36}$/) },
    });
    expect(["Giá trị giới tính không hợp lệ.", "Invalid gender value."]).toContain(
      body.error.message,
    );
    expect(updateMyProfile).not.toHaveBeenCalled();
  });
});

describe("T-10: no gender value reaches a console call", () => {
  it("a valid gender and an invalid value log nothing", async () => {
    ON();
    const spies = [quiet("error"), quiet("warn"), quiet("log"), quiet("info")];
    expect((await PATCH(patch({ gender: "other", commandId: "c1" }))).status).toBe(200);
    expect((await PATCH(patch({ gender: "Nam", commandId: "c2" }))).status).toBe(400);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("a self-read decrypt failure => generic 500 (never gender null), only the error name logged", async () => {
    ON();
    const error = quiet("error");
    const rest = [quiet("warn"), quiet("log"), quiet("info")];
    const openFailed = Object.assign(new Error("female"), { name: "GenderOpenError" });
    vi.mocked(readMyProfile).mockRejectedValue(openFailed);
    const res = await GET(get());
    expect(res.status).toBe(500);
    expect(await res.text()).toBe("");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(error.mock.calls).toEqual([["GET /api/me/profile failed", "GenderOpenError"]]);
    for (const spy of rest) expect(spy).not.toHaveBeenCalled();
  });
});
