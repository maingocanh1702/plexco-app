import { onboardingSnapshot, tenantsForPerson } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {}, db: {} })),
  onboardingSnapshot: vi.fn(),
  resolveWebSession: vi.fn(),
  tenantsForPerson: vi.fn(),
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
