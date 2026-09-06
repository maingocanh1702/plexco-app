import { onboardingSnapshot, tenantLocale, tenantsForPerson } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {}, db: {} })),
  onboardingSnapshot: vi.fn(),
  resolveWebSession: vi.fn(),
  tenantsForPerson: vi.fn(),
  tenantLocale: vi.fn(),
}));

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

describe("GET /api/onboarding/readiness — owner-only authz (codex round-14)", () => {
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
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT_ID, role: "owner" }]);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(200);
  });

  it("rejects a delegated 'admin' (not the owner) — API contract is TenantOwner-only", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT_ID, role: "admin" }]);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
  });

  it("rejects a delegated 'co_admin' (not the owner)", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT_ID, role: "co_admin" }]);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
  });

  it("rejects someone with no membership in this tenant at all", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([]);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
  });

  it("rejects an owner of a DIFFERENT tenant", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([
      { tenantId: "22222222-2222-2222-2222-222222222222", role: "owner" },
    ]);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
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
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT_ID, role: "owner" }]);
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
    vi.mocked(tenantsForPerson).mockResolvedValue([
      { tenantId: "22222222-2222-2222-2222-222222222222", role: "owner" },
    ]);
    const res = await GET(reqFor(TENANT_ID));
    expect(res.status).toBe(403);
    expect(await messageOf(res)).toBe("Bạn không phải chủ CLB này.");
  });

  // The oracle argument, asserted structurally rather than trusted: a caller who does not own the
  // tenant must not cause its locale to be read at all.
  it("(b) never reads the tenant's locale before ownership is proven", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    vi.mocked(tenantsForPerson).mockResolvedValue([]);
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
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT_ID, role: "owner" }]);
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
