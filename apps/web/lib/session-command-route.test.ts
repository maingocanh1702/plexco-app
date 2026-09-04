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
  tenantLocale,
  tenantsForPerson,
} from "@plexco/db";
import { readdirSync, readFileSync } from "node:fs";
import ts from "typescript";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWithLang } from "@plexco/core/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mapSessionCommandError,
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
    tenantsForPerson: vi.fn(),
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
  // below assert tenantsForPerson was NEVER called — without this they read leftover calls.
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue(liveSession);
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
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
    expect(tenantsForPerson).not.toHaveBeenCalled();
  });

  it("throttles a pre-authorization caller on an ACTOR bucket, before any membership read", async () => {
    vi.mocked(rateLimited).mockResolvedValue(true);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "RATE_LIMITED", statusCode: 429 });
    expect(rateLimited).toHaveBeenCalledWith("session-actor:acc-1", 60, 60);
    expect(tenantsForPerson).not.toHaveBeenCalled();
  });

  it("does NOT spend the tenant bucket until membership is proven (no cross-tenant DoS)", async () => {
    // codex round-01 [P1]: the per-tenant counter is shared, so if a stranger could spend it they
    // could drive a victim tenant's real admins into 429s and tell a live tenant from 429-vs-403.
    vi.mocked(tenantsForPerson).mockResolvedValue([]);
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
        () => vi.mocked(tenantsForPerson).mockResolvedValue([]),
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
      vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
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

describe("resolveSessionCommandContext — actor authorization", () => {
  it("allows an owner", async () => {
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    expect(result).not.toBeInstanceOf(Response);
    expect(result).toMatchObject({ tenantId: TENANT, commandId: "c1" });
  });

  it("allows a legacy admin (DD-56 maps it onto the session.manage preset)", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "admin" }]);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    expect(result).not.toBeInstanceOf(Response);
  });

  it("ALLOWS co_admin — session.manage is in DD-56's DEFAULT preset, not the granted set", async () => {
    // Reversed in codex round-01 [P2]. DD-56's explicit grant/expiry storage governs the
    // SENSITIVE owner-only capabilities (role.manage, money.refund, billing.manage, …);
    // session.manage is in the default preset that admin and co_admin share, so denying
    // co_admin was a deviation from the accepted contract rather than extra safety.
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "co_admin" }]);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    expect(result).not.toBeInstanceOf(Response);
  });

  it("DENIES an unrecognised role", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "member" }]);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("accepts an UPPERCASE tenant UUID and canonicalizes it (round-02 [P2])", async () => {
    // PostgreSQL renders uuid lowercase, so comparing the raw value denied a legitimate member.
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

  it("TENANT ISOLATION: an owner of tenant A cannot command tenant B", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: OTHER_TENANT, role: "owner" }]);
    const result = await resolveSessionCommandContext(req({ commandId: "c1" }, TENANT), LIMIT);
    const { error } = await envelope(result as Response);
    expect(error).toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("returns the SAME 403 for a non-member as for a bad role (no tenant-existence oracle)", async () => {
    vi.mocked(tenantsForPerson).mockResolvedValue([]);
    const nonMember = await envelope(
      (await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT)) as Response,
    );
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "member" }]);
    const wrongRole = await envelope(
      (await resolveSessionCommandContext(req({ commandId: "c1" }), LIMIT)) as Response,
    );
    expect(nonMember.error).toEqual(wrongRole.error);
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
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
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
    vi.mocked(tenantsForPerson).mockResolvedValue([{ tenantId: TENANT, role: "owner" }]);
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

