import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Handler logic with every dependency below the session boundary mocked: the persona resolver, the
 * session issuer, the exposure probe and next/headers. The real-database path (seed -> dev login ->
 * owner action / player refusal / cookie and row shape) is dev-login-db.test.ts.
 */
type CookieSet = { name: string; value: string; options: Record<string, unknown> };
const jar = vi.hoisted(() => ({ values: new Map<string, string>(), sets: [] as CookieSet[] }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.values.has(name) ? { name, value: jar.values.get(name)! } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      jar.sets.push({ name, value, options });
      if (options.maxAge === 0) jar.values.delete(name);
      else jar.values.set(name, value);
    },
  }),
}));
vi.mock("./network-exposure", () => ({ devServerLoopbackOnly: vi.fn(async () => true) }));
vi.mock("./persona-account", () => ({ resolveDevPersonaAccount: vi.fn() }));
vi.mock("./database-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./database-guard")>();
  return { ...actual, devLoginDatabaseVerdict: vi.fn() };
});
vi.mock("../session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../session-cookies")>();
  return { ...actual, issueSession: vi.fn(), appDb: vi.fn(() => ({ pool: { tag: "pool" } })) };
});

import { issueSession, SessionReauthRequiredError } from "../session-cookies";
import { DEV_LOGIN_CSRF_COOKIE } from "./csrf";
import { devLoginDatabaseVerdict } from "./database-guard";
import { handleDevLoginOtherMethod, handleDevLoginPage, handleDevLoginSession } from "./handlers";
import { devServerLoopbackOnly } from "./network-exposure";
import { resolveDevPersonaAccount } from "./persona-account";

const HOST = "127.0.0.1:3000";
const OPEN_ENV = {
  NODE_ENV: "development",
  PLEXCO_DEV_LOGIN: "1",
  TRUSTED_INGRESS_PROVIDER: "direct",
  DATABASE_URL: "postgres://app:plexco_dev_app@localhost:5432/plexco",
  __NEXT_PRIVATE_ORIGIN: "http://127.0.0.1:3000", // next dev -H 127.0.0.1 -p 3000 (measured shape)
  PORT: "3000",
};

function stubOpenEnv(override: Partial<Record<keyof typeof OPEN_ENV, string | undefined>> = {}) {
  for (const [key, value] of Object.entries({ ...OPEN_ENV, ...override })) {
    vi.stubEnv(key, value as string);
    if (value === undefined) delete process.env[key];
  }
}

function injected(host = HOST): Record<string, string> {
  return {
    host,
    "x-forwarded-for": "127.0.0.1",
    "x-forwarded-host": host,
    "x-forwarded-port": host.split(":")[1] ?? "80",
    "x-forwarded-proto": "http",
  };
}

function pageRequest(search = "", host = HOST): Request {
  return new Request(`http://localhost:3000/internal-dev-login/page${search}`, {
    headers: injected(host),
  });
}

function loginRequest(
  fields: Record<string, string>,
  opts: { origin?: string | null; contentType?: string; rawBody?: string; host?: string } = {},
): Request {
  const headers: Record<string, string> = {
    ...injected(opts.host),
    "content-type": opts.contentType ?? "application/x-www-form-urlencoded",
  };
  const origin = opts.origin === undefined ? `http://${HOST}` : opts.origin;
  if (origin !== null) headers.origin = origin;
  return new Request("http://localhost:3000/internal-dev-login/session", {
    method: "POST",
    headers,
    body: opts.rawBody ?? new URLSearchParams(fields).toString(),
  });
}

const OWNER = { accountId: "acc-owner", personId: "per-owner", outcome: "login_success" as const };

