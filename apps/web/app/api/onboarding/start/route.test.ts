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

// Keep the REAL t() behaviour — the Vietnamese-message assertions below depend on it — but make the
// call observable, so the success-path tripwire can assert that NO translatable string is emitted.
vi.mock("@plexco/core/i18n", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/core/i18n")>();
  return { ...actual, t: vi.fn(actual.t) };
});

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

/**
 * DD-118 bucket (b) — INTENDED behaviour, not a coverage gap.
 *
 * This route looks like bucket (a): it is authenticated and it CREATES a tenant, so a tenant id
 * exists by the end. It is (b) anyway, because the bucket turns on what is true at the moment a
 * translatable string is emitted. Every `t()` here is emitted with no tenant known-and-owned:
 * the validation and rate-limit rejections all precede provisionTenant; SLUG_TAKEN means no tenant
 * was created; and the AUTH_INVALID fence fires when a concurrent logout-all revoked the session,
 * so the actor is no longer authenticated (answering THAT in the new tenant's language would also
 * disclose that the tenant now exists). The success path carries no translatable string at all.
 *
 * TRIPWIRE. If a `t()` is ever added to the success path below provisionTenant, this route becomes
 * bucket (a) and must resolve language. The last case fails when that happens.
 */
describe("POST /api/onboarding/start — stays Vietnamese by DD-118 (bucket b)", () => {
  beforeEach(() => {
    vi.mocked(currentSession).mockResolvedValue(liveSession);
    vi.mocked(csrfOk).mockReturnValue(true);
    vi.mocked(rateLimited).mockResolvedValue(false);
    vi.mocked(provisionTenant).mockResolvedValue("tenant-1");
    vi.mocked(issueSession).mockResolvedValue({ csrfToken: "new-csrf" });
  });

  async function messageOf(res: Response): Promise<string> {
    const body = (await res.json()) as { error: { message: string } | null };
    return body.error?.message ?? "";
  }

  it("rejects an unsupported locale in Vietnamese, even though the body asks for one", async () => {
    const res = await POST(req({ slug: "club-a", name: "Club A", locale: "fr" }));
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toBe("Ngôn ngữ không hỗ trợ.");
  });

  it("rejects an invalid slug in Vietnamese while requesting an en tenant", async () => {
    const res = await POST(req({ slug: "-bad-", name: "Club B", locale: "en" }));
    expect(res.status).toBe(400);
    expect(await messageOf(res)).toBe("Tên CLB hoặc slug không hợp lệ.");
  });

  it("maps the issuance fence to Vietnamese: tenant exists, actor no longer authenticated", async () => {
    vi.mocked(issueSession).mockRejectedValue(new SessionReauthRequiredError());
    const res = await POST(req({ slug: "club-c", name: "Club C", locale: "en" }));
    expect(res.status).toBe(401);
    expect(await messageOf(res)).toBe("Xác thực không hợp lệ.");
  });

  // TRIPWIRE (see the block comment): the success path carries no translatable string, which is
  // WHY this route needs no language context. Adding one makes this route bucket (a).
  //
  // Asserting on the response KEYS was not enough (codex round-01 [P2]): `t("active", "Active")`
  // substituted into an existing VALUE leaves every key unchanged, so a key-shape assertion passes
  // while an unreachable English branch is introduced — exactly the defect this claims to catch.
  // Spying on `t` itself detects any translatable string on this path regardless of where it lands.
  it("makes no t() call at all on the success path", async () => {
    const { t } = await import("@plexco/core/i18n");
    vi.mocked(t).mockClear();

    const res = await POST(req({ slug: "club-d", name: "Club D", locale: "en" }));

    expect(res.status).toBe(200);
    expect(t).not.toHaveBeenCalled();
  });

  it("still returns the documented success shape", async () => {
    const res = await POST(req({ slug: "club-e", name: "Club E", locale: "en" }));
    const body = (await res.json()) as { data: Record<string, unknown>; error: null };
    expect(body.error).toBeNull();
    expect(Object.keys(body.data).sort()).toEqual(["csrfToken", "plan", "status", "tenantId"]);
  });
});

/**
 * Audit 2026-09-06 W-8 — the body is bounded (4 KiB) and typed, and the club name is capped at
 * 120 chars (mirrors tenants_name_len_chk, migration 0039) so the CHECK never surfaces as a 500.
 */
describe("POST /api/onboarding/start — bounded body + name length (audit W-8)", () => {
  beforeEach(() => {
    vi.mocked(currentSession).mockResolvedValue(liveSession);
    vi.mocked(csrfOk).mockReturnValue(true);
    vi.mocked(rateLimited).mockResolvedValue(false);
    vi.mocked(provisionTenant).mockReset().mockResolvedValue("tenant-1");
    vi.mocked(issueSession).mockResolvedValue({ csrfToken: "new-csrf" });
  });

  function rawReq(body: string, contentType: string | null = "application/json"): Request {
    const headers: Record<string, string> = { "x-csrf-token": "secret" };
    if (contentType !== null) headers["content-type"] = contentType;
    return new Request("https://plexco.app/api/onboarding/start", { method: "POST", headers, body });
  }

  it("rejects a body over 4 KiB with 413 before provisioning, even with a lying Content-Length", async () => {
    const big = JSON.stringify({ slug: "club-a", name: "A", pad: "x".repeat(5000) });
    const res = await POST(rawReq(big));
    expect(res.status).toBe(413);
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON content type with 400", async () => {
    for (const ct of ["text/plain", "application/x-www-form-urlencoded", null]) {
      const res = await POST(rawReq(JSON.stringify({ slug: "club-a", name: "A" }), ct));
      expect(res.status, String(ct)).toBe(400);
    }
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  it("rejects a 121-char club name with 400 and accepts 120", async () => {
    const res121 = await POST(req({ slug: "club-a", name: "x".repeat(121) }));
    expect(res121.status).toBe(400);
    expect(provisionTenant).not.toHaveBeenCalled();
    const res120 = await POST(req({ slug: "club-a", name: "x".repeat(120) }));
    expect(res120.status).toBe(200);
    expect(provisionTenant).toHaveBeenCalledOnce();
  });
});
