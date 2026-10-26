import { randomUUID } from "node:crypto";
import { inspect } from "node:util";
import { authorize, RosterMoneyError, rotatePublicSessionShareLink } from "@plexco/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { appDb, csrfOk, currentSession, rateLimited } from "../../../../../lib/session-cookies";
import { POST } from "./route";

// Publish-precedent mocks: RosterMoneyError stays real (`...actual`); tenantLocale resolves "vi".
vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    rotatePublicSessionShareLink: vi.fn(),
    authorize: vi.fn(),
    withTenant: vi.fn(async (_db: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({})),
  };
});
vi.mock("../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ db: { execute: async () => ({ rows: [{ locale: "vi" }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
// Gate cases NOT repeated here; the shared gate's suite owns the CSRF 403 and the per-tenant 429:
// grep -n "403 CSRF_INVALID\|exceeds the tenant limit" apps/web/lib/session-command-route.test.ts
const TENANT = "11111111-1111-4111-8111-111111111111";
const SID = "33333333-3333-4333-8333-333333333333";
const FOREIGN = "44444444-4444-4444-8444-444444444444";
const CMD = "cmd-share-1";
const SLUG = "Zx9kQ2mV7pLr4tWc8nYb3A";
const NO_STORE = "no-store"; // the api-envelope default, the one source
const VI_NOT_OPEN = "Kèo này không hiển thị công khai nên không tạo được liên kết chia sẻ.";
const TRUSTED = { tenantId: TENANT, actorPersonId: "p", sessionId: SID, commandId: CMD };
const HOSTILE = { tenantId: FOREIGN, actorPersonId: FOREIGN, sessionId: FOREIGN };
const SIGNED_IN = { sessionId: "s", accountId: "a", personId: "p" } as never;
type ShareLinkBody = { path: string }; // what the host control reads from a 200
const SHARE_LINK_KEYS = ["path"] as const satisfies readonly (keyof ShareLinkBody)[];
type Envelope = { data?: Record<string, unknown>; error?: { code: string; message: string } };
const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m));
const rotate = vi.mocked(rotatePublicSessionShareLink);
const HEADERS = { "content-type": "application/json", "x-csrf-token": "secret" };
const post = async (id = SID, extra: object = {}) => {
  const url = `https://plexco.app/api/sessions/${id}/share-link?tenant=${TENANT}`;
  const body = JSON.stringify({ ...extra, commandId: CMD });
  const response = await POST(new Request(url, { method: "POST", headers: HEADERS, body }), {
    params: Promise.resolve({ id }),
  });
  const [text, cache] = [await response.text(), response.headers.get("Cache-Control")];
  return { status: response.status, cache, text, ...(JSON.parse(text) as Envelope) };
};
beforeEach(() => {
  vi.clearAllMocks(); // several cases assert the wrapper was NEVER reached
  vi.mocked(currentSession).mockResolvedValue(SIGNED_IN);
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
});
afterEach(() => {
  const logged = spies.flatMap((spy) => spy.mock.calls.flat().map((arg) => inspect(arg)));
  expect(logged.filter((line) => line.includes(SLUG))).toEqual([]); // H10: the bearer slug
});
it("rotated: 200 no-store, shareLink keys pinned, one call with the trusted context (H5, H6)", async () => {
  rotate.mockResolvedValue({ kind: "rotated", slug: SLUG });
  const { status, cache, data } = await post(SID, HOSTILE); // a hostile body steers nothing
  expect([status, cache, Object.keys(data ?? {})]).toEqual([200, NO_STORE, ["shareLink"]]);
  expect(Object.keys(data?.shareLink as ShareLinkBody)).toEqual([...SHARE_LINK_KEYS]);
  expect((data?.shareLink as ShareLinkBody).path).toBe(`/session/${SLUG}`);
  expect(rotate.mock.calls).toEqual([[expect.anything(), TRUSTED]]);
});
it("replayed: 200 without a link, still no-store (H9)", async () => {
  rotate.mockResolvedValue({ kind: "replayed" });
  const { status, cache, data } = await post();
  expect([status, cache, data]).toEqual([200, NO_STORE, { shareLink: null, replayed: true }]);
});
it("not_listed: the one 409 SESSION_NOT_OPEN, in the tenant's language (H7)", async () => {
  rotate.mockResolvedValue({ kind: "not_listed" });
  const { status, error } = await post();
  expect([status, error?.code, error?.message]).toEqual([409, "SESSION_NOT_OPEN", VI_NOT_OPEN]);
});
it("foreign, random and non-UUID ids pass through unchanged; each maps to 404 SESSION_NOT_FOUND (H8)", async () => {
  const ids = [FOREIGN, randomUUID(), "not-a-uuid"];
  const errors: string[] = [];
  for (const id of ids) {
    rotate.mockRejectedValueOnce(new RosterMoneyError("SESSION_NOT_FOUND", `no session ${id}`));
    const { status, error } = await post(id);
    expect([status, error?.code]).toEqual([404, "SESSION_NOT_FOUND"]);
    errors.push(JSON.stringify(error)); // meta.requestId differs per response; the error must not
  }
  expect(new Set(errors).size).toBe(1);
  expect(rotate.mock.calls.map((call) => call[1].sessionId)).toEqual(ids);
});
it("FORBIDDEN and TENANT_SUSPENDED map to 403, COMMAND_ID_CONFLICT to 409", async () => {
  rotate.mockRejectedValueOnce(new RosterMoneyError("FORBIDDEN", "x"));
  rotate.mockRejectedValueOnce(new RosterMoneyError("TENANT_SUSPENDED", "x"));
  rotate.mockRejectedValueOnce(new RosterMoneyError("COMMAND_ID_CONFLICT", "x"));
  const [forbidden, suspended, conflict] = [await post(), await post(), await post()];
  expect([forbidden.status, forbidden.error?.code]).toEqual([403, "FORBIDDEN"]);
  expect([suspended.status, suspended.error?.code]).toEqual([403, "TENANT_SUSPENDED"]);
  expect([conflict.status, conflict.error?.code]).toEqual([409, "COMMAND_ID_CONFLICT"]);
});
it("not_listed for an en tenant: the same 409 in English, so H7 can fail on the language path", async () => {
  rotate.mockResolvedValue({ kind: "not_listed" });
  const en = "This session is not publicly listed, so a share link cannot be created.";
  const enDb = () => ({ db: { execute: async () => ({ rows: [{ locale: "en" }] }) } });
  // For this test only: withImplementation restores the "vi" answer once the callback settles.
  await vi.mocked(appDb).withImplementation(enDb as never, async () => {
    const { status, error } = await post();
    expect([status, error?.code, error?.message]).toEqual([409, "SESSION_NOT_OPEN", en]);
  });
});
it("401 signed out (gate or the route's actor read), 403 without session.manage; wrapper never reached (H1, H3)", async () => {
  vi.mocked(currentSession).mockResolvedValueOnce(null);
  expect((await post()).status).toBe(401);
  vi.mocked(currentSession).mockResolvedValueOnce(SIGNED_IN).mockResolvedValueOnce(null);
  expect((await post()).status).toBe(401);
  vi.mocked(authorize).mockResolvedValueOnce({ allowed: false } as never);
  expect((await post()).status).toBe(403);
  expect(rotate).not.toHaveBeenCalled();
});