beforeEach(() => {
  jar.values.clear();
  jar.sets.length = 0;
  vi.mocked(issueSession).mockReset().mockResolvedValue({ csrfToken: "session-csrf" });
  vi.mocked(resolveDevPersonaAccount).mockReset().mockResolvedValue(OWNER);
  vi.mocked(devServerLoopbackOnly).mockReset().mockResolvedValue(true);
  vi.mocked(devLoginDatabaseVerdict)
    .mockReset()
    .mockResolvedValue({ ok: true, database: "plexco" });
  stubOpenEnv();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("second-layer gate inside both handlers", () => {
  it.each([
    ["NODE_ENV", { NODE_ENV: "production" }],
    ["flag", { PLEXCO_DEV_LOGIN: undefined }],
    ["ingress", { TRUSTED_INGRESS_PROVIDER: "digitalocean" }],
    ["database url", { DATABASE_URL: "postgres://app:x@db.example.com:5432/plexco" }],
    ["bind evidence (no -H: binds *)", { __NEXT_PRIVATE_ORIGIN: "http://localhost:3000" }],
    ["bind evidence (-H ::)", { __NEXT_PRIVATE_ORIGIN: "http://[::1]:3000" }],
  ])("%s false => bare 404, no cookie, no persona resolution, no session", async (_, override) => {
    stubOpenEnv(override);
    const page = await handleDevLoginPage(pageRequest());
    const login = await handleDevLoginSession(loginRequest({ persona: "owner", csrf: "x" }));
    for (const response of [page, login]) {
      expect(response.status).toBe(404);
      expect(await response.text()).toBe("");
    }
    expect(jar.sets).toEqual([]);
    expect(resolveDevPersonaAccount).not.toHaveBeenCalled();
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("non-loopback Host => 404 before anything else", async () => {
    expect((await handleDevLoginPage(pageRequest("", "192.168.1.20:3000"))).status).toBe(404);
    expect(jar.sets).toEqual([]);
  });

  it("network-exposed dev server (probe) => 404 even with every header right", async () => {
    vi.mocked(devServerLoopbackOnly).mockResolvedValue(false);
    expect((await handleDevLoginPage(pageRequest())).status).toBe(404);
    expect((await handleDevLoginSession(loginRequest({ persona: "owner" }))).status).toBe(404);
    expect(jar.sets).toEqual([]);
    expect(resolveDevPersonaAccount).not.toHaveBeenCalled();
  });

  it.each([
    [
      "the database is not opted in",
      { ok: false, reason: "database_not_opted_in", database: "plexco" },
    ],
    [
      "the role bypasses RLS (superuser / BYPASSRLS)",
      { ok: false, reason: "role_bypasses_rls", database: "plexco" },
    ],
  ] as const)("DB guard: %s => 404 before any cookie or write", async (_, verdict) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(devLoginDatabaseVerdict).mockResolvedValue(verdict);
    expect((await handleDevLoginPage(pageRequest())).status).toBe(404);
    expect((await handleDevLoginSession(loginRequest({ persona: "owner" }))).status).toBe(404);
    expect(jar.sets).toEqual([]);
    expect(resolveDevPersonaAccount).not.toHaveBeenCalled();
    expect(String(warn.mock.calls[0]?.[0])).toContain(verdict.reason);
  });

  it("DB guard: an unreachable database => 404 (fail closed, never a 500)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(devLoginDatabaseVerdict).mockRejectedValue(new Error("connect ECONNREFUSED"));
    expect((await handleDevLoginPage(pageRequest())).status).toBe(404);
    expect(jar.sets).toEqual([]);
  });
});

describe("GET page", () => {
  it("sets a Strict, HttpOnly, POST-path-scoped double-submit cookie and renders the same token", async () => {
    const response = await handleDevLoginPage(pageRequest());
    expect(response.status).toBe(200);
    expect(jar.sets).toHaveLength(1);
    const [set] = jar.sets;
    expect(set!.name).toBe(DEV_LOGIN_CSRF_COOKIE);
    expect(set!.options).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/internal-dev-login/session",
      maxAge: 1800,
    });
    expect(set!.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await response.text()).toContain(`name="csrf" value="${set!.value}"`);
  });

  it("renders only closed-set errors", async () => {
    const shown = await (await handleDevLoginPage(pageRequest("?error=reauth"))).text();
    expect(shown).toContain('role="alert"');
    const ignored = await (await handleDevLoginPage(pageRequest("?error=%3Cb%3Ex"))).text();
    expect(ignored).not.toContain('role="alert"');
    expect(ignored).not.toContain("<b>x");
  });
});

