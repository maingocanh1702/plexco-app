import {
  SessionCancelAuthorizationError,
  SessionCancelError,
  SessionCloseAuthorizationError,
  SessionCloseError,
  SessionCommandError,
  SessionPublishAuthorizationError,
  SessionPublishError,
  SessionUpdateAuthorizationError,
  SessionUpdateError,
  createSession,
  guestNoteTenantForPerson,
  tenantLocale,
  authorize,
  withTenant,
} from "@plexco/db";
import { readFileSync } from "node:fs";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWithLang, t } from "@plexco/core/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapSessionCommandError,
  handleSessionCommand,
  readExpectedVersion,
  resolveSessionCommandContext,
  shapeCreateFields,
  shapeSessionFields,
} from "./session-command-route";
import { csrfOk, currentSession, rateLimited } from "./session-cookies";
import { POST } from "../app/api/sessions/route";

// Keep the REAL error classes from @plexco/db: mapSessionCommandError dispatches on `instanceof`,
// so a hand-rolled stub class would make the mapping test pass while the production path fails.
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    createDb: vi.fn(() => ({ pool: {}, db: {} })),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _tenantId: string, fn: (tx: unknown) => unknown) =>
      fn({}),
    ),
    guestNoteTenantForPerson: vi.fn(),
    createSession: vi.fn(),
    tenantLocale: vi.fn(),
  };
});

vi.mock("./session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: {} })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const TENANT = "11111111-1111-4111-8111-111111111111";
const OTHER_TENANT = "22222222-2222-4222-8222-222222222222";
const LIMIT = { bucket: "session-test", limit: 10 };
const ALLOW_OWNER = { allowed: true, role: "owner" } as const;
const DENY = { allowed: false, reason: "not_a_member" } as const;

const liveSession = {
  sessionId: "sess-1",
  accountId: "acc-1",
  personId: "person-1",
  csrfSecret: "secret",
  expiresAt: new Date(Date.now() + 3_600_000),
};

function req(body: unknown, tenant: string | null = TENANT, raw?: string): Request {
  const url =
    tenant === null
      ? "https://plexco.app/api/sessions"
      : `https://plexco.app/api/sessions?tenant=${tenant}`;
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: raw ?? JSON.stringify(body),
  });
}

const envelope = async (response: Response) =>
  (await response.json()) as {
    data: unknown;
    // `message` belongs here: two tests read it. Its absence was a real TS2339 twice that the
    // repo's canonical typecheck CANNOT see — apps/web/tsconfig.json includes only
    // ["next-env.d.ts", "app", ".next/types/**/*.ts"], so lib/*.test.ts is compiled by nothing.
    // codex round-01 [P3].
    error: { code: string; statusCode: number; message: string } | null;
  };

beforeEach(() => {
  // vitest does not clear mock call history between tests by default, and the ordering cases
  // below assert authorize was NEVER called — without this they read leftover calls.
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue(liveSession);
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue(ALLOW_OWNER);
  vi.mocked(guestNoteTenantForPerson).mockResolvedValue(null);
  vi.mocked(tenantLocale).mockResolvedValue(null); // default: unresolvable tenant falls back to vi
});

describe("resolveSessionCommandContext — entry gate", () => {
  it("rejects an anonymous caller with 401 AUTH_REQUIRED", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    expect(result).toBeInstanceOf(Response);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "AUTH_REQUIRED", statusCode: 401 });
  });

  it("rejects a missing/incorrect CSRF token with 403 CSRF_INVALID", async () => {
    vi.mocked(csrfOk).mockReturnValue(false);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "CSRF_INVALID", statusCode: 403 });
  });

  it("rejects a missing tenant parameter with 400", async () => {
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }, null), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
  });

  it("rejects a non-UUID tenant parameter without querying membership", async () => {
    const result = await resolveSessionCommandContext(
      req({ commandId: "c1" }, "not-a-uuid"),
      LIMIT,
    );
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    expect(authorize).not.toHaveBeenCalled();
  });

  it("throttles a pre-authorization caller on an ACTOR bucket, before any membership read", async () => {
    vi.mocked(rateLimited).mockResolvedValue(true);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "RATE_LIMITED", statusCode: 429 });
    expect(rateLimited).toHaveBeenCalledWith("session-actor:acc-1", 60, 60);
    expect(authorize).not.toHaveBeenCalled();
  });

  it("does NOT spend the tenant bucket until membership is proven (no cross-tenant DoS)", async () => {
    // codex round-01 [P1]: the per-tenant counter is shared, so if a stranger could spend it they
    // could drive a victim tenant's real admins into 429s and tell a live tenant from 429-vs-403.
    vi.mocked(authorize).mockResolvedValue(DENY);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    const buckets = vi.mocked(rateLimited).mock.calls.map(([bucket]) => bucket);
    expect(buckets).toContain("session-actor:acc-1");
    expect(buckets).not.toContain(`session-test:${TENANT}`);
  });

  it("spends the per-tenant bucket only AFTER authorization (spec §3 scopes these per tenant)", async () => {
    await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    expect(rateLimited).toHaveBeenCalledWith(`session-test:${TENANT}`, 10, 60);
    const buckets = vi.mocked(rateLimited).mock.calls.map(([bucket]) => bucket);
    expect(buckets.indexOf("session-actor:acc-1")).toBeLessThan(
      buckets.indexOf(`session-test:${TENANT}`),
    );
  });

  it("returns 429 when the authorized caller exceeds the tenant limit", async () => {
    vi.mocked(rateLimited).mockImplementation(async (bucket: string) =>
      bucket.startsWith("session-test:"),
    );
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "RATE_LIMITED", statusCode: 429 });
  });

  it("REGRESSION: an English tenant's TENANT-bucket 429 is answered in English, not Vietnamese", async () => {
    // Code review round 1 on v1, finding 2. The per-tenant limiter fires AFTER membership and role
    // are proven, so the tenant is known and DD-118 makes language resolvable — but v1 resolved
    // locale ten lines further down, so this rejection came back Vietnamese to an English tenant.
    //
    // The ACTOR-bucket 429 above deliberately stays Vietnamese: it fires before any tenant is
    // known, which is DD-118's ratified boundary. This test pins the difference between the two,
    // so a future reordering cannot quietly collapse them.
    vi.mocked(tenantLocale).mockResolvedValue("en");
    vi.mocked(rateLimited).mockImplementation(async (bucket: string) =>
      bucket.startsWith("session-test:"),
    );
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "RATE_LIMITED", statusCode: 429 });
    expect(error?.message).toBe("Too many requests — wait.");
  });

  it("PINS THE PRE-TENANT BOUNDARY: all FIVE sites answer in Vietnamese and NONE reads the locale", async () => {
    // Round-1 finding 3. The source comment enumerating this boundary has been wrong twice —
    // v1 omitted the per-tenant 429, its fix omitted INVALID_BODY — and both times the comment
    // claimed completeness. Prose cannot fail; this can. Each case drives the real resolver with
    // an ENGLISH tenant, so a leak would show up as an English string.
    const cases: Array<[string, () => void, string]> = [
      ["AUTH_REQUIRED", () => vi.mocked(currentSession).mockResolvedValue(null), "Chưa đăng nhập."],
      ["CSRF_INVALID", () => vi.mocked(csrfOk).mockReturnValue(false), "Yêu cầu không hợp lệ."],
      [
        "FORBIDDEN",
        () => vi.mocked(authorize).mockResolvedValue(DENY),
        "Bạn không có quyền với CLB này.",
      ],
      [
        "RATE_LIMITED (actor bucket)",
        () =>
          vi
            .mocked(rateLimited)
            .mockImplementation(async (bucket: string) => bucket.startsWith("session-actor:")),
        "Quá nhiều yêu cầu — đợi.",
      ],
    ];
    for (const [label, arrange, expected] of cases) {
      vi.clearAllMocks();
      vi.mocked(currentSession).mockResolvedValue(liveSession);
      vi.mocked(csrfOk).mockReturnValue(true);
      vi.mocked(rateLimited).mockResolvedValue(false);
      vi.mocked(authorize).mockResolvedValue(ALLOW_OWNER);
      vi.mocked(tenantLocale).mockResolvedValue("en");
      arrange();
      const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
      const { error } = await envelope(result as Response);
      expect(error?.message, label).toBe(expected);
      // The boundary is not only "answers in Vietnamese" but "has not read the tenant yet".
      expect(tenantLocale, label).not.toHaveBeenCalled();
    }

    // The fifth site: a missing/invalid ?tenant= never reaches membership resolution at all.
    vi.clearAllMocks();
    vi.mocked(currentSession).mockResolvedValue(liveSession);
    vi.mocked(csrfOk).mockReturnValue(true);
    vi.mocked(tenantLocale).mockResolvedValue("en");
    const bad = await resolveSessionCommandContext(
      new Request("http://localhost/api/sessions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: "c1" }),
      }),
      LIMIT,
    );
    const { error } = await envelope(bad as Response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    expect(error?.message).toBe("Thiếu hoặc sai mã CLB.");
    expect(tenantLocale).not.toHaveBeenCalled();
  });

  it("the ACTOR-bucket 429 stays Vietnamese even for an English tenant — the boundary DD-118 ratified", async () => {
    // Paired with the test above on purpose. Asserting only the English case would let a fix that
    // localises EVERYTHING pass, erasing the pre-tenant boundary instead of honouring it.
    vi.mocked(tenantLocale).mockResolvedValue("en");
    vi.mocked(rateLimited).mockImplementation(async (bucket: string) =>
      bucket.startsWith("session-actor:"),
    );
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "RATE_LIMITED", statusCode: 429 });
    expect(error?.message).toBe("Quá nhiều yêu cầu — đợi.");
  });
});

