import { describe, expect, it, vi } from "vitest";
import { tenantsForPersonWithProfile } from "./auth.js";

// DB-free: pool.query answers tenant_ids_for_person; db.transaction stands in for withTenant.
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const pool = {
  query: vi.fn(async () => ({
    rows: [
      { tenant_id: T1, role: "owner" },
      { tenant_id: T2, role: "admin" },
    ],
  })),
};

describe("tenantsForPersonWithProfile", () => {
  it("fails open per tenant: one throwing profile read yields nulls and never rejects", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    let call = 0;
    const db = {
      transaction: vi.fn(async (fn: (tx: unknown) => unknown) => {
        call += 1;
        if (call === 1) throw new Error("tenant_profile_read boom");
        return fn({
          execute: async () => ({
            rows: [{ name: "Club 2", slug: "c2", locale: "en", timezone: "Asia/Tokyo" }],
          }),
        });
      }),
    };
    const result = await tenantsForPersonWithProfile({ pool, db } as never, "p");
    expect(result).toEqual([
      { tenantId: T1, role: "owner", name: null, slug: null, locale: null, timezone: null },
      {
        tenantId: T2,
        role: "admin",
        name: "Club 2",
        slug: "c2",
        locale: "en",
        timezone: "Asia/Tokyo",
      },
    ]);
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
