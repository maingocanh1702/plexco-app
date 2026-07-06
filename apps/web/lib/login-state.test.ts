import { cookies } from "next/headers";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLoginState, issueLoginState } from "@plexco/db";
import { consumeLoginStateCookie, issueLoginStateCookie, LOGIN_STATE_COOKIE } from "./login-state";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  issueLoginState: vi.fn(),
  consumeLoginState: vi.fn(),
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

describe("issueLoginStateCookie", () => {
  beforeEach(() => {
    vi.mocked(issueLoginState).mockReset();
  });

  it("stores a state hash and sets an httpOnly single-use pre-auth cookie", async () => {
    const store = mockCookieStore(undefined);
    await issueLoginStateCookie();

    expect(issueLoginState).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ stateHash: expect.any(String), ttlSeconds: 600 }),
    );
    expect(store.set).toHaveBeenCalledWith(
      LOGIN_STATE_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, sameSite: "strict" }),
    );
  });

  it("never stores the raw token — only its hash reaches the DB call", async () => {
    mockCookieStore(undefined);
    await issueLoginStateCookie();
    const [, arg] = vi.mocked(issueLoginState).mock.calls[0]!;
    expect(arg.stateHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("consumeLoginStateCookie", () => {
  beforeEach(() => {
    vi.mocked(consumeLoginState).mockReset();
  });

  it("consumes the cookie's hash and clears the cookie on success", async () => {
    const store = mockCookieStore("raw-state-token");
    vi.mocked(consumeLoginState).mockResolvedValue(true);

    expect(await consumeLoginStateCookie()).toBe(true);
    expect(store.delete).toHaveBeenCalledWith(LOGIN_STATE_COOKIE);
  });

  it("fails closed (false, no DB call) when the cookie is missing", async () => {
    const store = mockCookieStore(undefined);
    expect(await consumeLoginStateCookie()).toBe(false);
    expect(consumeLoginState).not.toHaveBeenCalled();
    expect(store.delete).toHaveBeenCalledWith(LOGIN_STATE_COOKIE);
  });

  it("fails closed when the DB reports expired/already-consumed/unknown", async () => {
    mockCookieStore("stale-token");
    vi.mocked(consumeLoginState).mockResolvedValue(false);
    expect(await consumeLoginStateCookie()).toBe(false);
  });
});