describe("mapSessionCommandError", () => {
  it.each([
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
      new SessionCloseError("CANCEL_REQUIRES_REVIEW", "internal"),
      "CANCEL_REQUIRES_REVIEW",
      400,
    ],
    [new SessionCancelError("SESSION_NOT_FOUND", "internal"), "SESSION_NOT_FOUND", 404],
    [new SessionCancelError("SESSION_NOT_OPEN", "internal"), "SESSION_NOT_OPEN", 409],
    [new SessionCancelError("STALE_VERSION", "internal"), "STALE_VERSION", 409],
    [new SessionCancelError("COMMAND_ID_CONFLICT", "internal"), "COMMAND_ID_CONFLICT", 409],
    [
      new SessionCancelError("CANCEL_REQUIRES_REVIEW", "internal"),
      "CANCEL_REQUIRES_REVIEW",
      400,
    ],
    [new SessionPublishAuthorizationError(), "TENANT_SUSPENDED", 403],
    [new SessionUpdateAuthorizationError(), "TENANT_SUSPENDED", 403],
    [new SessionCloseAuthorizationError(), "TENANT_SUSPENDED", 403],
    [new SessionCancelAuthorizationError(), "TENANT_SUSPENDED", 403],
  ])("maps %s onto the pinned code+status", async (error, code, statusCode) => {
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

  // Regression for a hole this suite could not previously see. The mapper ended in
  // `err(code as ApiErrorCode, ...)` — a cast, which the compiler cannot verify — so the registry
  // that decides what may appear on the wire had no say over the value actually emitted. Any
  // string reaching the two lookup tables would have been published as a public API code.
  //
  // The fix routes both the check and the emit through ONE derivation, isApiErrorCode. This test
  // pins the resulting property by forging a domain error carrying an unregistered code, which is
  // the only way to reach that branch: every code the tables hold today IS registered, so the
  // guard is invisible until something drifts. Without the fix this returns a 409 envelope
  // carrying an unregistered code; with it, null → the caller rethrows → a generic 500.
  it("fails closed on a domain code that is NOT in the shared registry", () => {
    const forged = new SessionCloseError("COMMAND_ID_CONFLICT", "internal");
    // A REAL instance, mutated after construction, because the mapper dispatches on `instanceof`
    // and a hand-rolled stub would never reach the branch under test. The double assertion is
    // required: `code` is declared as a readonly union of the five legal literals, so nothing
    // narrower erases it.
    (forged as unknown as { code: string }).code = "TOTALLY_UNREGISTERED_CODE";
    expect(mapSessionCommandError(forged)).toBeNull();
  });

  // The positive direction — "every code the mapper CAN emit is registered" — is deliberately not
  // asserted by a second test here. Doing so would need either a new export of STATUS_BY_CODE or a
  // hand-copied list of its keys, and a hand-maintained copy is wrong in whichever version nobody
  // remembered to edit. The property is already enforced by construction: the parametrized mapping
  // table above asserts `response` is NOT null for every shipping code, and after the isApiErrorCode
  // narrowing an unregistered code yields exactly null. Adding a row to STATUS_BY_CODE without
  // registering the code therefore fails that table, and api-contract.test.ts pins the same
  // membership from the registry's own side.

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

  it("resolves the INVALID_BODY collapse message per request too", async () => {
    const en = await runWithLang("en", async () => {
      const response = mapSessionCommandError(new SessionCommandError("INVALID_PRICE", "internal"));
      return (await envelope(response!)).error!.message;
    });
    expect(en).toBe("Invalid payload.");
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

/**
 * Enforces clause 2 of the DD-56 amendment (owner 2026-08-26): the interim role predicate lives at
 * ONE choke-point, and no other file in apps/web decides on a membership role.
 *
 * This is an AST walk, and the reason is recorded below in an executable form rather than a
 * comment: the previous revision matched `role ===` / `ALLOWED_ROLES` textually, and codex proved
 * it bypassable — `["owner"].includes(m.role)`, `switch (m.role)` and `new Set([...]).has(m.role)`
 * all sail past it. Widening the pattern until it stops missing the forms someone happens to think
 * of is not a guarantee, because the form space is open (ternaries, `in`, index access, aliasing a
 * role into a local first). So the rule inverts: instead of enumerating the ways a role can be
 * COMPARED, detect any READ of a role property at all. Reading one in an API route or lib file
 * means participating in the authorization decision, whatever syntax follows.
 *
 * The allowlist is DERIVED from disk (measured, not assumed):
 *   - lib/session-command-route.ts             the choke-point this amendment governs
 *   - app/api/onboarding/readiness/route.ts    pre-existing, merged and gate-passed; the precedent
 *                                              the amendment cites in clause 6 (owner-only,
 *                                              different feature)
 * A third entry is a decision, not a chore: clause 1 requires its own owner decision.
 */
describe("DD-56 amendment clause 2 — the role predicate has exactly one home", () => {
  const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

  /** The first read of a `role` property, or null. Property assignment (`{ role: "owner" }`) and
   *  type members (`role: string` in an interface) are NOT reads and do not count. */
  function roleRead(sourceText: string, fileName = "probe.ts"): string | null {
    const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
    let hit: string | null = null;
    const visit = (node: ts.Node): void => {
      if (hit) return;
      if (ts.isPropertyAccessExpression(node) && node.name.text === "role") {
        hit = node.getText();
      } else if (
        ts.isElementAccessExpression(node) &&
        node.argumentExpression &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        node.argumentExpression.text === "role"
      ) {
        hit = node.getText();
      } else if (
        ts.isBindingElement(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "role"
      ) {
        hit = node.getText();
      } else if (
        // ALIASED destructuring: `const { role: r } = membership` binds to `r`, so checking the
        // bound name alone missed it — the propertyName is the side that names `role`.
        // codex round-01 [P2].
        ts.isBindingElement(node) &&
        node.propertyName &&
        ts.isIdentifier(node.propertyName) &&
        node.propertyName.text === "role"
      ) {
        hit = node.getText();
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    return hit;
  }

  function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) sourceFiles(full, acc);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts")) acc.push(full);
    }
    return acc;
  }

  it("no site outside the allowlist reads a membership role", () => {
    const sites = [
      ...sourceFiles(path.join(WEB_ROOT, "app")),
      ...sourceFiles(path.join(WEB_ROOT, "lib")),
    ]
      .filter((file) => roleRead(readFileSync(file, "utf8"), file) !== null)
      .map((file) => path.relative(WEB_ROOT, file).split(path.sep).join("/"))
      .sort();

    expect(sites).toEqual([
      "app/api/onboarding/readiness/route.ts",
      "lib/session-command-route.ts",
    ]);
  });

  // Each form is a probe the PREVIOUS regex missed. They are permanent cases rather than one-off
  // manual mutations, so the detector cannot silently lose a form later.
  it.each([
    ["strict equality", 'export const f = (m: { role: string }) => m.role === "owner";'],
    ["Array.includes", 'export const f = (m: { role: string }) => ["owner"].includes(m.role);'],
    [
      "switch",
      'export const f = (m: { role: string }) => { switch (m.role) { case "owner": return true; default: return false; } };',
    ],
    ["Set.has", 'export const f = (m: { role: string }) => new Set(["owner"]).has(m.role);'],
    [
      "destructured parameter",
      'export const f = ({ role }: { role: string }) => role === "owner";',
    ],
    ["index access", 'export const f = (m: Record<string, string>) => m["role"] === "owner";'],
    [
      "aliased into a local first",
      'export const f = (m: { role: string }) => { const r = m.role; return r === "owner"; };',
    ],
    ["ternary", 'export const f = (m: { role: string }) => (m.role === "owner" ? 1 : 0);'],
    [
      "aliased destructuring",
      'export const f = (m: { role: string }) => { const { role: r } = m; return r === "owner"; };',
    ],
  ])("the AST detector catches the %s form", (_label, source) => {
    expect(roleRead(source)).not.toBeNull();
  });

  it("the regex this replaced missed three of those forms — why this is an AST walk", () => {
    // Exactly three, measured — not four. A destructured `({ role }) => role === "owner"` still
    // contains the literal `role ===`, so the old pattern DID catch that one; claiming otherwise
    // would overstate the case for this change. These three are the real escapes.
    const SUPERSEDED = /\brole\s*(?:===|!==|==|!=)|ALLOWED_ROLES/;
    const evaded = [
      'export const f = (m: { role: string }) => ["owner"].includes(m.role);',
      'export const f = (m: { role: string }) => { switch (m.role) { case "owner": return true; default: return false; } };',
      'export const f = (m: { role: string }) => new Set(["owner"]).has(m.role);',
    ];
    for (const source of evaded) {
      expect(SUPERSEDED.test(source)).toBe(false); // the old guard said "fine"
      expect(roleRead(source)).not.toBeNull(); // the new one does not
    }
    // And one the old pattern did catch, kept so the comparison stays honest in both directions.
    const caught = 'export const f = ({ role }: { role: string }) => role === "owner";';
    expect(SUPERSEDED.test(caught)).toBe(true);
    expect(roleRead(caught)).not.toBeNull();
  });

  it("does NOT flag a role-shaped type member or object literal (no false positive)", () => {
    expect(roleRead("export interface M { role: string }")).toBeNull();
    expect(roleRead('export const seed = { role: "owner" };')).toBeNull();
  });

  /**
   * The CLOSED half of this guard, and the reason the syntax scan above is no longer load-bearing
   * on its own.
   *
   * Two consecutive review rounds found the scan bypassable — first `includes` / `switch` /
   * `Set.has`, then aliased destructuring and computed access `membership[key]`. That is the shape
   * of an unbounded edge family: each round names one more form, and a computed access cannot be
   * resolved syntactically at all. Enumerating harder is the wrong layer.
   *
   * So this checks the DOOR instead of the uses. Every membership role in apps/web comes from
   * exactly one function, `tenantsForPerson` (the SECURITY DEFINER-backed resolver); grep confirms
   * no other source exists in this app. A file cannot obtain a role without importing it, and an
   * import specifier is finite and exact — no syntax trick evades it.
   *
   * Together the two halves close the family: the door bounds WHO can hold a role to three
   * reviewed files, and the scan says which of those may DECIDE on one. Dynamic access remains
   * unresolvable syntactically, which is precisely why the door check exists — it confines such
   * code to this enumerated set rather than the whole app.
   */
  const ROLE_SOURCE_IMPORTERS = [
    // Returns the caller's OWN memberships; passes them through and makes no role decision.
    "app/api/auth/session/route.ts",
    "app/api/onboarding/readiness/route.ts",
    "lib/session-command-route.ts",
  ];

  function importsRoleSource(sourceText: string, fileName = "probe.ts"): boolean {
    const src = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true);
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (ts.isImportDeclaration(node)) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if ((element.propertyName ?? element.name).text === "tenantsForPerson") found = true;
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(src);
    return found;
  }

  it("only the enumerated files can OBTAIN a membership role at all", () => {
    const importers = [
      ...sourceFiles(path.join(WEB_ROOT, "app")),
      ...sourceFiles(path.join(WEB_ROOT, "lib")),
    ]
      .filter((file) => importsRoleSource(readFileSync(file, "utf8"), file))
      .map((file) => path.relative(WEB_ROOT, file).split(path.sep).join("/"))
      .sort();

    expect(importers).toEqual([...ROLE_SOURCE_IMPORTERS].sort());
  });

  it("every file that READS a role is one that may obtain one (the two halves agree)", () => {
    const readers = [
      ...sourceFiles(path.join(WEB_ROOT, "app")),
      ...sourceFiles(path.join(WEB_ROOT, "lib")),
    ]
      .filter((file) => roleRead(readFileSync(file, "utf8"), file) !== null)
      .map((file) => path.relative(WEB_ROOT, file).split(path.sep).join("/"));

    for (const reader of readers) expect(ROLE_SOURCE_IMPORTERS).toContain(reader);
  });

  it("the import detector catches aliased and renamed specifiers", () => {
    expect(importsRoleSource('import { tenantsForPerson } from "@plexco/db";')).toBe(true);
    expect(importsRoleSource('import { tenantsForPerson as tfp } from "@plexco/db";')).toBe(true);
    expect(importsRoleSource('import { resolveCapability } from "@plexco/db";')).toBe(false);
  });

  it("the scan actually reaches the routes it is meant to police (not a vacuous pass)", () => {
    const scanned = sourceFiles(path.join(WEB_ROOT, "app")).map((file) =>
      path.relative(WEB_ROOT, file).split(path.sep).join("/"),
    );
    expect(scanned).toContain("app/api/sessions/route.ts");
    expect(scanned).toContain("app/api/sessions/[id]/publish/route.ts");
    expect(scanned.length).toBeGreaterThan(8);
  });
});
