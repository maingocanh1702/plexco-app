import { provisionTenant } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  csrfOk,
  currentSession,
  issueSession,
  rateLimited,
  SessionReauthRequiredError,
} from "../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", () => ({
  createDb: vi.fn(() => ({ pool: {} })),
  resolveWebSession: vi.fn(),
  provisionTenant: vi.fn(),
  SlugTakenError: class SlugTakenError extends Error {},
}));

// Partial mock: override the session / CSRF / rate-limit / issue helpers so the
// happy path reaches issueSession deterministically. SessionReauthRequiredError
// stays the real class the route's catch compares against.
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {} })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
    issueSession: vi.fn(),
  };
});

process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";

function req(body: unknown): Request {
  return new Request("https://plexco.app/api/onboarding/start", {
    method: "POST",
    headers: { "content-type": "application/json", "x-csrf-token": "secret" },
    body: JSON.stringify(body),
  });
}

const liveSession = {
  sessionId: "sess-1",
  accountId: "acc-1",
  personId: "person-1",
  csrfSecret: "secret",
  expiresAt: new Date(Date.now() + 3_600_000),
};

/**
 * G3-B3 / D0-12: the owner-grant rotate can hit the fence (rotate returned null
 * because a concurrent logout-all revoked the session mid-onboarding);
 * issueSession then throws SessionReauthRequiredError and this caller must map
 * it to a generic 401 AUTH_INVALID with no internal reason leaked. An unrelated
 * error must still propagate (the catch is specific), and a normal issue must
 * still return 200.
 */
describe("POST /api/onboarding/start — issuance-fence mapping (G3-B3, D0-12)", () => {
  beforeEach(() => {
    vi.mocked(currentSession).mockResolvedValue(liveSession);
    vi.mocked(csrfOk).mockReturnValue(true);
    vi.mocked(rateLimited).mockResolvedValue(false);
    vi.mocked(provisionTenant).mockResolvedValue("tenant-1");
    vi.mocked(issueSession).mockReset();
  });

  it("maps SessionReauthRequiredError to a generic 401 AUTH_INVALID, no reason leaked", async () => {
    vi.mocked(issueSession).mockRejectedValue(new SessionReauthRequiredError());

    const res = await POST(req({ slug: "club-one", name: "Club One" }));

    expect(provisionTenant).toHaveBeenCalledOnce();
    expect(issueSession).toHaveBeenCalledWith("acc-1");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe("AUTH_INVALID");
    expect(JSON.stringify(body).toLowerCase()).not.toContain("reauth");
  });

  it("does NOT swallow an unrelated issueSession error (mapping is specific)", async () => {
    vi.mocked(issueSession).mockRejectedValue(new Error("db exploded"));

    await expect(POST(req({ slug: "club-two", name: "Club Two" }))).rejects.toThrow("db exploded");
  });

  it("returns 200 with the tenant when issueSession succeeds (happy path unaffected)", async () => {
    vi.mocked(issueSession).mockResolvedValue({ csrfToken: "new-csrf" });

    const res = await POST(req({ slug: "club-three", name: "Club Three" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toMatchObject({ tenantId: "tenant-1", plan: "free", status: "active" });
  });
});