describe("explicit guest-note context", () => {
  const sessionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const options = { guestNoteSessionId: sessionId };

  it("proves the path association after actor quota and admin lookup, before locale and target quota", async () => {
    const order: string[] = [];
    vi.mocked(rateLimited).mockImplementation(async (bucket) => {
      order.push(bucket.startsWith("session-actor:") ? "actor" : "target");
      return false;
    });
    vi.mocked(authorize).mockImplementation(async () => {
      order.push("admin");
      return DENY;
    });
    vi.mocked(guestNoteTenantForPerson).mockImplementation(async () => {
      order.push("proof");
      return TENANT;
    });
    vi.mocked(tenantLocale).mockImplementation(async () => {
      order.push("locale");
      return "en";
    });
    const response = await handleSessionCommand(
      req({ commandId: "same key ", guestNoteSessionId: "forged" }, TENANT.toUpperCase()),
      LIMIT,
      async (context) => {
        order.push("handler");
        expect(context).toMatchObject({ tenantId: TENANT, commandId: "same key ", lang: "en" });
        return new Response(t("vi", "en"));
      },
      options,
    );
    expect(await response.text()).toBe("en");
    expect(order).toEqual(["actor", "admin", "proof", "locale", "target", "handler"]);
    expect(guestNoteTenantForPerson).toHaveBeenCalledWith(
      {},
      liveSession.personId,
      TENANT,
      sessionId,
    );
  });

  it.each(["owner", "admin", "co_admin"])(
    "keeps %s on the existing admin path even if guest proof would fail",
    async (role) => {
      vi.mocked(authorize).mockResolvedValue({ allowed: true, role: role as "owner" });
      vi.mocked(guestNoteTenantForPerson).mockRejectedValue(new Error("must not run"));
      const result = await resolveSessionCommandContext(req({ commandId: "c" }), LIMIT, {
        guestNoteSessionId: "bad-id",
      });
      expect(result).toMatchObject({ tenantId: TENANT });
      expect(guestNoteTenantForPerson).not.toHaveBeenCalled();
    },
  );

  it("never infers guest mode from a body, URL or bucket", async () => {
    vi.mocked(authorize).mockResolvedValue(DENY);
    vi.mocked(guestNoteTenantForPerson).mockResolvedValue(TENANT);
    const request = new Request(
      `https://plexco.app/api/sessions/${sessionId}/guest-notes?tenant=${TENANT}`,
      req({ commandId: "c", guestNoteSessionId: sessionId }),
    );
    const result = await resolveSessionCommandContext(request, {
      bucket: "session-guest-note-create",
      limit: 10,
    });
    expect((result as Response).status).toBe(403);
    expect(guestNoteTenantForPerson).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
  });

  it.each(["auth", "csrf", "tenant", "actor"] as const)(
    "refuses %s before either tenant resolver in guest mode",
    async (kind) => {
      if (kind === "auth") vi.mocked(currentSession).mockResolvedValue(null);
      if (kind === "csrf") vi.mocked(csrfOk).mockReturnValue(false);
      if (kind === "actor") vi.mocked(rateLimited).mockResolvedValue(true);
      const request = req({ commandId: "c" }, kind === "tenant" ? "invalid" : TENANT);
      const result = await resolveSessionCommandContext(request, LIMIT, options);
      expect((result as Response).status).toBe(
        { auth: 401, csrf: 403, tenant: 400, actor: 429 }[kind],
      );
      expect(authorize).not.toHaveBeenCalled();
      expect(guestNoteTenantForPerson).not.toHaveBeenCalled();
      expect(tenantLocale).not.toHaveBeenCalled();
      expect(request.bodyUsed).toBe(false);
    },
  );

  it("keeps absent association indistinguishable and does not consume target quota or body", async () => {
    vi.mocked(authorize).mockResolvedValue(DENY);
    vi.mocked(tenantLocale).mockResolvedValue("en");
    const request = req({ commandId: "c" });
    const result = await resolveSessionCommandContext(request, LIMIT, options);
    expect((await envelope(result as Response)).error).toMatchObject({
      code: "FORBIDDEN",
      message: "Bạn không có quyền với CLB này.",
    });
    expect(tenantLocale).not.toHaveBeenCalled();
    expect(rateLimited).toHaveBeenCalledTimes(1);
    expect(request.bodyUsed).toBe(false);
  });

  it.each(["database unavailable", "Invalid guest-note tenant context result"])(
    "propagates %s without entering tenant context",
    async (message) => {
      vi.mocked(authorize).mockResolvedValue(DENY);
      const failure = new Error(message);
      vi.mocked(guestNoteTenantForPerson).mockRejectedValue(failure);
      const request = req({ commandId: "c" });
      await expect(resolveSessionCommandContext(request, LIMIT, options)).rejects.toBe(failure);
      expect(tenantLocale).not.toHaveBeenCalled();
      expect(rateLimited).toHaveBeenCalledTimes(1);
      expect(request.bodyUsed).toBe(false);
    },
  );

  it.each(["quota", "json", "commandId"] as const)(
    "uses tenant language for %s failure after proof",
    async (kind) => {
      vi.mocked(authorize).mockResolvedValue(DENY);
      vi.mocked(guestNoteTenantForPerson).mockResolvedValue(TENANT);
      vi.mocked(tenantLocale).mockResolvedValue("en");
      vi.mocked(rateLimited).mockImplementation(
        async (bucket) => kind === "quota" && !bucket.startsWith("session-actor:"),
      );
      const result = await resolveSessionCommandContext(
        req({}, TENANT, kind === "json" ? "{" : undefined),
        LIMIT,
        options,
      );
      expect((await envelope(result as Response)).error?.message).toBe(
        {
          quota: "Too many requests — wait.",
          json: "Invalid payload.",
          commandId: "Missing commandId.",
        }[kind],
      );
    },
  );
});

