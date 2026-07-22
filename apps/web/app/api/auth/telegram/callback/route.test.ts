import { loginTelegram, rateLimitCheck } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { consumeLoginStateCookie } from "../../../../../lib/login-state";
import { issueSession, SessionReauthRequiredError } from "../../../../../lib/session-cookies";
import {
  normalizeTelegramPayload,
  telegramLoginNonce,
  telegramUserLookupHash,
  verifyTelegramLogin,
} from "../../../../../lib/telegram-login";
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

// Partial mock: keep the real same-origin / clientIp / rateLimited / appDb the
// existing rate-limit tests exercise; override ONLY issueSession so the fence
// can be driven to throw. SessionReauthRequiredError stays the real class, so
// the route's `instanceof` in its catch resolves to the same reference.
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return { ...actual, issueSession: vi.fn() };
});

vi.mock("../../../../../lib/telegram-login", () => ({
  normalizeTelegramPayload: vi.fn(),
  verifyTelegramLogin: vi.fn(),
  telegramUserLookupHash: vi.fn(),
  telegramLoginNonce: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.TRUSTED_INGRESS_PROVIDER = "digitalocean";
// Unconditional (not ??=): .env.example documents a BLANK TELEGRAM_BOT_TOKEN,
// and `??=` would leave that empty string in place — the route then answers
// 503 AUTH_UNAVAILABLE before ever reaching issueSession, so the fence tests
// must pin a nonempty token regardless of the ambient env.
process.env.TELEGRAM_BOT_TOKEN = "test-bot-token";

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

/**
 * G3-B3 / D0-12: when issueSession hits the fence (rotate returned null for a
 * stale cookie — e.g. a concurrent logout-all won), it throws
 * SessionReauthRequiredError; this caller must map it to a generic 401
 * AUTH_INVALID with no internal reason leaked. An unrelated error must still
 * propagate — the catch is specific, not a swallow-all.
 */
describe("POST /api/auth/telegram/callback — issuance-fence mapping (G3-B3, D0-12)", () => {
  beforeEach(() => {
    vi.mocked(rateLimitCheck).mockResolvedValue(true); // under the limit
    vi.mocked(consumeLoginStateCookie).mockResolvedValue(true);
    vi.mocked(normalizeTelegramPayload).mockReturnValue({ id: "1", auth_date: "1", hash: "h" });
    vi.mocked(verifyTelegramLogin).mockReturnValue({
      ok: true,
      telegramUserId: "1",
      displayName: "Player One",
    });
    vi.mocked(telegramUserLookupHash).mockResolvedValue("lookup-hash");
    vi.mocked(telegramLoginNonce).mockReturnValue("login-nonce");
    vi.mocked(loginTelegram).mockResolvedValue({
      accountId: "acc-1",
      personId: "person-1",
      created: false,
    });
    vi.mocked(issueSession).mockReset();
  });

  it("maps SessionReauthRequiredError to a generic 401 AUTH_INVALID, no reason leaked", async () => {
    vi.mocked(issueSession).mockRejectedValue(new SessionReauthRequiredError());

    const res = await POST(reqFrom("1.2.3.4"));

    expect(issueSession).toHaveBeenCalledWith("acc-1");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTH_INVALID");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("reauth");
  });

  it("does NOT swallow an unrelated issueSession error (mapping is specific)", async () => {
    vi.mocked(issueSession).mockRejectedValue(new Error("db exploded"));

    await expect(POST(reqFrom("1.2.3.5"))).rejects.toThrow("db exploded");
  });
});
