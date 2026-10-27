import { provisionTenant, SlugTakenError } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  csrfOk,
  currentSession,
  issueSession,
  rateLimited,
  SessionReauthRequiredError,
} from "../../../../lib/session-cookies";
import { POST } from "./route";

vi.mock("@plexco/db", async (importOriginal) => ({
  createDb: vi.fn(() => ({ pool: {} })),
  resolveWebSession: vi.fn(),
  provisionTenant: vi.fn(),
  SlugTakenError: class SlugTakenError extends Error {},
  // The REAL strip and the REAL shared name check (a mocked rule would test nothing):
  // the route strips (L27), then checks (L29).
  stripInvisibleChars: (await importOriginal<typeof import("@plexco/db")>()).stripInvisibleChars,
  checkTypedName: (await importOriginal<typeof import("@plexco/db")>()).checkTypedName,
  pgErrorHasCode: (await importOriginal<typeof import("@plexco/db")>()).pgErrorHasCode,
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
    return new Request("https://plexco.app/api/onboarding/start", {
      method: "POST",
      headers,
      body,
    });
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

  // L27: the route strips first, then runs its existing checks on the stripped name.
  it("stores the club name without invisible code points (R2)", async () => {
    const name = "CLB " + String.fromCodePoint(0x200b) + "A";
    expect((await POST(req({ slug: "club-a", name }))).status).toBe(200);
    expect(vi.mocked(provisionTenant).mock.calls[0]?.[1]).toMatchObject({ name: "CLB A" });
  });

  it("answers the existing 400 for a club name with no visible character (R3)", async () => {
    const name = String.fromCodePoint(0x20, 0x200b, 0x3164);
    const res = await POST(req({ slug: "club-a", name }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "INVALID_BODY",
      message: "Tên CLB hoặc slug không hợp lệ.",
    });
    expect(provisionTenant).not.toHaveBeenCalled();
  });

  // L29 (T1): the route strips (L27), then runs the shared typed-name check. One row per cell:
  // null = refused (the SAME 400, provisionTenant not called); a string = stored exactly so.
  // Inputs are code points: no raw control or bidi byte lives in this file.
  const l29Cells: [string, number[], string | null][] = [
    ["Cc U+0001 inside", [0x57, 0x01, 0x41, 0x4f], null],
    ["Bidi_Control U+202E inside", [0x57, 0x202e, 0x41, 0x4f], null],
    ["U+2028 inside", [0x57, 0x2028, 0x41, 0x4f], null],
    ["U+00A0 only", [0xa0], null],
    ["U+2800 only", [0x2800], null],
    ["U+200B only", [0x200b], null],
    ["U+0000 inside", [0x57, 0x00, 0x41, 0x4f], null],
    ["ordinary WAO Club", [0x57, 0x41, 0x4f, 0x20, 0x43, 0x6c, 0x75, 0x62], "WAO Club"],
    ["edge: U+0009 before and U+2028 after WAO", [0x09, 0x57, 0x41, 0x4f, 0x2028], "WAO"],
  ];
  it.each(l29Cells)("club name, shared check (L29 T1): %s", async (_cell, points, stored) => {
    const res = await POST(req({ slug: "club-a", name: String.fromCodePoint(...points) }));
    if (stored === null) {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatchObject({
        code: "INVALID_BODY",
        message: "Tên CLB hoặc slug không hợp lệ.",
      });
      expect(provisionTenant).not.toHaveBeenCalled();
    } else {
      expect(res.status).toBe(200);
      expect(vi.mocked(provisionTenant).mock.calls[0]?.[1]).toMatchObject({ name: stored });
    }
  });

  // R5: U+200D and U+FE0F are in the strip set. The owner's rule applied as written, no
  // exception: composed emoji are stored split.
  it.each([
    [
      [0x1f468, 0x200d, 0x1f469, 0x200d, 0x1f467],
      [0x1f468, 0x1f469, 0x1f467],
    ], // ZWJ family
    [[0x2764, 0xfe0f], [0x2764]], // VS16 heart
  ])("stores a composed-emoji club name split (R5): %j -> %j", async (sent, stored) => {
    const name = String.fromCodePoint(...sent);
    expect((await POST(req({ slug: "club-a", name }))).status).toBe(200);
    expect(vi.mocked(provisionTenant).mock.calls[0]?.[1]).toMatchObject({
      name: String.fromCodePoint(...stored),
    });
  });
});

describe("bounded native request stream", () => {
  beforeEach(() => {
    vi.mocked(currentSession).mockReset().mockResolvedValue(liveSession);
    vi.mocked(csrfOk).mockReset().mockReturnValue(true);
    vi.mocked(rateLimited).mockReset().mockResolvedValue(false);
    vi.mocked(provisionTenant).mockReset().mockResolvedValue("tenant-1");
    vi.mocked(issueSession).mockReset().mockResolvedValue({ csrfToken: "new-csrf" });
  });

  it.each([undefined, "1", "4096"])(
    "cancels an over-cap open producer before EOF with Content-Length=%s",
    async (declared) => {
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
      const request = streamRequest(
        {
          start(value) {
            controller = value;
          },
          pull(value) {
            pulls += 1;
            if (pulls <= 3) value.enqueue(new Uint8Array(pulls === 3 ? 1 : 2048));
            else signal("read-after-limit");
          },
          cancel,
        },
        declared === undefined ? {} : { "content-length": declared },
      );
      let settled = false;
      const pending = POST(request).then((value) => {
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
      const response = await pending;
      expect(response.status).toBe(413);
      expect((await response.json()).error).toMatchObject({
        code: "INVALID_BODY",
        message: "Dữ liệu quá lớn.",
      });
      expect(provisionTenant).not.toHaveBeenCalled();
      expect(issueSession).not.toHaveBeenCalled();
    },
  );

  function streamRequest(
    source: UnderlyingDefaultSource<Uint8Array>,
    headers: Record<string, string> = {},
  ) {
    return new Request("https://plexco.app/api/onboarding/start", {
      method: "POST",
      duplex: "half",
      headers: { "content-type": "application/json", "x-csrf-token": "secret", ...headers },
      body: new ReadableStream(source, { highWaterMark: 0 }),
    } as RequestInit);
  }

  it.each([undefined, "1", "invalid", "4096"])(
    "preserves split UTF-8 and provision-before-issue at the cap (%s)",
    async (declared) => {
      const payload = { slug: "club-new", name: "Đà🏸", locale: "en", pad: "" };
      payload.pad = "x".repeat(4096 - Buffer.byteLength(JSON.stringify(payload)));
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      const split = Buffer.byteLength('{"slug":"club-new","name":"') + 1;
      const chunks = [
        bytes.subarray(0, split),
        bytes.subarray(split, split + 4),
        bytes.subarray(split + 4),
      ];
      const order: string[] = [];
      vi.mocked(currentSession).mockImplementation(async () => {
        order.push("auth");
        return liveSession;
      });
      vi.mocked(csrfOk).mockImplementation(() => {
        order.push("csrf");
        return true;
      });
      vi.mocked(rateLimited).mockImplementation(async () => {
        order.push("rate");
        return false;
      });
      vi.mocked(provisionTenant).mockImplementation(async () => {
        order.push("provision");
        return "tenant-1";
      });
      vi.mocked(issueSession).mockImplementation(async () => {
        order.push("issue");
        return { csrfToken: "new-csrf" };
      });
      let index = 0;
      const request = streamRequest(
        {
          pull(controller) {
            if (index === 0) order.push("body");
            if (index < chunks.length) controller.enqueue(chunks[index++]);
            else controller.close();
          },
        },
        declared === undefined ? {} : { "content-length": declared },
      );
      const response = await POST(request);
      expect(response.status).toBe(200);
      expect(provisionTenant).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ name: "Đà🏸", locale: "en", personId: "person-1" }),
      );
      expect(rateLimited).toHaveBeenCalledWith("tenant-create:acc-1", 3, 3600);
      expect(order).toEqual(["auth", "csrf", "rate", "body", "provision", "issue"]);
    },
  );

  it.each(["invalid", "truncated", "empty", "read", "locked", "cancel"])(
    "maps %s body failures to the existing Vietnamese 400",
    async (kind) => {
      const failure = new Error("source failed");
      const bytes =
        kind === "empty"
          ? new Uint8Array()
          : Uint8Array.from([
              ...new TextEncoder().encode('{"slug":"club-new","name":"'),
              ...(kind === "truncated" ? [0xe2, 0x82] : [0x80, 0x22, 0x7d]),
            ]);
      const request = streamRequest({
        pull(controller) {
          if (kind === "read") throw failure;
          controller.enqueue(kind === "cancel" ? new Uint8Array(4097) : bytes);
          if (kind !== "cancel") controller.close();
        },
        cancel() {
          throw failure;
        },
      });
      const lock = kind === "locked" ? request.body!.getReader() : undefined;
      try {
        const response = await POST(request);
        expect(response.status).toBe(400);
        expect((await response.json()).error).toMatchObject({
          code: "INVALID_BODY",
          message: "Dữ liệu không hợp lệ.",
        });
        expect(provisionTenant).not.toHaveBeenCalled();
        expect(issueSession).not.toHaveBeenCalled();
      } finally {
        lock?.releaseLock();
      }
    },
  );

  it.each(["auth", "csrf", "quota", "type", "declared"] as const)(
    "does not pull or mutate after the %s gate refuses",
    async (gate) => {
      if (gate === "auth") vi.mocked(currentSession).mockResolvedValue(null);
      if (gate === "csrf") vi.mocked(csrfOk).mockReturnValue(false);
      if (gate === "quota") vi.mocked(rateLimited).mockResolvedValue(true);
      const pull = vi.fn();
      const request = streamRequest({ pull });
      if (gate === "type") request.headers.set("content-type", "text/plain");
      if (gate === "declared") request.headers.set("content-length", "4097");
      const response = await POST(request);
      expect(response.status).toBe(
        { auth: 401, csrf: 403, quota: 429, type: 400, declared: 413 }[gate],
      );
      if (gate === "declared")
        expect((await response.json()).error).toMatchObject({
          code: "INVALID_BODY",
          message: "Dữ liệu quá lớn.",
        });
      expect(pull).not.toHaveBeenCalled();
      expect(request.bodyUsed).toBe(false);
      expect(provisionTenant).not.toHaveBeenCalled();
      expect(issueSession).not.toHaveBeenCalled();
      expect(rateLimited).toHaveBeenCalledTimes(gate === "auth" || gate === "csrf" ? 0 : 1);
    },
  );

  it.each(["quota", "provision"])(
    "keeps unrelated %s faults outside the body catch",
    async (step) => {
      const failure = new Error("dependency failed");
      if (step === "quota") vi.mocked(rateLimited).mockRejectedValue(failure);
      else vi.mocked(provisionTenant).mockRejectedValue(failure);
      await expect(POST(req({ slug: "club-new", name: "New" }))).rejects.toBe(failure);
      expect(issueSession).not.toHaveBeenCalled();
    },
  );

  it("retains the existing slug-conflict mapping after a valid body", async () => {
    vi.mocked(provisionTenant).mockRejectedValue(new SlugTakenError());
    const response = await POST(req({ slug: "club-new", name: "New" }));
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("SLUG_TAKEN");
    expect(issueSession).not.toHaveBeenCalled();
  });
});