describe("POST login — CSRF while the gate is open", () => {
  async function primeToken(): Promise<string> {
    await handleDevLoginPage(pageRequest());
    return jar.values.get(DEV_LOGIN_CSRF_COOKIE)!;
  }

  it("missing token (no cookie, no field) => 403 CSRF_INVALID, no session", async () => {
    const response = await handleDevLoginSession(loginRequest({ persona: "owner" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error.code).toBe("CSRF_INVALID");
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("field present but no cookie => 403", async () => {
    const response = await handleDevLoginSession(
      loginRequest({ persona: "owner", csrf: "forged" }),
    );
    expect(response.status).toBe(403);
    expect(resolveDevPersonaAccount).not.toHaveBeenCalled();
  });

  it("cookie present but field missing => 403", async () => {
    await primeToken();
    const response = await handleDevLoginSession(loginRequest({ persona: "owner" }));
    expect(response.status).toBe(403);
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("mismatched token => 403, and the cookie survives for a retry from the real page", async () => {
    const token = await primeToken();
    const response = await handleDevLoginSession(
      loginRequest({ persona: "owner", csrf: token.replace(/.$/, (c) => (c === "A" ? "B" : "A")) }),
    );
    expect(response.status).toBe(403);
    expect(jar.values.get(DEV_LOGIN_CSRF_COOKIE)).toBe(token);
    expect(issueSession).not.toHaveBeenCalled();
  });

  it.each([
    ["cross-site Origin", "https://evil.example"],
    ["same host, different port", "http://127.0.0.1:4000"],
    ["no Origin and no Referer", null],
  ])("valid token but %s => 403 (sameOriginRequest)", async (_, origin) => {
    const token = await primeToken();
    const response = await handleDevLoginSession(
      loginRequest({ persona: "owner", csrf: token }, { origin }),
    );
    expect(response.status).toBe(403);
    expect(issueSession).not.toHaveBeenCalled();
  });
});

describe("POST login — body and persona validation", () => {
  it("wrong content type => 400", async () => {
    await handleDevLoginPage(pageRequest());
    const token = jar.values.get(DEV_LOGIN_CSRF_COOKIE)!;
    const response = await handleDevLoginSession(
      loginRequest(
        {},
        {
          contentType: "application/json",
          rawBody: JSON.stringify({ persona: "owner", csrf: token }),
        },
      ),
    );
    expect(response.status).toBe(400);
  });

  it("oversized body => 400 before parsing", async () => {
    const response = await handleDevLoginSession(
      loginRequest({}, { rawBody: `persona=owner&pad=${"x".repeat(2048)}` }),
    );
    expect(response.status).toBe(400);
  });

  it.each(["", "OWNER", "admin", "owner ", "superuser"])(
    "unknown persona %j => 400",
    async (persona) => {
      await handleDevLoginPage(pageRequest());
      const token = jar.values.get(DEV_LOGIN_CSRF_COOKIE)!;
      const response = await handleDevLoginSession(loginRequest({ persona, csrf: token }));
      expect(response.status).toBe(400);
      expect(resolveDevPersonaAccount).not.toHaveBeenCalled();
    },
  );
});

describe("POST login — the session path", () => {
  async function login(persona = "owner") {
    await handleDevLoginPage(pageRequest());
    const token = jar.values.get(DEV_LOGIN_CSRF_COOKIE)!;
    return handleDevLoginSession(loginRequest({ persona, csrf: token }));
  }

  it("resolves the persona through the shared resolver, issues THE session, consumes the token, 303 to /", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = await login("owner");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const [pool, persona, requestRef] = vi.mocked(resolveDevPersonaAccount).mock.calls[0]!;
    expect(pool).toEqual({ tag: "pool" });
    expect(persona.key).toBe("owner");
    expect(requestRef).toMatch(/^dev_login_[0-9a-f-]{36}$/);
    expect(issueSession).toHaveBeenCalledWith("acc-owner");
    expect(jar.values.has(DEV_LOGIN_CSRF_COOKIE)).toBe(false); // single-use

    // Structured audit event: ids only, never the email or the display name.
    const lines = log.mock.calls.map(
      (call) => JSON.parse(String(call[0])) as Record<string, unknown>,
    );
    const event = lines.find((line) => line.event === "auth.dev_login");
    expect(event).toMatchObject({
      level: "info",
      accountId: "acc-owner",
      personId: "per-owner",
      persona: "owner",
      requestRef,
    });
    const serialized = JSON.stringify(lines);
    expect(serialized).not.toContain("@dev.invalid");
    expect(serialized).not.toContain("(fake)");
  });

  it("a stale session cookie the DB refuses to rotate => 303 back to the page with error=reauth", async () => {
    vi.mocked(issueSession).mockRejectedValue(new SessionReauthRequiredError());
    const response = await login("player");
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dev-login?error=reauth");
  });

  it("identity_conflict from the definer => 403, no session", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(resolveDevPersonaAccount).mockResolvedValue({
      ...OWNER,
      outcome: "identity_conflict",
    });
    const response = await login();
    expect(response.status).toBe(403);
    expect(issueSession).not.toHaveBeenCalled();
  });

  it("an unexpected failure (e.g. no ENCRYPTION_KEY) => 303 error=unavailable and an error log, never a 500", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(resolveDevPersonaAccount).mockRejectedValue(new Error("ENCRYPTION_KEY is not set"));
    const response = await login();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/dev-login?error=unavailable");
    expect(String(error.mock.calls[0]?.[0])).toContain("auth.dev_login.unhandled");
  });
});

describe("every other HTTP method on the implementation routes", () => {
  it.each(["GET", "POST"] as const)(
    "gate closed => bare 404 (never Next's own 405 / 204 Allow), allow=%s",
    async (allow) => {
      stubOpenEnv({ PLEXCO_DEV_LOGIN: undefined });
      const response = await handleDevLoginOtherMethod(pageRequest(), allow);
      expect(response.status).toBe(404);
      expect(response.headers.get("allow")).toBeNull();
    },
  );

  it("gate open => 405 naming the one method the route accepts", async () => {
    const response = await handleDevLoginOtherMethod(pageRequest(), "POST");
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("network-exposed => bare 404 for the other methods too", async () => {
    vi.mocked(devServerLoopbackOnly).mockResolvedValue(false);
    expect((await handleDevLoginOtherMethod(pageRequest(), "GET")).status).toBe(404);
  });
});
