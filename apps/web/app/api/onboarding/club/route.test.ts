import { authorize, ClubConfigError, getClubConfig, updateClubConfig } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../lib/session-cookies";
import { GET, PATCH } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({
      pool: {},
      db: { execute: async () => ({ rows: [{ locale: "en" }] }) },
    })),
    authorize: vi.fn(),
    updateClubConfig: vi.fn(),
    getClubConfig: vi.fn(),
    withTenant: vi.fn(async (_d: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({})),
  };
});
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: { execute: async () => ({ rows: [{ locale: "en" }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
const TENANT = "11111111-1111-4111-8111-111111111111";
const club = {
  slug: "clb",
  name: "CLB",
  timezone: "Asia/Bangkok",
  locale: "vi",
  defaultSportKey: "badminton",
  defaultPriceAmount: 50000,
  defaultVisibility: "private",
};

const patchReq = (body: unknown, opts: { tenant?: string; type?: string; raw?: string } = {}) =>
  new Request(`https://plexco.app/api/onboarding/club?tenant=${opts.tenant ?? TENANT}`, {
    method: "PATCH",
    headers: { "content-type": opts.type ?? "application/json", "x-csrf-token": "secret" },
    body: opts.raw ?? JSON.stringify(body),
  });
const getReq = (tenant = TENANT) =>
  new Request(`https://plexco.app/api/onboarding/club?tenant=${tenant}`);
const env = async (r: Response) =>
  (await r.json()) as {
    data: Record<string, unknown> | null;
    error: { code: string; message: string } | null;
  };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: "p",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
  vi.mocked(updateClubConfig).mockResolvedValue({ club, step: "verified", replayed: false });
  vi.mocked(getClubConfig).mockResolvedValue(club);
});

describe("PATCH /api/onboarding/club", () => {
  it("configures the club and returns { club, step: verified }", async () => {
    const res = await PATCH(patchReq({ commandId: "c1", name: "CLB", defaultPriceAmount: 50000 }));
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ club, step: "verified" });
    expect(updateClubConfig).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: "p",
      commandId: "c1",
      patch: { name: "CLB", defaultPriceAmount: 50000 },
    });
  });

  it("401 without a session", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await PATCH(patchReq({ commandId: "c" }))).status).toBe(401);
  });

  it("403 CSRF_INVALID", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    const res = await PATCH(patchReq({ commandId: "c" }));
    expect(res.status).toBe(403);
    expect((await env(res)).error?.code).toBe("CSRF_INVALID");
    expect(authorize).not.toHaveBeenCalled();
  });

  it("400 for a malformed tenant id", async () => {
    expect((await PATCH(patchReq({ commandId: "c" }, { tenant: "nope" }))).status).toBe(400);
  });

  it("403 FORBIDDEN when authorize denies; the command is never reached and the bucket is not spent", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_a_member" });
    const res = await PATCH(patchReq({ commandId: "c", name: "x" }));
    expect(res.status).toBe(403);
    expect((await env(res)).error?.code).toBe("FORBIDDEN");
    expect(updateClubConfig).not.toHaveBeenCalled();
    expect(
      vi.mocked(rateLimited).mock.calls.some(([k]) => String(k).startsWith("club-config:")),
    ).toBe(false);
  });

  it("keeps a pre-authz 403 in Vietnamese and a post-authz 429 in the tenant language (DD-118)", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "x" });
    expect((await env(await PATCH(patchReq({ commandId: "c" })))).error?.message).toBe(
      "Bạn không có quyền với CLB này.",
    );
    vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
    vi.mocked(rateLimited).mockImplementation(async (k) => String(k).startsWith("club-config:"));
    const res = await PATCH(patchReq({ commandId: "c" }));
    expect(res.status).toBe(429);
    expect((await env(res)).error?.message).toBe("Too many requests — wait.");
  });

  it("429 from the actor ceiling", async () => {
    vi.mocked(rateLimited).mockResolvedValue(true);
    expect((await PATCH(patchReq({ commandId: "c" }))).status).toBe(429);
    expect(authorize).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong content-type", patchReq({ commandId: "c" }, { type: "text/plain" })],
    ["invalid JSON", patchReq(null, { raw: "{nope" })],
    ["array body", patchReq([])],
    ["missing commandId", patchReq({ name: "x" })],
    ["unsafe commandId", patchReq({ commandId: "a\u0000b" })],
    ["unknown key", patchReq({ commandId: "c", tenantId: "other" })],
  ])("400 INVALID_BODY: %s", async (_l, request) => {
    const res = await PATCH(request);
    expect(res.status).toBe(400);
    expect((await env(res)).error?.code).toBe("INVALID_BODY");
    expect(updateClubConfig).not.toHaveBeenCalled();
  });

  it("413 for an oversized body", async () => {
    expect((await PATCH(patchReq({ commandId: "c", name: "x".repeat(9000) }))).status).toBe(413);
  });

  it.each([
    ["INVALID_INPUT", 400, "INVALID_BODY"],
    ["COMMAND_ID_CONFLICT", 409, "COMMAND_ID_CONFLICT"],
    ["NO_ONBOARDING_RUN", 404, "NOT_FOUND"],
    ["FORBIDDEN", 403, "FORBIDDEN"],
  ] as const)("maps %s to %i %s", async (code, status, apiCode) => {
    vi.mocked(updateClubConfig).mockRejectedValue(new ClubConfigError(code, "m"));
    const res = await PATCH(patchReq({ commandId: "c", name: "x" }));
    expect(res.status).toBe(status);
    expect((await env(res)).error?.code).toBe(apiCode);
  });

  it("rethrows an unexpected failure (never a fake client error)", async () => {
    vi.mocked(updateClubConfig).mockRejectedValue(new Error("db down"));
    await expect(PATCH(patchReq({ commandId: "c", name: "x" }))).rejects.toThrow("db down");
  });
});

describe("GET /api/onboarding/club", () => {
  it("returns the current config for an authorized actor", async () => {
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ club });
  });

  it("403 for a denied actor; config never read", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "no_capability" });
    expect((await GET(getReq())).status).toBe(403);
    expect(getClubConfig).not.toHaveBeenCalled();
  });

  it("requires no CSRF (read only)", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    expect((await GET(getReq())).status).toBe(200);
  });
});
