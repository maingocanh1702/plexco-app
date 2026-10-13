import { detachMyChannel } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { csrfOk, currentSession, rateLimited } from "../../../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return { ...actual, detachMyChannel: vi.fn() };
});
vi.mock("../../../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: { tag: "pool" }, db: {} })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CI = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const call = (id: string) =>
  POST(
    new Request(`https://plexco.app/api/me/channels/${id}/detach`, {
      method: "POST",
      headers: { "x-csrf-token": "secret" },
    }),
    { params: Promise.resolve({ id }) },
  );
const env = async (r: Response) =>
  (await r.json()) as { data: unknown; error: { code: string } | null };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: ACCOUNT,
    personId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(detachMyChannel).mockResolvedValue({ outcome: "detached" });
});

describe("POST /api/me/channels/:id/detach", () => {
  it("401 without a session; 403 CSRF before the bucket", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await call(CI)).status).toBe(401);
    vi.mocked(currentSession).mockResolvedValue({
      sessionId: "s",
      accountId: ACCOUNT,
      personId: "p",
      csrfSecret: "secret",
      expiresAt: new Date(Date.now() + 1000),
    });
    vi.mocked(csrfOk).mockReturnValue(false);
    const res = await call(CI);
    expect(res.status).toBe(403);
    expect(rateLimited).not.toHaveBeenCalled();
    expect(detachMyChannel).not.toHaveBeenCalled();
  });

  it("429 when the 5 per 10 minutes bucket is spent", async () => {
    vi.mocked(rateLimited).mockImplementation(async (key) => String(key).startsWith("me-detach:"));
    const res = await call(CI);
    expect(res.status).toBe(429);
    expect(rateLimited).toHaveBeenCalledWith(`me-detach:${ACCOUNT}`, 5, 600);
    expect(detachMyChannel).not.toHaveBeenCalled();
  });

  it("400 for a malformed id, before any DB work", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(detachMyChannel).not.toHaveBeenCalled();
  });

  it("200 detached, using the SESSION account; response carries no person id", async () => {
    const res = await call(CI.toUpperCase());
    expect(res.status).toBe(200);
    expect((await env(res)).data).toEqual({ detached: true });
    expect(detachMyChannel).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT, CI);
  });

  it("409 CHANNEL_NOT_LINKED for not-mine / unknown / already-detached alike (second call)", async () => {
    vi.mocked(detachMyChannel).mockResolvedValue({ outcome: "invalid" });
    const res = await call(CI);
    expect(res.status).toBe(409);
    expect((await env(res)).error?.code).toBe("CHANNEL_NOT_LINKED");
  });
});
