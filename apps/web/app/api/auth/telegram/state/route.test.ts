import { rateLimitCheck } from "@plexco/db";
import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  rateLimitCheck: vi.fn(),
  issueLoginState: vi.fn(),
  consumeLoginState: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";

function mockCookieStore() {
  const store = { get: vi.fn(), delete: vi.fn(), set: vi.fn() };
  vi.mocked(cookies).mockResolvedValue(store as never);
  return store;
}

function reqFrom(ip: string): Request {
  return new Request("https://plexco.app/api/auth/telegram/state", {
    headers: { "do-connecting-ip": ip },
  });
}

/**
 * codex round-01: this unauthenticated GET must not be mintable without
 * bound, or an attacker can grow auth_login_state unbounded before ever
 * reaching the login callback's own limiter.
 */
describe("GET /api/auth/telegram/state", () => {
  beforeEach(() => {
    vi.mocked(rateLimitCheck).mockReset();
  });

  it("issues a state cookie when under the rate limit", async () => {
    const store = mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true); // allowed

    const res = await GET(reqFrom("1.2.3.4"));

    expect(rateLimitCheck).toHaveBeenCalledWith(expect.anything(), "login-state:1.2.3.4", 10, 60);
    expect(store.set).toHaveBeenCalled();
    expect(res.status).toBe(200);
  });

  it("rejects with 429 and mints NOTHING once the IP is rate-limited", async () => {
    const store = mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(false); // over limit

    const res = await GET(reqFrom("9.9.9.9"));

    expect(res.status).toBe(429);
    expect(store.set).not.toHaveBeenCalled();
  });

  it("keys the limiter bucket per-IP (one attacker IP cannot exhaust another's budget)", async () => {
    mockCookieStore();
    vi.mocked(rateLimitCheck).mockResolvedValue(true);

    await GET(reqFrom("1.1.1.1"));
    await GET(reqFrom("2.2.2.2"));

    expect(rateLimitCheck).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      "login-state:1.1.1.1",
      10,
      60,
    );
    expect(rateLimitCheck).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      "login-state:2.2.2.2",
      10,
      60,
    );
  });
});
