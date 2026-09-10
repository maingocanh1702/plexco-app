import { revokeWebSession } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  revokeWebSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

function mockCookieStore(value: string | undefined) {
  const store = {
    get: vi.fn(() => (value === undefined ? undefined : { value })),
    delete: vi.fn(),
    set: vi.fn(),
  };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

describe("POST /api/auth/logout", () => {
  beforeEach(() => {
    vi.mocked(revokeWebSession).mockReset();
  });

  it("revokes the session and clears the cookie when a real session is present", async () => {
    const store = mockCookieStore("raw-token");
    vi.mocked(revokeWebSession).mockResolvedValue(true);

    const res = await POST();

    expect(revokeWebSession).toHaveBeenCalledWith(expect.anything(), expect.any(String));
    expect(store.set).toHaveBeenCalledWith(
      SESSION_COOKIE,
      "",
      expect.objectContaining({ maxAge: 0, path: "/", httpOnly: true }),
    ); // cleared as an expiring SET: a bare delete() omits Secure and a prefixed cookie ignores it
    expect(res.status).toBe(200);
  });

  it("logout CSRF: a cross-site POST with no ambient cookie revokes and clears nothing", async () => {
    const store = mockCookieStore(undefined);

    const res = await POST();

    expect(revokeWebSession).not.toHaveBeenCalled();
    expect(store.delete).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("a stale/forged cookie matching no live session is left in place, not cleared", async () => {
    const store = mockCookieStore("stale-or-forged-token");
    vi.mocked(revokeWebSession).mockResolvedValue(false);

    await POST();

    expect(store.delete).not.toHaveBeenCalled();
  });
});
