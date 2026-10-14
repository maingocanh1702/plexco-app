import { listActiveSports } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { currentSession, rateLimited } from "../../../lib/session-cookies";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@plexco/db")>()),
  listActiveSports: vi.fn(),
}));
vi.mock("../../../lib/session-cookies", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/session-cookies")>()),
  appDb: vi.fn(() => ({ pool: {}, db: {} })),
  currentSession: vi.fn(),
  rateLimited: vi.fn(),
}));

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

const envelope = async (r: Response) =>
  (await r.json()) as {
    data: { sports: unknown[] } | null;
    error: { code: string; statusCode: number } | null;
  };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "acct-1",
    personId: "p",
    csrfSecret: "secret",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(listActiveSports).mockResolvedValue([{ id: "i", key: "badminton", name: "Cầu lông" }]);
});

describe("GET /api/sports", () => {
  it("401 AUTH_REQUIRED when anonymous, and never reads the table", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect((await envelope(response)).error?.code).toBe("AUTH_REQUIRED");
    expect(listActiveSports).not.toHaveBeenCalled();
  });

  it("429 RATE_LIMITED, bucketed per ACCOUNT at 60/min", async () => {
    vi.mocked(rateLimited).mockResolvedValue(true);
    const response = await GET();
    expect(response.status).toBe(429);
    expect(rateLimited).toHaveBeenCalledWith("sports:acct-1", 60, 60);
    expect(listActiveSports).not.toHaveBeenCalled();
  });

  it("200 returns the active sports list in the envelope", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect((await envelope(response)).data).toEqual({
      sports: [{ id: "i", key: "badminton", name: "Cầu lông" }],
    });
  });
});