describe("resolveSessionCommandContext — body size ceiling", () => {
  // codex round-02/2 [P2]: the request-COUNT limiter does not bound request SIZE, and Next.js App
  // Router route handlers have no built-in body limit.
  it("rejects an oversized body declared by Content-Length WITHOUT reading the stream", async () => {
    // codex round-04/1 [P3]: the earlier version of this test never set the header — Node does not
    // infer it for a string body, so content-length was null and this silently duplicated the
    // streaming case below. The header is now set explicitly, AND the body is a stream whose
    // reader records whether it was ever pulled, which is what "before parsing" actually claims.
    let pulled = false;
    const stream = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled = true;
          controller.enqueue(new TextEncoder().encode("x"));
          controller.close();
        },
      },
      // highWaterMark 0 is what makes `pulled` mean anything: with the DEFAULT strategy the stream
      // pre-fills its buffer, so `pull` fires on construction and the flag is true no matter what
      // the code under test does. Measured while writing this test.
      { highWaterMark: 0 },
    );
    const request = new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-csrf-token": "secret",
        "content-length": String(70 * 1024),
      },
      body: stream,
      // @ts-expect-error undici requires duplex for a stream body; not in the DOM lib types
      duplex: "half",
    });
    expect(request.headers.get("content-length")).toBe(String(70 * 1024));

    const response = (await resolveSessionCommandContext(request, LIMIT)) as Response;
    expect(response.status).toBe(413);
    const { error } = await envelope(response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 413 });
    expect(pulled).toBe(false); // rejected on the declared length alone
  });

  it("rejects an oversized CHUNKED body, where Content-Length is absent", async () => {
    // The declared-length check cannot catch this one; only the running total can.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const chunk = new TextEncoder().encode("y".repeat(8 * 1024));
        for (let i = 0; i < 12; i += 1) controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body: stream,
      // @ts-expect-error undici requires duplex for a stream body; not in the DOM lib types
      duplex: "half",
    });
    expect(request.headers.get("content-length")).toBeNull();
    const response = (await resolveSessionCommandContext(request, LIMIT)) as Response;
    expect(response.status).toBe(413);
  });

  // codex round-03/1 [P1]. A non-fatal decoder maps every invalid byte to U+FFFD, so raw 0x80 and
  // 0x81 both become the SAME commandId and collapse onto one processed_commands row — the second
  // caller would replay the first caller's session. Sent as raw bytes, because the defect lives
  // below the string layer and a JS string literal cannot express it.
  function rawByteRequest(commandIdByte: number): Request {
    const head = new TextEncoder().encode('{"commandId":"cmd');
    const tail = new TextEncoder().encode('"}');
    const body = new Uint8Array([...head, commandIdByte, ...tail]);
    return new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body,
    });
  }

  it.each([[0x80], [0x81], [0xfe], [0xc3]])(
    "rejects a body whose raw byte 0x%s is not valid UTF-8, instead of substituting U+FFFD",
    async (byte) => {
      const response = (await resolveSessionCommandContext(
        rawByteRequest(byte),
        LIMIT,
      )) as Response;
      expect(response.status).toBe(400);
      const { error } = await envelope(response);
      expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    },
  );

  it("two DIFFERENT invalid bytes would otherwise produce the SAME commandId", () => {
    // Demonstrates the collision the fatal decoder prevents — the reason the guard exists.
    const lenient = new TextDecoder();
    expect(lenient.decode(new Uint8Array([0x80]))).toBe(lenient.decode(new Uint8Array([0x81])));
  });

  it("still accepts a VALID multi-byte UTF-8 commandId (the rule targets malformed, not non-ASCII)", async () => {
    const body = new TextEncoder().encode(JSON.stringify({ commandId: "cmd-Đà-Nẵng-✓" }));
    const request = new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body,
    });
    const result = await resolveSessionCommandContext(request, LIMIT);
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({ commandId: "cmd-Đà-Nẵng-✓" });
  });

  it("accepts a normal body well under the ceiling", async () => {
    const result = await resolveSessionCommandContext(
      req({ commandId: "c1", area: "Quan 7" }),
      LIMIT,
    );
    expect(result).not.toBeInstanceOf(Response);
  });
});

describe("resolveSessionCommandContext — actor authorization (DD-56 authorize)", () => {
  it("allows an owner", async () => {
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({ tenantId: TENANT, commandId: "c1" });
  });

  it.each(["admin", "co_admin"] as const)(
    "allows %s (default preset holds session.manage)",
    async (role) => {
      vi.mocked(authorize).mockResolvedValue({ allowed: true, role });
      const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
      expect(result).not.toBeInstanceOf(Response);
    },
  );

  it("asks authorize() for exactly session.manage, for the canonical tenant and the session's person, inside withTenant", async () => {
    await resolveSessionCommandContext(req({ commandId: "c1" }, TENANT.toUpperCase()), LIMIT);
    expect(withTenant).toHaveBeenCalledWith(expect.anything(), TENANT, expect.any(Function));
    expect(authorize).toHaveBeenCalledWith(expect.anything(), {
      tenantId: TENANT,
      action: "session.manage",
      actorPersonId: liveSession.personId,
    });
  });

  it.each(["unknown_action", "tenant_context", "not_a_member", "not_permitted", "grant_required"])(
    "DENIES with 403 FORBIDDEN on authorize reason %s",
    async (reason) => {
      vi.mocked(authorize).mockResolvedValue({ allowed: false, reason });
      const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
      const { error } = await envelope(result as Response);
      expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      expect(error?.message).not.toContain(reason);
    },
  );

  it("an authorize() infrastructure failure propagates (5xx), never allow and never a fake 403", async () => {
    vi.mocked(authorize).mockRejectedValue(new Error("connection reset"));
    await expect(resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT)).rejects.toThrow(
      /connection reset/,
    );
    const buckets = vi.mocked(rateLimited).mock.calls.map(([bucket]) => bucket);
    expect(buckets).not.toContain(`session-test:${TENANT}`);
  });

  it("accepts an UPPERCASE tenant UUID and canonicalizes it (round-02 [P2])", async () => {
    const result = await resolveSessionCommandContext(
      req({ commandId: "c1" }, TENANT.toUpperCase()),
      LIMIT,
    );
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({ tenantId: TENANT });
  });

  it("buckets the rate limit on the canonical (lowercase) tenant id, not the raw casing", async () => {
    await resolveSessionCommandContext(req({ commandId: "c1" }, TENANT.toUpperCase()), LIMIT);
    expect(rateLimited).toHaveBeenCalledWith(`session-test:${TENANT}`, 10, 60);
  });

  it("TENANT ISOLATION: the decision is requested for the ROUTED tenant, so a foreign-tenant admin is denied by authorize", async () => {
    vi.mocked(authorize).mockImplementation(async (_tx, params) =>
      params.tenantId === OTHER_TENANT ? ALLOW_OWNER : DENY,
    );
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }, TENANT), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("returns the SAME 403 body for every denial reason (no tenant-existence oracle)", async () => {
    vi.mocked(authorize).mockResolvedValue(DENY);
    const nonMember = await envelope(
      (await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT)) as Response,
    );
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "not_permitted" });
    const noCapability = await envelope(
      (await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT)) as Response,
    );
    expect(nonMember.error).toEqual(noCapability.error);
  });

  it("no source file keeps a role list or tenantsForPerson in the session command gate", () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(path.join(here, "session-command-route.ts"), "utf8");
    expect(source).not.toMatch(/ALLOWED_ROLES|tenantsForPerson/);
  });
});

