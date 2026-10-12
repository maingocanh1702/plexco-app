import { tenantsForPerson } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../lib/tenant-lang";
import { GET } from "./route";

vi.mock("@plexco/db", () => ({ tenantsForPerson: vi.fn() }));
vi.mock("../../../../lib/session-cookies", () => ({
  currentSession: vi.fn(),
  appDb: vi.fn(() => ({ pool: {}, db: {} })),
}));
vi.mock("../../../../lib/tenant-lang", () => ({ resolveTenantLang: vi.fn() }));

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

describe("GET /api/auth/session", () => {
  beforeEach(() => {
    vi.mocked(currentSession).mockReset();
    vi.mocked(tenantsForPerson).mockReset();
    vi.mocked(resolveTenantLang).mockReset();
  });

  it("401 AUTH_REQUIRED without a session, and never touches tenants", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("AUTH_REQUIRED");
    expect(tenantsForPerson).not.toHaveBeenCalled();
  });

  it("returns each tenant with its resolved locale (DD-118) plus csrf + expiry", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a",
      personId: "p1",
      csrfSecret: "csrf-1",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    } as never);
    vi.mocked(tenantsForPerson).mockResolvedValue([
      { tenantId: A, role: "owner" },
      { tenantId: B, role: "admin" },
    ]);
    vi.mocked(resolveTenantLang).mockImplementation(async (_db, id) => (id === A ? "en" : "vi"));

    const res = await GET();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(body.data).toEqual({
      personId: "p1",
      expiresAt: "2030-01-01T00:00:00.000Z",
      csrfToken: "csrf-1",
      tenants: [
        { tenantId: A, role: "owner", locale: "en" },
        { tenantId: B, role: "admin", locale: "vi" },
      ],
    });
  });

  it("an empty membership list is a valid answer (new account -> create-club flow)", async () => {
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: "a",
      personId: "p1",
      csrfSecret: "c",
      expiresAt: new Date("2030-01-01T00:00:00Z"),
    } as never);
    vi.mocked(tenantsForPerson).mockResolvedValue([]);
    const body = await (await GET()).json();
    expect(body.data.tenants).toEqual([]);
  });
});
