/**
 * GET /api/me/clubs/:clubRef/chat-context against the real DB as the app role (readiness section
 * 5.1, route table CR-1..CR-9). readMyClubChatContext is a pass-through vi.fn: every row runs the
 * real 0066 definer; only CR-2/CR-3/CR-7 (call counts) and CR-9 (one rejection) observe or arm it.
 */
import { randomUUID } from "node:crypto";
import { runWithLang } from "@plexco/core/i18n";
import { createWebSession, readMyClubChatContext } from "@plexco/db";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  seedPersonAccount,
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../../../../../../packages/db/src/test-harness.js";
import {
  appDb,
  hashToken,
  resetDbRoleViolationForTests,
} from "../../../../../../lib/session-cookies";
import { GET as listMyClubsRoute } from "../../route";
import { GET } from "./route";

const cookieJar = vi.hoisted(() => ({ token: undefined as string | undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => (cookieJar.token ? { value: cookieJar.token } : undefined),
  }),
}));
vi.mock("@plexco/db", async (importOriginal) => {
  const m = await importOriginal<typeof import("@plexco/db")>();
  return { ...m, readMyClubChatContext: vi.fn(m.readMyClubChatContext) };
});

let ctx: RlsTestContext;
let runtime: ReturnType<typeof appDb> | undefined;

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_me_chat_context_${process.pid}`);
  const url = ctx.appPool.options.connectionString;
  if (typeof url !== "string") throw new Error("Missing isolated app connection string");
  vi.stubEnv("DATABASE_URL", url);
  vi.stubEnv("DB_EXPECTED_ROLE", "app");
  resetDbRoleViolationForTests();
  runtime = appDb();
  const { rows } = await runtime.pool.query(
    `SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  expect(rows).toEqual([{ current_user: "app", rolsuper: false, rolbypassrls: false }]);
}, 120_000);

afterAll(async () => {
  try {
    await runtime?.close();
  } finally {
    resetDbRoleViolationForTests();
    try {
      await ctx?.teardown();
    } finally {
      vi.unstubAllEnvs();
    }
  }
}, 120_000);

const PRIVATE = "private, no-store";
const ROUTE = "https://plexco.app/api/me/clubs";
type Envelope = { data: unknown; error: { code: string } | null };
type Player = { accountId: string; personId: string; token: string };

// A non-default zone proves the 200 carries the asked club's own tenants.timezone.
async function club(timezone = "Asia/Tokyo"): Promise<{ id: string; slug: string }> {
  const slug = `cx-${randomUUID()}`;
  const { rows } = await ctx.owner.query<{ id: string }>(
    `INSERT INTO tenants (name, slug, timezone) VALUES ('Chat Context', $1, $2) RETURNING id`,
    [slug, timezone],
  );
  return { id: rows[0]!.id, slug };
}

async function member(tenantId: string, personId: string, status = "active"): Promise<void> {
  await ctx.owner.query(
    `INSERT INTO memberships (tenant_id, person_id, status) VALUES ($1, $2, $3)`,
    [tenantId, personId, status],
  );
}

/** A live web session for the account; returns its cookie token. */
async function signIn(accountId: string): Promise<string> {
  const token = randomUUID();
  await createWebSession(runtime!.pool, {
    accountId,
    tokenHash: hashToken(token),
    csrfSecret: randomUUID(),
    ttlSeconds: 3600,
  });
  return token;
}

/** A signed-in player: an account with an active person. */
async function player(): Promise<Player> {
  const p = await seedPersonAccount(ctx.owner, randomUUID());
  return { ...p, token: await signIn(p.accountId) };
}

/** The route as Next calls it: the decoded segment arrives in params as a string. */
function call(token: string | undefined, clubRef: string, query = "", headers?: HeadersInit) {
  cookieJar.token = token;
  const url = `${ROUTE}/${encodeURIComponent(clubRef)}/chat-context${query}`;
  return GET(new Request(url, { headers }), { params: Promise.resolve({ clubRef }) });
}

const REQUEST_ID = /"requestId":"req_[0-9a-f-]{36}"/;

/** Status, every header and the body bytes. The fresh random meta.requestId (lib/api-envelope.ts)
 *  is the only per-response byte: its shape is checked, then it is masked. */
async function wire(res: Response) {
  const body = await res.text();
  expect(body).toMatch(REQUEST_ID);
  return {
    status: res.status,
    headers: [...res.headers.entries()],
    body: body.replace(REQUEST_ID, '"requestId":"req_*"'),
  };
}

