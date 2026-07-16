import { rateLimitCheck } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLoginStateCookie } from "../../../../../lib/login-state";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  rateLimitCheck: vi.fn(),
  loginTelegram: vi.fn(),
  LoginReplayError: class LoginReplayError extends Error {},
}));

vi.mock("../../../../../lib/login-state", () => ({
  consumeLoginStateCookie: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";

function reqFrom(ip: string): Request {
  return new Request("https://plexco.app/api/auth/telegram/callback", {
    method: "POST",
    headers: { host: "plexco.app", origin: "https://plexco.app", "do-connecting-ip": ip },
    body: "{}",
  });
}

/**
 * codex round-04: the IP rate limiter must bound EVERY callback attempt,
 * including ones with an invalid/missing login-state cookie — otherwise an
 * attacker can hammer the endpoint at unlimited rate simply by never
 * presenting a valid state, never touching the documented 10/min/IP bound.
 */
describe("POST /api/auth/telegram/callback — rate-limit ordering", () => {
  beforeEach(() => {
    vi.mocked(rateLimitCheck).mockReset();
    vi.mocked(consumeLoginStateCookie).mockReset();
  });

  it("checks the IP rate limiter even when the login-state cookie is invalid", async () => {
    vi.mocked(rateLimitCheck).mockResolvedValue(true); // under the limit
    vi.mocked(consumeLoginStateCookie).mockResolvedValue(false); // invalid state

    const res = await POST(reqFrom("1.2.3.4"));

    expect(rateLimitCheck).toHaveBeenCalledWith(expect.anything(), "login:1.2.3.4", 10, 60);
    expect(res.status).toBe(401);
  });

  it("rejects with 429 BEFORE ever consuming the login-state, once the IP is rate-limited", async () => {
    vi.mocked(rateLimitCheck).mockResolvedValue(false); // over the limit

    const res = await POST(reqFrom("9.9.9.9"));

    expect(res.status).toBe(429);
    expect(consumeLoginStateCookie).not.toHaveBeenCalled();
  });
});
