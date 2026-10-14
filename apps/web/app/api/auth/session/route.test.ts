import { tenantsForPersonWithProfile } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../lib/tenant-lang";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({ pool: {}, db: {} })),
    tenantsForPersonWithProfile: vi.fn(),
  };
});
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return { ...actual, appDb: vi.fn(() => ({ pool: {}, db: {} })), currentSession: vi.fn() };
});
vi.mock("../../../../lib/tenant-lang", () => ({ resolveTenantLang: vi.fn() }));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("GET /api/auth/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(resolveTenantLang).not.toHaveBeenCalled();
  });

  it("401 without a session", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("returns each tenant with its resolved locale (DD-118) plus csrf + expiry", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a",
      personId: "p1",
      csrfSecret: "csrf-1",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    } as never);
    // A's profile read failed (nulls); B's stored "fr" is outside vi/en. Each tenant must serve the
    // resolved DD-118 value, never the raw profile one (`m.locale ?? resolve...` would serve "fr").
    vi.mocked(tenantsForPersonWithProfile).mockResolvedValue([
      { tenantId: A, role: "owner", name: null, slug: null, locale: null, timezone: null },
      {
        tenantId: B,
        role: "admin",
        name: "CLB B",
        slug: "clb-b",
        locale: "fr",
        timezone: "Asia/Ho_Chi_Minh",
      },
    ]);
    // One at a time: a person in many clubs must not take the whole pool (peak in-flight = 1).
    let inFlight = 0;
    let peak = 0;
    vi.mocked(resolveTenantLang).mockImplementation(async (_db, id) => {
      peak = Math.max(peak, ++inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return id === A ? "en" : "vi";
    });

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toEqual({
      personId: "p1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      csrfToken: "csrf-1",
      tenants: [
        { tenantId: A, role: "owner", name: null, slug: null, locale: "en", timezone: null },
        {
          tenantId: B,
          role: "admin",
          name: "CLB B",
          slug: "clb-b",
          locale: "vi",
          timezone: "Asia/Ho_Chi_Minh",
        },
      ],
    });
    expect(peak).toBe(1);
  });

  it("returns person, csrf and tenants enriched with profile (additive over tenantId/role)", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a",
      personId: "p",
      csrfSecret: "csrf",
      expiresAt: new Date("2030-01-01"),
    });
    const tenants = [
      {
        tenantId: "t1",
        role: "owner",
        name: "CLB",
        slug: "clb",
        locale: "vi",
        timezone: "Asia/Ho_Chi_Minh",
      },
    ];
    vi.mocked(tenantsForPersonWithProfile).mockResolvedValue(tenants);
    vi.mocked(resolveTenantLang).mockResolvedValue("vi");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { personId: string; csrfToken: string; tenants: unknown };
    };
    expect(body.data).toMatchObject({ personId: "p", csrfToken: "csrf", tenants });
  });

  it("an empty membership list is a valid answer (new account -> create-club flow)", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a",
      personId: "p1",
      csrfSecret: "c",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    } as never);
    vi.mocked(tenantsForPersonWithProfile).mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(body.data.tenants).toEqual([]);
  });
});