const denyBody = (message: string) =>
  `{"data":null,"error":{"code":"NOT_FOUND","message":"${message}","statusCode":404},` +
  `"meta":{"requestId":"req_*"}}`;

describe("GET /api/me/clubs/:clubRef/chat-context", () => {
  it("CR-1 (R1): an active member gets 200 with exactly {tenantId, timezone}, private no-store", async () => {
    const x = await club();
    const a = await player();
    await member(x.id, a.personId);
    const res = await call(a.token, x.slug);
    expect([res.status, res.headers.get("cache-control")]).toEqual([200, PRIVATE]);
    const body = (await res.json()) as Envelope;
    expect([body.data, body.error]).toStrictEqual([
      { tenantId: x.id, timezone: "Asia/Tokyo" },
      null,
    ]);
  });

  describe("the one deny", () => {
    // R2: every DB-backed deny kind, all asking about one real club X that has an active member.
    let cases: { kind: string; token: string; clubRef: string }[] = [];
    // R3: malformed slugs (the 64-character one is one past SLUG_RE's 63), asked by X's member.
    const MALFORMED = ["Dev-Club", "-x", "a".repeat(64), "a%2Fb", "a/b"];
    let memberOfX: Player;

    beforeAll(async () => {
      const x = await club();
      memberOfX = await player();
      await member(x.id, memberOfX.personId);
      const [guest, left, none, asker, merged, survivor] = [
        await player(),
        await player(),
        await player(),
        await player(),
        await player(),
        await player(),
      ];
      await member(x.id, guest.personId, "guest");
      await member(x.id, left.personId, "left");
      await member(x.id, asker.personId);
      await member(x.id, merged.personId);
      await ctx.owner.query(
        `UPDATE persons SET status = 'merged', merged_into_person_id = $2 WHERE id = $1`,
        [merged.personId, survivor.personId],
      );
      const { rows } = await ctx.owner.query<{ id: string }>(
        `INSERT INTO accounts (person_id) VALUES (NULL) RETURNING id`,
      );
      cases = [
        { kind: "guest", token: guest.token, clubRef: x.slug },
        { kind: "left", token: left.token, clubRef: x.slug },
        { kind: "no membership", token: none.token, clubRef: x.slug },
        { kind: "unknown well-formed slug", token: asker.token, clubRef: "u".repeat(63) },
        { kind: "merged person", token: merged.token, clubRef: x.slug },
        { kind: "account with no person", token: await signIn(rows[0]!.id), clubRef: x.slug },
      ];
    }, 120_000);

    it("CR-2 (R2): guest, left, no membership, unknown slug, merged person, no person -> 404 NOT_FOUND, private no-store, from the definer's zero rows", async () => {
      vi.mocked(readMyClubChatContext).mockClear();
      for (const c of cases) {
        const res = await call(c.token, c.clubRef);
        expect([c.kind, res.status, res.headers.get("cache-control")]).toEqual([
          c.kind,
          404,
          PRIVATE,
        ]);
        expect(((await res.json()) as Envelope).error?.code).toBe("NOT_FOUND");
      }
      expect(readMyClubChatContext).toHaveBeenCalledTimes(cases.length);
    });

    it("CR-3 (R3): a malformed slug is the same deny and the definer is never called", async () => {
      vi.mocked(readMyClubChatContext).mockClear();
      for (const slug of MALFORMED) {
        const res = await call(memberOfX.token, slug);
        expect([slug, res.status, res.headers.get("cache-control")]).toEqual([slug, 404, PRIVATE]);
      }
      expect(readMyClubChatContext).not.toHaveBeenCalled();
    });

    it("CR-4 (R4): every R2 and R3 deny is byte-identical (status, headers, body) in vi and in en", async () => {
      // vi is the route as deployed: it sets no language, so the /me default applies (DD-118 b,
      // lib/me-route-gate.ts); en pins the other half of the t() pair.
      for (const [lang, message] of [
        ["vi", "Không tìm thấy."],
        ["en", "Not found."],
      ] as const) {
        const ask = (token: string, ref: string) =>
          lang === "vi" ? call(token, ref) : runWithLang("en", () => call(token, ref));
        const shapes: Awaited<ReturnType<typeof wire>>[] = [];
        for (const c of cases) shapes.push(await wire(await ask(c.token, c.clubRef)));
        for (const slug of MALFORMED) shapes.push(await wire(await ask(memberOfX.token, slug)));
        expect(shapes[0]).toStrictEqual({
          status: 404,
          headers: [
            ["cache-control", PRIVATE],
            ["content-type", "application/json"],
          ],
          body: denyBody(message),
        });
        for (const s of shapes) expect(s).toStrictEqual(shapes[0]);
      }
    });
  });

  it("CR-5 (R5): active in clubs X and Y, each ask returns only the asked club's row", async () => {
    const x = await club("Asia/Tokyo");
    const y = await club("Europe/Paris");
    const a = await player();
    await member(x.id, a.personId);
    await member(y.id, a.personId);
    for (const [c, timezone] of [
      [x, "Asia/Tokyo"],
      [y, "Europe/Paris"],
    ] as const) {
      const body = (await (await call(a.token, c.slug)).json()) as Envelope;
      expect(body.data).toStrictEqual({ tenantId: c.id, timezone });
    }
  });

  it("CR-6 (R6): ?tenant=, ?account=, ?person= and x-tenant-id are ignored on a 200 and on a deny", async () => {
    const x = await club();
    const y = await club("Europe/Paris");
    const a = await player();
    const outsider = await player();
    await member(x.id, a.personId);
    await member(y.id, outsider.personId);
    const forged = (tenant: string, who: { accountId: string; personId: string }) =>
      `?tenant=${tenant}&account=${who.accountId}&person=${who.personId}`;
    // X's member names Y and the outsider: still X's own row; nothing on the request is read.
    const req = new Request(`${ROUTE}/${x.slug}/chat-context${forged(y.id, outsider)}`, {
      headers: { "x-tenant-id": y.id },
    });
    const reads = [
      vi.spyOn(req, "url", "get"),
      vi.spyOn(req, "headers", "get"),
      vi.spyOn(req, "json"),
      vi.spyOn(req, "text"),
    ];
    cookieJar.token = a.token;
    const res = await GET(req, { params: Promise.resolve({ clubRef: x.slug }) });
    expect(((await res.json()) as Envelope).data).toStrictEqual({
      tenantId: x.id,
      timezone: "Asia/Tokyo",
    });
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    // The outsider names X and X's member: the same deny as asking plainly.
    const denied = await wire(
      await call(outsider.token, x.slug, forged(x.id, a), { "x-tenant-id": x.id }),
    );
    expect(denied).toStrictEqual(await wire(await call(outsider.token, x.slug)));
    expect(denied.body).toBe(denyBody("Không tìm thấy."));
  });

  it("CR-7 (R7): no session -> the gate's 401 AUTH_REQUIRED, no-store; the definer is never called", async () => {
    const x = await club();
    vi.mocked(readMyClubChatContext).mockClear();
    const res = await call(undefined, x.slug);
    expect([res.status, res.headers.get("cache-control")]).toEqual([401, "no-store"]);
    expect(((await res.json()) as Envelope).error?.code).toBe("AUTH_REQUIRED");
    expect(readMyClubChatContext).not.toHaveBeenCalled();
  });

  it("CR-8 (R8): the 21st call in 60 s -> 429 RATE_LIMITED, no-store; me-clubs-read is a separate bucket", async () => {
    const x = await club();
    const a = await player();
    await member(x.id, a.personId);
    for (let i = 0; i < 20; i += 1) expect((await call(a.token, x.slug)).status).toBe(200);
    const res = await call(a.token, x.slug);
    expect([res.status, res.headers.get("cache-control")]).toEqual([429, "no-store"]);
    expect(((await res.json()) as Envelope).error?.code).toBe("RATE_LIMITED");
    cookieJar.token = a.token;
    expect((await listMyClubsRoute(new Request(ROUTE))).status).toBe(200);
  });

  it("CR-9 (R9): the wrapper throws -> 500, null body, private no-store; the log holds the route and the error name only", async () => {
    const x = await club();
    const a = await player();
    await member(x.id, a.personId);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      // The message names the slug, the account and the tenant id: none may reach the log.
      vi.mocked(readMyClubChatContext).mockRejectedValueOnce(
        new TypeError(`boom ${x.slug} ${a.accountId} ${x.id}`),
      );
      const res = await call(a.token, x.slug);
      expect([res.status, await res.text(), res.headers.get("cache-control")]).toEqual([
        500,
        "",
        PRIVATE,
      ]);
      expect(log.mock.calls).toEqual([
        ["GET /api/me/clubs/[clubRef]/chat-context failed", "TypeError"],
      ]);
    } finally {
      log.mockRestore();
    }
  });
});
