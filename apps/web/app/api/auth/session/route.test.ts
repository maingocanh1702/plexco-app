import { tenantsForPersonWithProfile } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../../../lib/session-cookies";
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

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

describe("GET /api/auth/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("401 without a session", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
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
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { personId: string; csrfToken: string; tenants: unknown };
    };
    expect(body.data).toMatchObject({ personId: "p", csrfToken: "csrf", tenants });
  });
});
