import { describe, expect, it, vi } from "vitest";
import { stateFromLinkResponse, submitLinkCode } from "./me-link-client";

const json = (status: number, body: unknown) => Response.json(body, { status });
const session = () => json(200, { data: { csrfToken: "csrf-1" }, error: null });
const input = { code: "ABCD-EFGH-JKMNP", commandId: "cmd-1" };

describe("stateFromLinkResponse", () => {
  it.each([
    [200, { data: { outcome: "linked" } }, "linked", false],
    [200, { data: { outcome: "already_linked" } }, "already_linked", false],
    [200, { data: { outcome: "weird" } }, "error", false],
    [409, { error: { code: "MERGE_REQUIRES_REVIEW" } }, "requires_review", false],
    [400, { error: { code: "LINK_CODE_INVALID" } }, "invalid", false],
    [400, { error: { code: "INVALID_BODY" } }, "invalid", false],
    [429, { error: { code: "LINK_CODE_RATE_LIMITED" } }, "rate_limited", false],
    [401, { error: { code: "AUTH_REQUIRED" } }, "signed_out", false],
    [403, { error: { code: "CSRF_INVALID" } }, "error", false],
    [503, { error: { code: "LINK_UNAVAILABLE" } }, "unavailable", true],
    [500, null, "unavailable", true],
  ] as const)("%i %j -> %s (keep commandId: %s)", (status, body, state, keep) => {
    expect(stateFromLinkResponse(status, body)).toEqual({ state, keepCommandId: keep });
  });
});

describe("submitLinkCode", () => {
  it("fetches the CSRF secret then posts only code + commandId with it", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(json(200, { data: { outcome: "linked" }, error: null }));
    const out = await submitLinkCode(input, fetchImpl as unknown as typeof fetch);
    expect(out).toEqual({ state: "linked", keepCommandId: false });
    const [url, init] = fetchImpl.mock.calls[1]! as [string, RequestInit];
    expect(url).toBe("/api/me/link");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-1");
    expect(JSON.parse(String(init.body))).toEqual({ code: input.code, commandId: "cmd-1" });
  });

  it("network failure is offline and KEEPS the commandId (uncertain outcome)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await submitLinkCode(input, fetchImpl as unknown as typeof fetch)).toEqual({
      state: "offline",
      keepCommandId: true,
    });
  });

  it("a signed-out session never reaches the link endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(401, { error: { code: "AUTH_REQUIRED" } }));
    expect((await submitLinkCode(input, fetchImpl as unknown as typeof fetch)).state).toBe(
      "signed_out",
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a definite 4xx drops the commandId; a 5xx keeps it", async () => {
    const run = async (status: number) =>
      submitLinkCode(
        input,
        vi
          .fn()
          .mockResolvedValueOnce(session())
          .mockResolvedValueOnce(json(status, {})) as unknown as typeof fetch,
      );
    expect((await run(400)).keepCommandId).toBe(false);
    expect((await run(502)).keepCommandId).toBe(true);
  });

  it("a non-JSON body from the link endpoint degrades to the generic state, not a throw", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValueOnce(new Response("<html>", { status: 400 }));
    expect((await submitLinkCode(input, fetchImpl as unknown as typeof fetch)).state).toBe("error");
  });
});
