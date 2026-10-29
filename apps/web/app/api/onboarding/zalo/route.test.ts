import { authorize, getZaloOnboardingState } from "@plexco/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "../../../../lib/log";
import { captureConsoleSinks } from "../../../../lib/log-capture.testkit";
import { csrfOk, currentSession, rateLimited } from "../../../../lib/session-cookies";
import { GET } from "./route";

vi.mock("@plexco/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@plexco/db")>();
  return {
    ...actual,
    authorize: vi.fn(),
    getZaloOnboardingState: vi.fn(),
    withTenant: vi.fn(async (_d: unknown, _t: string, fn: (tx: unknown) => unknown) => fn({})),
  };
});
vi.mock("../../../../lib/session-cookies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/session-cookies")>();
  return {
    ...actual,
    appDb: vi.fn(() => ({ pool: {}, db: { execute: async () => ({ rows: [{ locale: "en" }] }) } })),
    currentSession: vi.fn(),
    csrfOk: vi.fn(),
    rateLimited: vi.fn(),
  };
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const get = () => GET(new Request(`https://plexco.app/api/onboarding/zalo?tenant=${TENANT}`));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.APP_BASE_URL = "https://plexco.app";
  vi.mocked(currentSession).mockResolvedValue({
    sessionId: "s",
    accountId: "a",
    personId: "p",
    csrfSecret: "x",
    expiresAt: new Date(Date.now() + 3_600_000),
  });
  vi.mocked(csrfOk).mockReturnValue(true);
  vi.mocked(rateLimited).mockResolvedValue(false);
  vi.mocked(authorize).mockResolvedValue({ allowed: true, role: "owner" });
  vi.mocked(getZaloOnboardingState).mockResolvedValue({
    status: "active",
    verifiedAt: new Date("2026-10-01T00:00:00Z"),
    lastSetwebhookAt: null,
    webhookToken: "wh-0123456789abcdef",
  });
});

describe("GET /api/onboarding/zalo", () => {
  it("returns state + webhook URL and never a token field or secret", async () => {
    const res = await get();
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(res.status).toBe(200);
    expect(body.data).toMatchObject({
      status: "active",
      webhookUrl: "https://plexco.app/api/webhooks/zalo/wh-0123456789abcdef",
    });
    expect(Object.keys(body.data).sort()).toEqual([
      "lastSetwebhookAt",
      "status",
      "verifiedAt",
      "webhookUrl",
    ]);
  });

  it("requires connector.secret_manage: denied -> 403 and no read", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "grant_required" });
    expect((await get()).status).toBe(403);
    expect(getZaloOnboardingState).not.toHaveBeenCalled();
    expect(authorize).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "connector.secret_manage" }),
    );
  });

  it("no session -> 401", async () => {
    vi.mocked(currentSession).mockResolvedValue(null);
    expect((await get()).status).toBe(401);
  });
});

// L68 A-15 (D6, D10, D15): the REAL logger, no mock of lib/log; its three console sinks are
// captured and silenced. `l68.before` is written inside the gate (authorize), `l68.after` by the
// state read once the tenant is proven.
describe("L68 A-15 — the Zalo state route runs in the request log context", () => {
  const { written, probes } = captureConsoleSinks();

  it("the state read logs the proven tenant and the response's request id; the gate none", async () => {
    vi.mocked(authorize).mockImplementationOnce(async () => {
      log.error("l68.before", {});
      return { allowed: true, role: "owner" };
    });
    const read = vi.mocked(getZaloOnboardingState).getMockImplementation()!;
    vi.mocked(getZaloOnboardingState).mockImplementationOnce(async (...args) => {
      log.error("l68.after", {});
      return read(...args);
    });
    const res = await get();
    expect(res.status).toBe(200);
    const id = res.headers.get("x-request-id");
    expect(probes("l68.after")).toEqual([
      expect.objectContaining({ request_id: id, tenant_id: TENANT }),
    ]);
    expect(probes("l68.before")).toEqual([expect.objectContaining({ request_id: id })]);
    expect(probes("l68.before")[0]).not.toHaveProperty("tenant_id");
  });

  it("the gate's early 403 carries a fresh x-request-id and no line carries a tenant", async () => {
    vi.mocked(authorize).mockResolvedValue({ allowed: false, reason: "grant_required" });
    const res = await get();
    expect(res.status).toBe(403);
    expect(res.headers.get("x-request-id")).toMatch(/^req_[0-9a-f-]{36}$/);
    expect(written()).not.toContain("tenant_id");
  });
});