describe("resolveSessionCommandContext — body", () => {
  it("rejects malformed JSON with 400", async () => {
    const result = await resolveSessionCommandContext(req(null, TENANT, "{not json"), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
  });

  it("rejects a JSON array body with 400", async () => {
    const result = await resolveSessionCommandContext(req([1, 2, 3]), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
  });

  it.each([[undefined], [""], ["   "], [42], [null]])(
    "rejects a missing/invalid commandId (%p)",
    async (commandId) => {
      const result = await resolveSessionCommandContext(req({ commandId }), LIMIT);
      const { error } = await envelope(result as Response);
      expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    },
  );

  it("passes commandId through verbatim (the family dedups on it — DD-117 D5)", async () => {
    const result = await resolveSessionCommandContext(req({ commandId: "cmd_abc-123" }), LIMIT);
    expect(result).toMatchObject({ commandId: "cmd_abc-123" });
  });

  // codex round-02 [P1]: a type/length check alone lets through two byte sequences that break the
  // idempotency ledger. Built with fromCharCode rather than escapes so no tooling can rewrite the
  // intent into a literal control character.
  it("rejects a commandId containing NUL (PostgreSQL cannot store it in text — would be a 500)", async () => {
    const withNul = `cmd${String.fromCharCode(0)}1`;
    const result = await resolveSessionCommandContext(req({ commandId: withNul }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
  });

  it.each([
    ["lone high surrogate", String.fromCharCode(0xd800)],
    ["lone low surrogate", String.fromCharCode(0xdc00)],
    ["high surrogate followed by an ordinary char", `${String.fromCharCode(0xd83d)}x`],
  ])(
    "rejects an ill-formed commandId (%s) that would collapse onto one ledger key",
    async (_l, bad) => {
      const result = await resolveSessionCommandContext(req({ commandId: `cmd${bad}` }), LIMIT);
      const { error } = await envelope(result as Response);
      expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    },
  );

  it("DISTINCT ill-formed keys would otherwise encode identically — the reason this fails closed", () => {
    const a = Buffer.from(`cmd${String.fromCharCode(0xd800)}`, "utf8").toString("hex");
    const b = Buffer.from(`cmd${String.fromCharCode(0xdc00)}`, "utf8").toString("hex");
    expect(a).toBe(b); // two different client keys, one PostgreSQL row
  });

  it("accepts a well-formed astral commandId (a real surrogate PAIR is fine)", async () => {
    const pair = String.fromCharCode(0xd83d, 0xde00); // one emoji, correctly paired
    const result = await resolveSessionCommandContext(req({ commandId: `cmd${pair}` }), LIMIT);
    expect(result).not.toBeInstanceOf(Response);
  });
});

/**
 * CRITERION 1 — the failing test, written BEFORE any production line changes.
 *
 * Drives the REAL request path: the create route handler, whose command rejects with a domain
 * error, against a tenant whose locale is "en". Deliberately does NOT wrap anything in
 * runWithLang — establishing that context is production's job, and wrapping it here would test
 * the harness rather than the app. The sibling test further down DOES wrap, which is why it
 * passes today and this one does not: it proves the mapper honours a context, not that a context
 * exists.
 */
describe("CRITERION 1 — language reaches a real request (expected RED before the fix)", () => {
  it("a tenant with locale 'en' gets an English error message", async () => {
    vi.mocked(authorize).mockResolvedValue(ALLOW_OWNER);
    vi.mocked(tenantLocale).mockResolvedValue("en");
    vi.mocked(createSession).mockRejectedValue(
      new SessionPublishError("SESSION_NOT_FOUND", "internal"),
    );

    const request = new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body: JSON.stringify({
        commandId: "cmd_i18n",
        sportId: "55555555-5555-4555-8555-555555555555",
        startsAt: "2026-09-01T10:00:00.000Z",
        endsAt: "2026-09-01T12:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
      }),
    });

    const response = await POST(request);
    const { error } = await envelope(response);
    expect(error?.message).toBe("Session not found.");
  });
});

describe("CRITERION 3 — Vietnamese stays the default on every unresolved path", () => {
  async function errorMessageFor(locale: string | null): Promise<string> {
    vi.mocked(authorize).mockResolvedValue(ALLOW_OWNER);
    vi.mocked(tenantLocale).mockResolvedValue(locale);
    vi.mocked(createSession).mockRejectedValue(
      new SessionPublishError("SESSION_NOT_FOUND", "internal"),
    );
    const request = new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-csrf-token": "secret" },
      body: JSON.stringify({
        commandId: "cmd_default",
        sportId: "55555555-5555-4555-8555-555555555555",
        startsAt: "2026-09-01T10:00:00.000Z",
        endsAt: "2026-09-01T12:00:00.000Z",
        timezone: "Asia/Ho_Chi_Minh",
      }),
    });
    const { error } = await envelope(await POST(request));
    return error!.message;
  }

  it("a tenant whose locale is 'vi' gets Vietnamese", async () => {
    expect(await errorMessageFor("vi")).toBe("Không tìm thấy kèo.");
  });

  it("an UNRESOLVABLE tenant gets Vietnamese (tenantLocale returned null)", async () => {
    // DD-118: unresolvable tenant falls back to vi. tenantLocale never throws, so this is the
    // shape a dead connection or an RLS-invisible row produces.
    expect(await errorMessageFor(null)).toBe("Không tìm thấy kèo.");
  });

  it("an UNRECOGNISED locale gets Vietnamese (column value outside the two-value set)", async () => {
    // The column is notNull default 'vi', but notNull is not "one of two values" — parseLang is
    // what makes that true, and DD-118 pins the fallback.
    expect(await errorMessageFor("de")).toBe("Không tìm thấy kèo.");
  });
});

/**
 * CRITERION 3 (structure) — assert the PROPERTY, not the symptom.
 *
 * The error-path test above passes today, and would keep passing if someone later moved the
 * try/catch out of the runWithLang callback... no: it would break, which is the point. But it
 * breaks for a reason a future reader has to reconstruct from a language mismatch. This asserts
 * the arrangement directly, so the failure names the cause.
 */
