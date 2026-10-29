import { authorize, onboardingSnapshot, tenantLocale } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../../../lib/log";
import {
  captureConsoleSinks,
  expectTenantOnlyAfterTheGate,
} from "../../../../lib/log-capture.testkit";
import { GET } from "./route";

const allow = (role: "owner" | "admin" | "co_admin" = "owner") =>
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role });
const deny = (reason = "not_a_member") =>
  vi.mocked(authorize).mockResolvedValue({ allowed: false, reason });

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {}, db: {} })),
  onboardingSnapshot: vi.fn(),
  resolveWebSession: vi.fn(),
  tenantLocale: vi.fn(),
  authorize: vi.fn(),
  CLUB_ACTION: "content.manage",
  withTenant: vi.fn(async (_db: unknown, _id: string, fn: (tx: unknown) => unknown) => fn({})),
}));

// The gate spends the ACTOR ceiling bucket; the limiter itself is not under test here.
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return { ...actual, rateLimited: vi.fn(async () => false) };
});

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

function mockSession() {
  vi.mocked(cookies).mockResolvedValue({
    get: vi.fn(() => ({ value: "raw-token" })),
  } as never);
}

function reqFor(tenantId: string): Request {
  return new Request(`https://plexco.app/api/onboarding/readiness?tenant=${tenantId}`);
}

describe("GET /api/onboarding/readiness — authorize(content.manage) gate", () => {
  beforeEach(async () => {
    mockSession();
    const { resolveWebSession } = await import("@plexco/db");
    vi.mocked(resolveWebSession).mockResolvedValue({
      sessionId: "s1",
      accountId: "a1",
      personId: "p1",
      csrfSecret: "c1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    vi.mocked(onboardingSnapshot).mockResolvedValue({ runStatus: "in_progress", steps: [] });
  });

  it("allows the OWNER of the tenant", async () => {
    allow();
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(200);
  });

  it("allows a delegated admin / co_admin holding the content.manage preset", async () => {
    allow("admin");
    expect((await GET(reqFor(TENANT_ID))).status).toBe(200);
    allow("co_admin");
    expect((await GET(reqFor(TENANT_ID))).status).toBe(200);
  });

  it("rejects when authorize denies (no membership / no capability / foreign tenant): one 403", async () => {
    deny("no_capability");
    expect((await GET(reqFor(TENANT_ID))).status).toBe(403);
    deny("tenant_context");
    expect((await GET(reqFor(TENANT_ID))).status).toBe(403);
  });

  it("asks authorize for content.manage in THIS tenant for THIS person", async () => {
    allow();
    await GET(reqFor(TENANT_ID));
    expect(authorize).toHaveBeenLastCalledWith(expect.anything(), {
      tenantId: TENANT_ID,
      action: "content.manage",
      actorPersonId: "p1",
    });
  });

  it("answers 400 for a malformed tenant id without touching authorize", async () => {
    vi.mocked(authorize).mockClear();
    expect((await GET(reqFor("nope"))).status).toBe(400);
    expect(authorize).not.toHaveBeenCalled();
  });

  // L68 A-15 (D6, D10, D15): the REAL logger, no mock of lib/log; its three console sinks are
  // captured and silenced. Nested to reuse this block's session setup. `l68.before` is written
  // inside the gate (authorize), `l68.after` by the snapshot read once the tenant is proven.
  describe("L68 A-15 — the readiness route runs in the request log context", () => {
    const { written, probes } = captureConsoleSinks();

    it("the snapshot read logs the proven tenant and the response's request id; the gate none", async () => {
      vi.mocked(authorize).mockImplementationOnce(async () => {
        log.error("l68.before", {});
        return { allowed: true, role: "owner" };
      });
      vi.mocked(onboardingSnapshot).mockImplementationOnce(async () => {
        log.error("l68.after", {});
        return { runStatus: "in_progress", steps: [] };
      });
      const res = await GET(reqFor(TENANT_ID));
      expect(res.status).toBe(200);
      expectTenantOnlyAfterTheGate(probes, res, TENANT_ID);
    });

    it("the gate's early 403 carries a fresh x-request-id and no line carries a tenant", async () => {
      deny("no_capability");
      const res = await GET(reqFor(TENANT_ID));
      expect(res.status).toBe(403);
      expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f-]{36}$/);
      expect(written()).not.toContain("tenant_id");
    });
  });
});

/**
 * DD-118 coverage. This route is bucket (a): the tenant is known AND proven owned by the actor
 * before the seam, so responses below the seam are owed the tenant's language. The 403 above the
 * seam is bucket (b) and stays Vietnamese — asserted here as INTENDED behaviour so a later reader
 * does not "fix" it into a bug.
 */
