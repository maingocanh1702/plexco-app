import { listMyChannels } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession } from "../../../../lib/session-cookies";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return { ...actual, listMyChannels: vi.fn() };
});
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: { tag: "pool" }, db: {} })),
    currentSession: vi.fn(),
    rateLimited: vi.fn().mockResolvedValue(false),
  };
});

const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CI = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: ACCOUNT,
    personId: "pppppppp-pppp-4ppp-8ppp-pppppppppppp",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
});

describe("GET /api/me/channels", () => {
  it("401 without a session", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await GET(new Request("https://plexco.app/api/me/channels"))).status).toBe(401);
    expect(listMyChannels).not.toHaveBeenCalled();
  });

  it("projects id/platform/status/createdAt only; leaks no person, platform id or bot id", async () => {
    vi.mocked(listMyChannels).mockResolvedValue([
      {
        channelIdentityId: CI,
        platform: "zalo",
        status: "active",
        createdAt: new Date("2026-10-01T00:00:00Z"),
        // A future widening of the DB row must not reach the wire.
        ...({ personId: "p", platformUserId: "u", zaloBotId: "b" } as object),
      },
    ]);
    const res = await GET(new Request("https://plexco.app/api/me/channels"));
    const body = (await res.json()) as { data: { channels: unknown[] } };
    expect(res.status).toBe(200);
    expect(body.data.channels).toEqual([
      { id: CI, platform: "zalo", status: "active", createdAt: "2026-10-01T00:00:00.000Z" },
    ]);
    expect(listMyChannels).toHaveBeenCalledWith({ tag: "pool" }, ACCOUNT);
  });

  it("empty list is a valid answer", async () => {
    vi.mocked(listMyChannels).mockResolvedValue([]);
    const res = await GET(new Request("https://plexco.app/api/me/channels"));
    expect(((await res.json()) as { data: unknown }).data).toEqual({ channels: [] });
  });
});