describe("CRITERION 3 (structure) — the try/catch lives INSIDE the runWithLang callback", () => {
  it("handleSessionCommand's TryStatement is a descendant of the runWithLang callback", () => {
    const file = fileURLToPath(new URL("./session-command-route.ts", import.meta.url));
    const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);

    let fn: ts.FunctionDeclaration | undefined;
    ts.forEachChild(src, (n) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "handleSessionCommand") fn = n;
    });
    expect(fn, "handleSessionCommand must exist").toBeDefined();

    // Find the runWithLang(...) call and the arrow function passed to it.
    let callback: ts.Node | undefined;
    const findCall = (n: ts.Node): void => {
      if (
        ts.isCallExpression(n) &&
        ts.isIdentifier(n.expression) &&
        n.expression.text === "runWithLang"
      ) {
        callback = n.arguments.find((a) => ts.isArrowFunction(a) || ts.isFunctionExpression(a));
      }
      ts.forEachChild(n, findCall);
    };
    findCall(fn!);
    expect(callback, "runWithLang must be called with a callback").toBeDefined();

    // Every try/catch in the function must sit inside that callback.
    const tries: ts.Node[] = [];
    const findTries = (n: ts.Node): void => {
      if (ts.isTryStatement(n)) tries.push(n);
      ts.forEachChild(n, findTries);
    };
    findTries(fn!);
    expect(tries.length, "handleSessionCommand must own a try/catch").toBeGreaterThan(0);

    for (const t of tries) {
      expect(
        t.getStart() > callback!.getStart() && t.getEnd() < callback!.getEnd(),
        "a try/catch outside the runWithLang callback would run mapSessionCommandError with the language context already torn down",
      ).toBe(true);
    }
  });
});

// DD-131 OD-1: the players a close refusal names (ids + display names only).
const OWING = [
  { playerId: "4c3a2e9e-0000-4000-8000-000000000001", displayName: "Lan" },
  { playerId: "4c3a2e9e-0000-4000-8000-000000000002", displayName: null },
] as const;

/** Every typed domain error the mapper pins, with its wire code and status (one row per literal). */
const MAPPED_CASES: ReadonlyArray<readonly [Error, string, number]> = [
  [new SessionCommandError("INVALID_TIME_RANGE", "internal"), "INVALID_TIME_RANGE", 400],
  [new SessionCommandError("SPORT_INACTIVE", "internal"), "SPORT_INACTIVE", 400],
  [new SessionCommandError("COMMAND_ID_CONFLICT", "internal"), "COMMAND_ID_CONFLICT", 409],
  [new SessionPublishError("SESSION_NOT_FOUND", "internal"), "SESSION_NOT_FOUND", 404],
  [new SessionPublishError("SESSION_NOT_OPEN", "internal"), "SESSION_NOT_OPEN", 409],
  [new SessionPublishError("STALE_VERSION", "internal"), "STALE_VERSION", 409],
  [
    new SessionPublishError("MISSING_DISCOVERY_FIELDS", "internal"),
    "MISSING_DISCOVERY_FIELDS",
    400,
  ],
  [new SessionUpdateError("CAPACITY_BELOW_ROSTER", "internal"), "CAPACITY_BELOW_ROSTER", 409],
  [new SessionUpdateError("CAPACITY_BELOW_OCCUPANCY", "internal"), "CAPACITY_BELOW_OCCUPANCY", 409],
  [
    new SessionUpdateError("PRICE_CHANGE_REQUIRES_POLICY", "internal"),
    "PRICE_CHANGE_REQUIRES_POLICY",
    400,
  ],
  [new SessionCloseError("SESSION_NOT_FOUND", "internal"), "SESSION_NOT_FOUND", 404],
  [new SessionCloseError("SESSION_NOT_OPEN", "internal"), "SESSION_NOT_OPEN", 409],
  [new SessionCloseError("STALE_VERSION", "internal"), "STALE_VERSION", 409],
  [new SessionCloseError("COMMAND_ID_CONFLICT", "internal"), "COMMAND_ID_CONFLICT", 409],
  [
    new SessionCloseError("CLOSE_BLOCKED_OPEN_DEBT", "internal", OWING),
    "CLOSE_BLOCKED_OPEN_DEBT",
    409,
  ],
  [new SessionCancelError("SESSION_NOT_FOUND", "internal"), "SESSION_NOT_FOUND", 404],
  [new SessionCancelError("SESSION_NOT_OPEN", "internal"), "SESSION_NOT_OPEN", 409],
  [new SessionCancelError("STALE_VERSION", "internal"), "STALE_VERSION", 409],
  [new SessionCancelError("COMMAND_ID_CONFLICT", "internal"), "COMMAND_ID_CONFLICT", 409],
  [new SessionCancelError("CANCEL_REQUIRES_REVIEW", "internal"), "CANCEL_REQUIRES_REVIEW", 400],
  [new SessionPublishAuthorizationError(), "TENANT_SUSPENDED", 403],
  [new SessionUpdateAuthorizationError(), "TENANT_SUSPENDED", 403],
  [new SessionCloseAuthorizationError(), "TENANT_SUSPENDED", 403],
  [new SessionCancelAuthorizationError(), "TENANT_SUSPENDED", 403],
];

