import { tenantsForPersonWithProfile } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../lib/tenant-lang";
import { GET } from "./route";

vi.mock("@plexco/db", () => ({ tenantsForPersonWithProfile: vi.fn() }));
vi.mock("../../../../lib/session-cookies", () => ({
  currentSession: vi.fn(),
  appDb: vi.fn(() => ({ pool: {}, db: {} })),
}));
vi.mock("../../../../lib/tenant-lang", () => ({ resolveTenantLang: vi.fn() }));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const session = {
  sessionId: "s",
  accountId: "a",
  personId: "p1",
  csrfSecret: "csrf-1",
  expiresAt: new Date("2030-01-01T00:00:00Z"),
} as never;

describe("GET /api/auth/session", () => {
  beforeEach(() => {
    vi.mocked(currentSession).mockReset();
    vi.mocked(tenantsForPersonWithProfile).mockReset();
    vi.mocked(resolveTenantLang).mockReset();
  });

  it("401 AUTH_REQUIRED without a session, and never touches tenants", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_REQUIRED");
    expect(tenantsForPersonWithProfile).not.toHaveBeenCalled();
  });

  it("returns person, csrf and tenants with profile (M1b) and locale (DD-118)", async () => {
    vi.mocked(currentSession).mockResolvedValue(session);
    vi.mocked(tenantsForPersonWithProfile).mockResolvedValue([
      { tenantId: A, role: "owner", name: "CLB A", slug: "a", locale: "en", timezone: "UTC" },
    ]);
    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(resolveTenantLang).not.toHaveBeenCalled();
    expect(body.data).toEqual({
      personId: "p1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      csrfToken: "csrf-1",
      tenants: [
        { tenantId: A, role: "owner", name: "CLB A", slug: "a", locale: "en", timezone: "UTC" },
      ],
    });
  });

  it("a tenant whose profile read failed (locale null) falls back to the DD-118 seam", async () => {
    vi.mocked(currentSession).mockResolvedValue(session);
    vi.mocked(tenantsForPersonWithProfile).mockResolvedValue([
      { tenantId: B, role: "admin", name: null, slug: null, locale: null, timezone: null },
    ]);
    vi.mocked(resolveTenantLang).mockResolvedValue("vi");
    const body = await (await GET()).json();
    expect(body.data.tenants).toEqual([
      { tenantId: B, role: "admin", name: null, slug: null, locale: "vi", timezone: null },
    ]);
  });

  it("an empty membership list is a valid answer (new account -> create-club flow)", async () => {
    vi.mocked(currentSession).mockResolvedValue(session);
    vi.mocked(tenantsForPersonWithProfile).mockResolvedValue([]);
    expect((await (await GET()).json()).data.tenants).toEqual([]);
  });
});
