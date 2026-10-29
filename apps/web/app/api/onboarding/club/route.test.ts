import {
  authorize,
  ClubConfigError,
  getClubConfig,
  getPublicAlias,
  setPublicAlias,
  updateClubConfig,
  validatePublicAlias,
} from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../../../lib/log";
import {
  captureConsoleSinks,
  expectTenantOnlyAfterTheGate,
} from "../../../../lib/log-capture.testkit";
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
    getPublicAlias: vi.fn(),
    setPublicAlias: vi.fn(),
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
const NONE = { publicAlias: null, publicAliasStatus: null };
const PENDING = { publicAlias: "CLB Q7", publicAliasStatus: "pending" } as const;

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
  vi.mocked(getPublicAlias).mockResolvedValue(NONE);
  vi.mocked(setPublicAlias).mockImplementation(async (_db, p) => {
    validatePublicAlias(p.publicAlias); // the module's own rule, so A-4 runs through the route
    return { ...PENDING, changed: true, replayed: false };
  });
});

describe("PATCH /api/onboarding/club", () => {
  it("configures the club and returns { club, step: verified }", async () => {
    const res = await PATCH(patchReq({ commandId: "c1", name: "CLB", defaultPriceAmount: 50000 }));
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ club: { ...club, ...NONE }, step: "verified" });
    expect(updateClubConfig).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: "p",
      commandId: "c1",
      patch: { name: "CLB", defaultPriceAmount: 50000 },
    });
  });

  it("asks authorize for content.manage in THIS tenant for THIS person", async () => {
    await PATCH(patchReq({ commandId: "c1", name: "CLB" }));
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), {
      tenantId: TENANT,
      action: "content.manage",
      actorPersonId: "p",
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
    ["TENANT_SUSPENDED", 403, "TENANT_SUSPENDED"],
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
    expect((await env(res)).data).toEqual({ club: { ...club, ...NONE } });
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

describe("public alias (L10a): { commandId, publicAlias } travels alone", () => {
  const alias = (publicAlias: unknown, extra: Record<string, unknown> = {}) =>
    PATCH(patchReq({ commandId: "c1", publicAlias, ...extra }));

  it("A-1: sets it as THIS actor and answers the club with both fields; no config command", async () => {
    const res = await alias("  CLB Q7  ");
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ club: { ...club, ...PENDING } });
    expect(setPublicAlias).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      actorPersonId: "p",
      commandId: "c1",
      publicAlias: "  CLB Q7  ",
    });
    expect(updateClubConfig).not.toHaveBeenCalled();
  });

  it.each([
    ["mixed with a config field", { publicAlias: "CLB Q7", name: "CLB" }],
    ["null (clearing is unsupported, M-7)", { publicAlias: null }],
    ["a number", { publicAlias: 7 }],
    ["a client-sent publicAliasStatus", { publicAliasStatus: "approved" }],
  ])("A-23: 400 INVALID_BODY for %s; neither command is called", async (_l, fields) => {
    const res = await PATCH(patchReq({ commandId: "c1", ...fields }));
    expect([res.status, (await env(res)).error?.code]).toEqual([400, "INVALID_BODY"]);
    expect(setPublicAlias).not.toHaveBeenCalled();
    expect(updateClubConfig).not.toHaveBeenCalled();
  });

  it.each(["", "   ", "x".repeat(61), "a\u202Eb", "a\u0007b", "a\u2028b", "\u2800"])(
    "A-4: alias %j -> 400 INVALID_BODY (the module's rule); the club is never read",
    async (text) => {
      const res = await alias(text);
      expect([res.status, (await env(res)).error?.code]).toEqual([400, "INVALID_BODY"]);
      expect(getClubConfig).not.toHaveBeenCalled();
    },
  );

  // Strip first (L23, R D3): a + U+200B + b left the refusal list above; invisible-only is empty.
  it.each(["\u{200B}", " \u{3164} \u{AD} ", "\u{200B}\u{FE0F}\u{E0001}"])(
    "L23 R3: invisible-only alias %j -> 400 INVALID_BODY like an empty one; the club is never read",
    async (text) => {
      const res = await alias(text);
      expect([res.status, (await env(res)).error?.code]).toEqual([400, "INVALID_BODY"]);
      expect(getClubConfig).not.toHaveBeenCalled();
    },
  );

  it("L23 R2: alias a + U+200B + b is accepted; the module's rule stores and answers ab", async () => {
    vi.mocked(setPublicAlias).mockImplementation(async (_db, p) => ({
      ...PENDING,
      publicAlias: validatePublicAlias(p.publicAlias),
      changed: true,
      replayed: false,
    }));
    const res = await alias("a\u{200B}b");
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ club: { ...club, ...PENDING, publicAlias: "ab" } });
  });

  it.each([
    ["FORBIDDEN", 403, "FORBIDDEN"],
    ["TENANT_SUSPENDED", 403, "TENANT_SUSPENDED"],
    ["COMMAND_ID_CONFLICT", 409, "COMMAND_ID_CONFLICT"],
  ] as const)("A-5/A-20/A-19: %s maps to %i %s, never a 2xx", async (code, status, apiCode) => {
    vi.mocked(setPublicAlias).mockRejectedValue(new ClubConfigError(code, "m"));
    const res = await alias("CLB Q7");
    expect([res.status, (await env(res)).error?.code]).toEqual([status, apiCode]);
  });

  it("A-5: every denial reason gets a byte-identical 403 (the gate, then the definer re-check)", async () => {
    // Identical bytes but the per-response meta.requestId, which is random by design.
    const forbidden = async (r: Promise<Response>) =>
      (await (await r).text()).replace(/"requestId":"req_[^"]+"/, "");
    const gate = new Set<string>();
    for (const reason of ["not_a_member", "no_capability", "other_tenant"]) {
      vi.mocked(authorize).mockResolvedValue({ allowed: false, reason });
      gate.add(await forbidden(alias("CLB Q7")));
    }
    expect(gate.size).toBe(1);
    expect(setPublicAlias).not.toHaveBeenCalled();
    vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
    const recheck = new Set<string>();
    for (const reason of ["no_capability", "tenant mismatch"]) {
      vi.mocked(setPublicAlias).mockRejectedValueOnce(new ClubConfigError("FORBIDDEN", reason));
      recheck.add(await forbidden(alias("CLB Q7")));
    }
    expect(recheck.size).toBe(1);
  });

  it("A-19: a replay or a same-text no-op answers 200 with the CURRENT state (approval kept)", async () => {
    const approved = { publicAlias: "CLB Q7", publicAliasStatus: "approved" } as const;
    vi.mocked(setPublicAlias).mockResolvedValue({ ...approved, changed: false, replayed: true });
    expect((await env(await alias("CLB Q7"))).data).toEqual({ club: { ...club, ...approved } });
  });

  it("A-23: GET and the config PATCH carry both fields; an unmapped alias error propagates", async () => {
    vi.mocked(getPublicAlias).mockResolvedValue(PENDING);
    expect((await env(await GET(getReq()))).data).toEqual({ club: { ...club, ...PENDING } });
    const res = await PATCH(patchReq({ commandId: "c2", name: "CLB" }));
    expect((await env(res)).data).toEqual({ club: { ...club, ...PENDING }, step: "verified" });
    expect(setPublicAlias).not.toHaveBeenCalled();
    vi.mocked(setPublicAlias).mockRejectedValue(new Error("db down"));
    await expect(alias("CLB Q7")).rejects.toThrow("db down");
  });
});