describe("mapSessionCommandError", () => {
  it.each(MAPPED_CASES)("maps %s onto the pinned code+status", async (error, code, statusCode) => {
    const response = mapSessionCommandError(error);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(statusCode);
    const { error: mapped } = await envelope(response!);
    expect(mapped).toMatchObject({ code, statusCode });
  });

  it.each([
    "INVALID_INPUT",
    "INVALID_PRICE",
    "INVALID_SLOTS",
    "INVALID_TIMEZONE",
    "INVALID_VISIBILITY",
    "INVALID_JOIN_POLICY",
    "INVALID_TEXT_FIELD",
  ] as const)(
    "collapses the unpinned validation variant %s onto INVALID_BODY 400",
    async (code) => {
      const response = mapSessionCommandError(new SessionCommandError(code, "internal"));
      const { error } = await envelope(response!);
      expect(error).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    },
  );

  it("collapses EVERY unpinned validation variant, so none needs a registry entry", async () => {
    // codex round-04/1 [P3]: this constraint used to live in packages/core/src/api-contract.test.ts
    // as a permanent ban on seven literals in the SHARED registry. That was the wrong boundary — a
    // future unrelated API may legitimately register one of these, and registering it would not
    // make a session route emit it, because this mapper collapses them explicitly. The property
    // that actually matters is asserted here, where it is true by construction.
    for (const code of [
      "INVALID_INPUT",
      "INVALID_PRICE",
      "INVALID_SLOTS",
      "INVALID_TIMEZONE",
      "INVALID_VISIBILITY",
      "INVALID_JOIN_POLICY",
      "INVALID_TEXT_FIELD",
    ] as const) {
      const response = mapSessionCommandError(new SessionCommandError(code, "internal"));
      const { error } = await envelope(response!);
      expect(error, code).toMatchObject({ code: "INVALID_BODY", statusCode: 400 });
    }
  });

  it("NEVER echoes the domain error's internal message", async () => {
    const response = mapSessionCommandError(
      new SessionUpdateError("STALE_VERSION", "row 42 version 7 != expected 6"),
    );
    const raw = JSON.stringify(await envelope(response!));
    expect(raw).not.toContain("row 42");
    expect(raw).not.toContain("version 7");
  });

  it("returns null for a non-domain error so the caller rethrows (no 4xx for an internal fault)", () => {
    expect(mapSessionCommandError(new Error("connection reset"))).toBeNull();
    expect(mapSessionCommandError(undefined)).toBeNull();
  });

  // The mapper fails closed at TWO distinct points, and which one catches a given code depends on
  // the order they run in. Both are covered below, with the code chosen to reach exactly one:
  //
  //   1. registry miss  — isApiErrorCode rejects it        (runs FIRST)
  //   2. table miss     — STATUS/MESSAGE_BY_CODE lack it   (runs SECOND, registered codes only)
  //
  // An earlier revision of this suite had one test claiming to cover (2) while using an
  // unregistered code, so it actually exercised (1) and left (2) untested — codex round-01 [P2].
  // The forged value must therefore be picked against the order, not against intuition.
  //
  // Each case builds a REAL instance and mutates it, because the mapper dispatches on `instanceof`
  // and a hand-rolled stub would never reach either branch. The double assertion is required:
  // `code` is declared as a readonly union of the five legal literals.

  // Pins the OUTCOME, and deliberately claims no more than that. Measured by mutation: deleting the
  // isApiErrorCode guard leaves this test passing, because an unregistered code is necessarily
  // absent from both tables too and so fails closed at (2) instead — same null, one branch later.
  // The guard is therefore runtime-REDUNDANT; its real work is compile-time (see below). Keeping
  // the case is still worth it: "an unregistered code never reaches a client" is the property, and
  // it must hold no matter which check enforces it.
  it("fails closed on a domain code that is NOT in the shared registry", () => {
    const forged = new SessionCloseError("COMMAND_ID_CONFLICT", "internal");
    (forged as unknown as { code: string }).code = "TOTALLY_UNREGISTERED_CODE";
    expect(mapSessionCommandError(forged)).toBeNull();
  });

  // This one IS load-bearing, and only a registered code can make it so. Measured by mutation:
  // deleting the table-miss check fails this test (and only this test) — without it the mapper
  // reaches `message[0]` on an undefined lookup and throws a TypeError instead of failing closed.
  it("fails closed on a REGISTERED code that neither lookup table maps", () => {
    // AUTH_REQUIRED is in API_ERROR_CODES but is issued by the auth layer, never by a session
    // command, so it is absent from both tables — which is precisely what reaches branch (2).
    // A domain code in neither table is a contract gap, not a client error: null, so the caller
    // rethrows and it surfaces as a generic 500 rather than being dressed up with a guessed status.
    const forged = new SessionCancelError("COMMAND_ID_CONFLICT", "internal");
    (forged as unknown as { code: string }).code = "AUTH_REQUIRED";
    expect(mapSessionCommandError(forged)).toBeNull();
  });

  // Beyond these two runtime branches there is a COMPILE-TIME guarantee that no test here can
  // express: STATUS_BY_CODE and MESSAGE_BY_CODE are keyed on ApiErrorCode, so adding a row whose
  // code is not in API_ERROR_CODES fails `tsc`. Its check is `pnpm -r run typecheck`, verified by
  // mutation — an unregistered key produces TS2322 on the table's declaration. api-contract.test.ts
  // pins the same membership from the registry's side. Enumerating the table's keys here instead
  // would need either a new export or a hand-copied list, and a hand-maintained copy is wrong in
  // whichever version nobody remembered to edit.

  // codex round-02 [P2]: t() reads the request language from AsyncLocalStorage, so resolving the
  // message table at module load would freeze every message to the boot fallback and make
  // runWithLang silently ineffective for exactly these responses.
  it("resolves the message in the CALLER's language, not the language at module load", async () => {
    const read = async (lang: "vi" | "en") =>
      runWithLang(lang, async () => {
        const response = mapSessionCommandError(
          new SessionPublishError("SESSION_NOT_FOUND", "internal"),
        );
        return (await envelope(response!)).error!.message;
      });
    const vi = await read("vi");
    const en = await read("en");
    expect(vi).toBe("Không tìm thấy kèo.");
    expect(en).toBe("Session not found.");
    expect(vi).not.toBe(en);
  });

  it.each([
    ["vi", "Sức chứa nhỏ hơn số chỗ đang được sử dụng."],
    ["en", "Capacity is below the occupied slots."],
  ] as const)(
    "returns the occupied-slot refusal in %s without internal details",
    async (lang, message) => {
      await runWithLang(lang, async () => {
        const response = mapSessionCommandError(
          new SessionUpdateError("CAPACITY_BELOW_OCCUPANCY", "internal guest count: 2"),
        );
        expect(response!.status).toBe(409);
        expect((await envelope(response!)).error).toEqual({
          code: "CAPACITY_BELOW_OCCUPANCY",
          statusCode: 409,
          message,
        });
      });
    },
  );

  it("resolves the INVALID_BODY collapse message per request too", async () => {
    const en = await runWithLang("en", async () => {
      const response = mapSessionCommandError(new SessionCommandError("INVALID_PRICE", "internal"));
      return (await envelope(response!)).error!.message;
    });
    expect(en).toBe("Invalid payload.");
  });
});

// DD-131 OD-1 (pending in PR #51): close's open-debt refusal is the ONE error carrying a payload.
describe("mapSessionCommandError — CLOSE_BLOCKED_OPEN_DEBT details", () => {
  type Detailed = {
    error: {
      code: string;
      message: string;
      statusCode: number;
      details?: { openBalancePlayers: unknown[] };
    } | null;
  };
  const detailed = async (response: Response) => (await response.json()) as Detailed;

  it("answers 409 with the open-balance list: ids + display names, in the command's order", async () => {
    const response = mapSessionCommandError(
      new SessionCloseError("CLOSE_BLOCKED_OPEN_DEBT", "2 charges owe 240000", OWING),
    );
    expect(response!.status).toBe(409);
    const { error } = await detailed(response!);
    expect(error).toEqual({
      code: "CLOSE_BLOCKED_OPEN_DEBT",
      message: "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo.",
      statusCode: 409,
      details: { openBalancePlayers: [...OWING] },
    });
    // The domain message (with its amount) is never echoed.
    expect(JSON.stringify(error)).not.toMatch(/240000|charges owe/);
  });

  it("re-projects every entry: a key beyond playerId/displayName never reaches the wire", async () => {
    const leaky = [{ ...OWING[0], amountDue: 120000, membershipId: "m-1", phone: "0900" }];
    const response = mapSessionCommandError(
      new SessionCloseError("CLOSE_BLOCKED_OPEN_DEBT", "internal", leaky),
    );
    const { error } = await detailed(response!);
    expect(error?.details?.openBalancePlayers).toEqual([OWING[0]]);
    expect(JSON.stringify(error)).not.toMatch(/120000|amountDue|membershipId|0900/);
  });

  it.each([
    ["no list", undefined],
    ["an empty list", []],
  ] as const)("fails closed (null, so the route answers 500) on a refusal with %s", (_c, list) => {
    expect(
      mapSessionCommandError(new SessionCloseError("CLOSE_BLOCKED_OPEN_DEBT", "internal", list)),
    ).toBeNull();
  });

  it("no OTHER mapped error grows a details key: each keeps exactly code, message, statusCode", async () => {
    for (const [error, code] of MAPPED_CASES) {
      if (code === "CLOSE_BLOCKED_OPEN_DEBT") continue;
      const { error: mapped } = await detailed(mapSessionCommandError(error)!);
      expect(Object.keys(mapped!), code).toEqual(["code", "message", "statusCode"]);
    }
  });

  it("a close error of ANOTHER code never emits a list, even if one were attached", async () => {
    const { error } = await detailed(
      mapSessionCommandError(new SessionCloseError("STALE_VERSION", "internal", OWING))!,
    );
    expect(Object.keys(error!)).toEqual(["code", "message", "statusCode"]);
  });

  it.each([
    ["vi", "Còn người chơi chưa trả đủ tiền — thu đủ trước khi đóng kèo."],
    [
      "en",
      "Some players have not paid in full — collect their payments before closing the session.",
    ],
  ] as const)("resolves the refusal message in %s, per request", async (lang, message) => {
    await runWithLang(lang, async () => {
      const response = mapSessionCommandError(
        new SessionCloseError("CLOSE_BLOCKED_OPEN_DEBT", "internal", OWING),
      );
      expect((await detailed(response!)).error?.message).toBe(message);
    });
  });
});

