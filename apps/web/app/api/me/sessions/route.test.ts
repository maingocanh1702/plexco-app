import { listMySessions } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession, rateLimited } from "../../../../lib/session-cookies";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  listMySessions: vi.fn(),
}));
vi.mock("../../../../lib/session-cookies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/session-cookies")>()),
  appDb: vi.fn(() => ({ pool: { tag: "pool" }, db: {} })),
  currentSession: vi.fn(),
  rateLimited: vi.fn(),
}));

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION = { sessionId: "s", accountId: ACCOUNT, personId: "p", csrfSecret: "c" };
const URL_ = "https://plexco.app/api/me/sessions";
const CALL = [{ tag: "pool" }, ACCOUNT];
const RESULT = { sessions: [], truncated: true };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(currentSession).mockResolvedValue({ ...SESSION, expiresAt: new Date(8e15) });
});

async function expectGateError(status: number, code: string) {
  const res = await GET(new Request(URL_));
  expect([res.status, res.headers.get("cache-control")]).toEqual([status, "no-store"]);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe(code);
  expect(listMySessions).not.toHaveBeenCalled();
}

describe("GET /api/me/sessions", () => {
  it("200 private no-store; account from the session only, ids in query or body change nothing (A-10, A-11)", async () => {
    vi.mocked(listMySessions).mockResolvedValue(RESULT);
    const req = new Request(`${URL_}?person_id=B&tenant_id=T3&membership_id=M`, {
      method: "POST",
      body: '{"person_id":"B","tenant_id":"T3","membership_id":"M","account_id":"X"}',
    });
    const reads = [vi.spyOn(req, "json"), vi.spyOn(req, "text"), vi.spyOn(req, "url", "get")];
    for (const res of [await GET(new Request(URL_)), await GET(req)]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      expect(((await res.json()) as { data: unknown }).data).toEqual(RESULT);
    }
    expect(vi.mocked(listMySessions).mock.calls).toEqual([CALL, CALL]);
    for (const read of reads) expect(read).not.toHaveBeenCalled();
    expect(rateLimited).toHaveBeenCalledWith(`me-sessions-read:${ACCOUNT}`, 30, 60);
  });

  it("401 AUTH_REQUIRED without a session; 429 RATE_LIMITED on the me-sessions-read bucket (A-15, A-16)", async () => {
    vi.mocked(currentSession).mockResolvedValueOnce(null);
    await expectGateError(401, "AUTH_REQUIRED");
    vi.mocked(rateLimited).mockImplementation(async (k) => k.startsWith("me-sessions-read:"));
    await expectGateError(429, "RATE_LIMITED");
  });

  it("500 empty body, private no-store; logs the route and error name only (A-10, M-13)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listMySessions).mockRejectedValue(new TypeError("boom"));
    const res = await GET(new Request(URL_));
    expect([res.status, await res.text()]).toEqual([500, ""]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(log).toHaveBeenCalledWith("GET /api/me/sessions failed", "TypeError");
  });
});