// L68 A-15 (D6, D10, D15): the REAL logger, no mock of lib/log; its three console sinks are
// captured and silenced. `l68.before` is written inside the gate (authorize), `l68.after` by a
// dependency the handler calls once the gate has proven the tenant.
describe("L68 A-15 — the club routes run in the request log context with the proven tenant", () => {
  const { written, probes } = captureConsoleSinks();
  beforeEach(() => {
    vi.mocked(authorize).mockImplementation(async () => {
      log.error("l68.before", {});
      return { allowed: true, role: "owner" };
    });
  });
  it("GET: the config read logs the proven tenant and the response's request id; the gate none", async () => {
    vi.mocked(getClubConfig).mockImplementation(async () => {
      log.error("l68.after", {});
      return club;
    });
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    expectTenantOnlyAfterTheGate(probes, res, TENANT);
  });

  it("PATCH: the config command logs the proven tenant and the response's request id; the gate none", async () => {
    vi.mocked(updateClubConfig).mockImplementation(async () => {
      log.error("l68.after", {});
      return { club, step: "verified", replayed: false };
    });
    const res = await PATCH(patchReq({ commandId: "c1", name: "CLB" }));
    expect(res.status).toBe(200);
    expectTenantOnlyAfterTheGate(probes, res, TENANT);
  });

  it("GET and PATCH: an early 401 carries a fresh x-request-id and no line carries a tenant", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    for (const res of [await GET(getReq()), await PATCH(patchReq({ commandId: "c" }))]) {
      expect(res.status).toBe(401);
      expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f-]{36}$/);
    }
    expect(written()).not.toContain("tenant_id");
  });
});