describe("shapeSessionFields", () => {
  it("omits absent keys and preserves a provided null (clear vs leave-alone)", () => {
    const fields = shapeSessionFields({ area: null }) as Record<string, unknown>;
    expect(Object.hasOwn(fields, "area")).toBe(true);
    expect(fields.area).toBeNull();
    expect(Object.hasOwn(fields, "venueName")).toBe(false);
  });

  it("treats an explicit undefined as absent", () => {
    const fields = shapeSessionFields({ area: undefined }) as Record<string, unknown>;
    expect(Object.hasOwn(fields, "area")).toBe(false);
  });

  it("parses ISO timestamps into Date", () => {
    const fields = shapeSessionFields({ startsAt: "2026-09-01T10:00:00.000Z" });
    expect(fields.startsAt).toBeInstanceOf(Date);
    expect(fields.startsAt!.toISOString()).toBe("2026-09-01T10:00:00.000Z");
  });

  it.each([
    ["+07:00 offset", "2026-09-01T17:00:00+07:00", "2026-09-01T10:00:00.000Z"],
    ["-05:00 offset", "2026-09-01T05:00:00-05:00", "2026-09-01T10:00:00.000Z"],
    ["no fractional seconds", "2026-09-01T10:00:00Z", "2026-09-01T10:00:00.000Z"],
    ["minute precision", "2026-09-01T10:00Z", "2026-09-01T10:00:00.000Z"],
    ["leap day", "2028-02-29T10:00:00Z", "2028-02-29T10:00:00.000Z"],
  ])("converts an unambiguous instant (%s)", (_label, input, expected) => {
    const fields = shapeSessionFields({ startsAt: input });
    expect(fields.startsAt).toBeInstanceOf(Date);
    expect((fields.startsAt as Date).toISOString()).toBe(expected);
  });

  // codex round-03 [P2]. new Date() accepts all of these, and the command cannot catch them
  // because by then the Date is already "valid" — so they must never become a Date here.
  it.each([
    ["a date that does not exist", "2026-02-30T10:00:00Z"],
    ["Feb 29 in a non-leap year", "2026-02-29T10:00:00Z"],
    ["month 13", "2026-13-01T10:00:00Z"],
    ["day 00", "2026-09-00T10:00:00Z"],
    ["NO offset — resolves against the server's TZ", "2026-09-01T19:00:00"],
    ["date only, no time", "2026-09-01"],
    ["locale-dependent format", "09/01/2026"],
    ["an hour that does not exist", "2026-09-01T25:00:00Z"],
    ["sub-millisecond precision Date cannot hold", "2026-09-01T10:00:00.123999999Z"],
  ])("passes %s through UNCONVERTED for the command to reject", (_label, input) => {
    const fields = shapeSessionFields({ startsAt: input });
    expect(fields.startsAt).not.toBeInstanceOf(Date);
    expect(fields.startsAt).toBe(input);
  });

  it("is independent of the server timezone for an offset-bearing value", () => {
    // The whole point of requiring an offset: the instant cannot depend on where this runs.
    const iso = "2026-09-01T17:00:00+07:00";
    const original = process.env.TZ;
    try {
      process.env.TZ = "UTC";
      const utc = shapeSessionFields({ startsAt: iso }).startsAt as Date;
      process.env.TZ = "Asia/Ho_Chi_Minh";
      const saigon = shapeSessionFields({ startsAt: iso }).startsAt as Date;
      expect(utc.toISOString()).toBe(saigon.toISOString());
      expect(utc.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    } finally {
      // codex round-04/1 [P2]: assigning an absent original back stores the STRING "undefined",
      // which silently re-zones every later test in this file. Delete when it was absent.
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  it('restores TZ to its ORIGINAL state, not to the string "undefined"', () => {
    // Guards the restore itself, since a broken restore contaminates unrelated tests rather than
    // failing here — the kind of defect that surfaces as an unrelated flake much later.
    const before = process.env.TZ;
    expect(before === undefined || typeof before === "string").toBe(true);
    expect(before).not.toBe("undefined");
  });

  // codex round-01 [P1]: shaping must NEVER reject. Dedup on (tenant_id, command_id) precedes
  // patch validation inside every command (DD-117 D5 / DED2), so rejecting a mistyped value here
  // would 400 a retry of an operation that already committed. The value goes through untouched
  // and the command reports its own code.
  it.each([
    [{ startsAt: "nonsense" }, "startsAt"],
    [{ startsAt: 1234 }, "startsAt"],
    [{ priceAmount: "50000" }, "priceAmount"],
    [{ priceAmount: 1.5 }, "priceAmount"],
    [{ slotsMax: "8" }, "slotsMax"],
    [{ visibility: "secret" }, "visibility"],
    [{ joinPolicy: "whenever" }, "joinPolicy"],
    [{ timezone: 7 }, "timezone"],
    [{ area: 12 }, "area"],
  ])("passes a mistyped value %p through instead of rejecting it", (body, key) => {
    const fields = shapeSessionFields(body) as Record<string, unknown>;
    expect(fields).not.toBeInstanceOf(Response);
    expect(fields[key]).toEqual((body as Record<string, unknown>)[key]);
  });

  it("keeps null slotsMax (unlimited) and integer prices", () => {
    const fields = shapeSessionFields({ slotsMax: null, priceAmount: 0 }) as Record<
      string,
      unknown
    >;
    expect(fields.slotsMax).toBeNull();
    expect(fields.priceAmount).toBe(0);
  });

  it("update's vocabulary INCLUDES venueAddress", () => {
    const fields = shapeSessionFields({ venueAddress: "12 Nguyen Trai" }) as Record<
      string,
      unknown
    >;
    expect(fields.venueAddress).toBe("12 Nguyen Trai");
  });
});

describe("shapeCreateFields", () => {
  it("OMITS venueAddress — it is not part of createSession's vocabulary (round-02 [P1])", () => {
    const fields = shapeCreateFields({
      venueAddress: "12 Nguyen Trai",
      venueName: "San A",
    }) as Record<string, unknown>;
    expect(Object.hasOwn(fields, "venueAddress")).toBe(false);
    expect(fields.venueName).toBe("San A");
  });

  it("never rejects, so a retry carrying an unsupported field can still replay", () => {
    expect(shapeCreateFields({ venueAddress: "x", priceAmount: "bad" })).not.toBeInstanceOf(
      Response,
    );
  });

  it("shares the rest of the vocabulary with update (no drift between the two)", () => {
    const body = { timezone: "Asia/Bangkok", slotsMax: null, area: "Q7", joinPolicy: "approval" };
    expect(shapeCreateFields(body)).toEqual(shapeSessionFields(body));
  });
});

describe("readExpectedVersion", () => {
  it("returns undefined when absent", () => {
    expect(readExpectedVersion({})).toBeUndefined();
  });
  it("returns the integer when provided", () => {
    expect(readExpectedVersion({ expectedVersion: 3 })).toBe(3);
  });
  it.each([[{ expectedVersion: "3" }], [{ expectedVersion: 1.5 }], [{ expectedVersion: null }]])(
    "passes a mistyped expectedVersion %p through — DED2 replays with expectedVersion: null",
    (body) => {
      expect(readExpectedVersion(body)).toEqual(body.expectedVersion);
    },
  );
});

describe.each(["admin", "guest"])("extracted body reader for %s session commands", (actor) => {
  const options =
    actor === "guest" ? { guestNoteSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } : {};
  beforeEach(() => {
    if (actor === "guest") vi.mocked(authorize).mockResolvedValue(DENY);
    vi.mocked(guestNoteTenantForPerson).mockResolvedValue(TENANT);
    vi.mocked(tenantLocale).mockResolvedValue("en");
  });
  function streamRequest(source: UnderlyingDefaultSource<Uint8Array>) {
    return new Request(`https://plexco.app/api/sessions?tenant=${TENANT}`, {
      method: "POST",
      body: new ReadableStream(source, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit);
  }

  it("cancels cumulative overflow before EOF and waits for cancellation before its English 413", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: (event: string) => void;
    let release!: () => void;
    const boundary = new Promise<string>((resolve) => {
      signal = resolve;
    });
    const cancelled = new Promise<void>((resolve) => {
      release = resolve;
    });
    let pulls = 0;
    const cancel = vi.fn(() => {
      signal("cancel");
      return cancelled;
    });
    const request = streamRequest({
      start(value) {
        controller = value;
      },
      pull(value) {
        pulls += 1;
        if (pulls <= 3) value.enqueue(new Uint8Array(pulls === 3 ? 1 : 32768));
        else signal("read-after-limit");
      },
      cancel,
    });
    const handler = vi.fn(async () => new Response("should not run"));
    let settled = false;
    const pending = handleSessionCommand(request, LIMIT, handler, options).then((value) => {
      settled = true;
      return value;
    });
    try {
      expect(await Promise.race([boundary, pending.then(() => "response")])).toBe("cancel");
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      expect(pulls).toBe(3);
      expect(cancel).toHaveBeenCalledOnce();
    } finally {
      release();
      if (cancel.mock.calls.length === 0) controller.close();
      await pending;
    }
    expect((await pending).status).toBe(413);
    expect((await envelope(await pending)).error?.message).toBe("Payload too large.");
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["read", "cancel", "locked"])(
    "propagates %s faults without invoking the command",
    async (kind) => {
      const failure = new Error("source failed");
      const request = streamRequest({
        pull(controller) {
          if (kind === "read") throw failure;
          controller.enqueue(new Uint8Array(65537));
        },
        cancel() {
          throw failure;
        },
      });
      const lock = kind === "locked" ? request.body!.getReader() : undefined;
      const handler = vi.fn(async () => new Response());
      try {
        const assertion = expect(handleSessionCommand(request, LIMIT, handler, options)).rejects;
        if (kind === "locked") await assertion.toBeInstanceOf(TypeError);
        else await assertion.toBe(failure);
        expect(handler).not.toHaveBeenCalled();
      } finally {
        lock?.releaseLock();
      }
    },
  );

  it("keeps malformed UTF-8 distinct from a command key and returns tenant-language 400", async () => {
    const request = streamRequest({
      pull(controller) {
        controller.enqueue(Uint8Array.of(0x80));
        controller.close();
      },
    });
    const handler = vi.fn(async () => new Response());
    const response = await handleSessionCommand(request, LIMIT, handler, options);
    expect(response.status).toBe(400);
    expect((await envelope(response)).error?.message).toBe("Invalid payload.");
    expect(handler).not.toHaveBeenCalled();
  });

  it("retains the exact command key at 64 KiB and pulls only after proven tenant quota and locale", async () => {
    const body = { commandId: " key-Đ🏸 ", pad: "" };
    body.pad = "x".repeat(65536 - Buffer.byteLength(JSON.stringify(body)));
    const request = streamRequest({
      pull(controller) {
        expect(rateLimited).toHaveBeenNthCalledWith(2, `session-test:${TENANT}`, 10, 60);
        expect(tenantLocale).toHaveBeenCalled();
        expect(guestNoteTenantForPerson).toHaveBeenCalledTimes(actor === "guest" ? 1 : 0);
        controller.enqueue(new TextEncoder().encode(JSON.stringify(body)));
        controller.close();
      },
    });
    const response = await handleSessionCommand(
      request,
      LIMIT,
      async (context) => {
        expect(context).toMatchObject({
          commandId: body.commandId,
          tenantId: TENANT,
          lang: "en",
          body,
        });
        return new Response(t("vi", "en"));
      },
      options,
    );
    expect(await response.text()).toBe("en");
  });
});

it.each(["auth", "csrf", "tenant", "actor", "association", "quota"] as const)(
  "guest body stays untouched after %s refusal",
  async (gate) => {
    vi.mocked(authorize).mockResolvedValue(DENY);
    vi.mocked(guestNoteTenantForPerson).mockResolvedValue(gate === "association" ? null : TENANT);
    if (gate === "auth") vi.mocked(currentSession).mockResolvedValue(null);
    if (gate === "csrf") vi.mocked(csrfOk).mockReturnValue(false);
    vi.mocked(rateLimited).mockImplementation(
      async (bucket) =>
        gate === "actor" || (gate === "quota" && bucket.startsWith("session-test:")),
    );
    const pull = vi.fn();
    const request = new Request(
      `https://plexco.app/api/sessions?tenant=${gate === "tenant" ? "bad" : TENANT}`,
      {
        method: "POST",
        duplex: "half",
        body: new ReadableStream({ pull }, { highWaterMark: 0 }),
      } as RequestInit,
    );
    const handler = vi.fn(async () => new Response());
    const response = await handleSessionCommand(request, LIMIT, handler, {
      guestNoteSessionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(response.status).toBe(
      { auth: 401, csrf: 403, tenant: 400, actor: 429, association: 403, quota: 429 }[gate],
    );
    expect(pull).not.toHaveBeenCalled();
    expect(request.bodyUsed).toBe(false);
    expect(handler).not.toHaveBeenCalled();
  },
);