describe("GET /api/onboarding/readiness — DD-118 language resolution", () => {
  beforeEach(async () => {
    mockSession();
    const { resolveWebSession } = await import("@plexco/db");
    vi.mocked(resolveWebSession).mockResolvedValue({
      sessionId: "s1",
      accountId: "a1",
      personId: "p1",
      csrfSecret: "c1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    allow();
    // The one string emitted BELOW the seam today.
    vi.mocked(onboardingSnapshot).mockResolvedValue(null);
    // Call history does NOT reset between cases in this project's vitest config, and the
    // never-read-before-proof assertion below is about THIS request. Without the clear it reads
    // the calls the preceding cases made and fails for a reason that has nothing to do with it.
    vi.mocked(tenantLocale).mockClear();
  });

  async function messageOf(res: Response): Promise<string> {
    const body = (await res.json()) as { error: { message: string } | null };
    return body.error?.message ?? "";
  }

  it("(a) answers an EN tenant in English below the seam", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(404);
    expect(await messageOf(res)).toBe("No onboarding run yet.");
  });

  it("(a) answers a VI tenant in Vietnamese below the seam", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("vi");
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(404);
    expect(await messageOf(res)).toBe("Chưa có onboarding run.");
  });

  it("fails closed to Vietnamese when the tenant locale is undetermined (DD-118)", async () => {
    vi.mocked(tenantLocale).mockResolvedValue(null);
    const res = await GET(reqFor(TENANT_ID));
    expect(await messageOf(res)).toBe("Chưa có onboarding run.");
  });

  // THE BOUNDARY. Not an oversight: resolving language above the ownership check would answer a
  // stranger's probe in the probed tenant's language, leaking both that the tenant exists and how
  // it is configured. DD-118 ratifies pre-proof responses as Vietnamese.
  it("(b) keeps the 403 Vietnamese even when the caller owns an EN tenant elsewhere", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    deny("tenant_context");
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
    expect(await messageOf(res)).toBe("Bạn không có quyền với CLB này.");
  });

  // The oracle argument, asserted structurally rather than trusted: a caller who does not own the
  // tenant must not cause its locale to be read at all.
  it("(b) never reads the tenant's locale before ownership is proven", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    deny();
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
    expect(tenantLocale).not.toHaveBeenCalled();
  });
});

/**
 * Audit 2026-09-06 W-5: REQUIRED_STEPS used to contain `tg_bind` — a step no code path ever
 * writes (Telegram left phase-1 in DD-37) — so `ready` could never become true, and
 * `first_session` was optional, the opposite of the spec. The predicate is now the BE spec's
 * (feature_web_auth_onboarding_tech.md §"Tenant readiness matrix"): club_config + bank_connect +
 * first_session verified; zalo_connect optional and never decisive.
 */
describe("GET /api/onboarding/readiness — readiness predicate (audit W-5)", () => {
  beforeEach(async () => {
    mockSession();
    const { resolveWebSession } = await import("@plexco/db");
    vi.mocked(resolveWebSession).mockResolvedValue({
      sessionId: "s1",
      accountId: "a1",
      personId: "p1",
      csrfSecret: "c1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    allow();
    vi.mocked(tenantLocale).mockResolvedValue("vi");
  });

  async function readinessOf(res: Response): Promise<{
    ready: boolean;
    steps: { step: string; required: boolean; status: string }[];
  }> {
    const body = (await res.json()) as {
      data: { ready: boolean; steps: { step: string; required: boolean; status: string }[] };
    };
    return body.data;
  }

  it("CAN be ready: the three required steps verified => ready:true (this was unreachable before the fix)", async () => {
    vi.mocked(onboardingSnapshot).mockResolvedValue({
      runStatus: "in_progress",
      steps: [
        { step: "club_config", status: "verified" },
        { step: "bank_connect", status: "verified" },
        { step: "first_session", status: "verified" },
      ],
    } as never);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(200);
    const data = await readinessOf(res);
    expect(data.ready).toBe(true);
    expect(data.steps.map((s) => s.step)).toEqual([
      "club_config",
      "bank_connect",
      "first_session",
      "zalo_connect",
    ]);
    expect(data.steps.find((s) => s.step === "first_session")?.required).toBe(true);
    expect(data.steps.some((s) => s.step === "tg_bind")).toBe(false);
  });

  it("bank_connect merely `registered` (not verified) => ready:false", async () => {
    vi.mocked(onboardingSnapshot).mockResolvedValue({
      runStatus: "in_progress",
      steps: [
        { step: "club_config", status: "verified" },
        { step: "bank_connect", status: "registered" },
        { step: "first_session", status: "verified" },
      ],
    } as never);
    const data = await readinessOf(await GET(reqFor(TENANT_ID)));
    expect(data.ready).toBe(false);
  });

  it("zalo_connect is optional: `error` there does not change a ready:true answer", async () => {
    vi.mocked(onboardingSnapshot).mockResolvedValue({
      runStatus: "in_progress",
      steps: [
        { step: "club_config", status: "verified" },
        { step: "bank_connect", status: "verified" },
        { step: "first_session", status: "verified" },
        { step: "zalo_connect", status: "error" },
      ],
    } as never);
    const data = await readinessOf(await GET(reqFor(TENANT_ID)));
    expect(data.ready).toBe(true);
    expect(data.steps.find((s) => s.step === "zalo_connect")?.required).toBe(false);
  });
});
