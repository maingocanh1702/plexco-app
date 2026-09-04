import { tenantLocale } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveTenantLang } from "./tenant-lang";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {}, db: {} })),
  tenantLocale: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const db = {} as never;

describe("resolveTenantLang — the single DD-118 derivation", () => {
  beforeEach(() => vi.mocked(tenantLocale).mockReset());

  it("returns the tenant's configured language when it is en", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    expect(await resolveTenantLang(db, TENANT)).toBe("en");
  });

  it("returns vi when the tenant is configured vi", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("vi");
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  it("normalises casing and surrounding space, because parseLang owns that vocabulary", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("  EN  ");
    expect(await resolveTenantLang(db, TENANT)).toBe("en");
  });

  // DD-118: "request không resolve được tenant, hoặc tenant có locale không nhận dạng được ⇒ vi".
  // Each of these reaches the default by a DIFFERENT route, and they are asserted separately so a
  // regression in one cannot hide behind another.
  it("fails closed to vi when the locale is undetermined (null)", async () => {
    vi.mocked(tenantLocale).mockResolvedValue(null);
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  it("fails closed to vi when the stored value is outside the vi/en vocabulary", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("fr");
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  it("fails closed to vi on an empty stored value", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("");
    expect(await resolveTenantLang(db, TENANT)).toBe("vi");
  });

  // The seam DD-118 pins: resolveLang(memberLocale, tenantDefault) is called with memberLocale =
  // null because no member-locale column exists. This asserts the tenant value is what flows
  // through today — the test that will need updating when that column lands, which is the point.
  it("reads the tenant value through tenant_locale exactly once per resolution", async () => {
    vi.mocked(tenantLocale).mockResolvedValue("en");
    await resolveTenantLang(db, TENANT);
    expect(tenantLocale).toHaveBeenCalledTimes(1);
    expect(tenantLocale).toHaveBeenCalledWith(db, TENANT);
  });
});
