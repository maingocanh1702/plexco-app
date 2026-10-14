import { describe, expect, it } from "vitest";
import { ApiClientError, CLIENT_NETWORK_ERROR } from "./api-client";
import { createCommandIdKeeper } from "./use-command-id";

/** Deterministic keys: k1, k2, ... */
function keeper() {
  let n = 0;
  return createCommandIdKeeper(() => `k${++n}`);
}
const network = new ApiClientError(CLIENT_NETWORK_ERROR, "", 0);
const serverError = new ApiClientError("SOMETHING_NEW", "", 503, "req");
const definite = new ApiClientError("INVALID_BODY", "", 400, "req");
const rateLimited = new ApiClientError("RATE_LIMITED", "", 429, "req");
const forbidden = new ApiClientError("FORBIDDEN", "", 403, "req");

describe("createCommandIdKeeper (DD-117 D5 + payload binding)", () => {
  it("an identical retry after an uncertain failure replays the same key", () => {
    const k = keeper();
    const first = k.get('{"name":"A"}');
    k.settle(network);
    expect(k.get('{"name":"A"}')).toBe(first);
    k.settle(serverError);
    expect(k.get('{"name":"A"}')).toBe(first);
  });

  it("a changed payload after an uncertain failure is a NEW command (the edit is not replayed away)", () => {
    const k = keeper();
    const first = k.get('{"name":"A"}');
    k.settle(serverError);
    const edited = k.get('{"name":"B"}');
    expect(edited).not.toBe(first);
    // ...and an identical retry of the edit keeps the edit's key.
    k.settle(network);
    expect(k.get('{"name":"B"}')).toBe(edited);
  });

  it("success and a definite 4xx drop the key, even for the same payload", () => {
    const k = keeper();
    const first = k.get("p");
    k.settle();
    const second = k.get("p");
    expect(second).not.toBe(first);
    k.settle(definite);
    expect(k.get("p")).not.toBe(second);
  });

  it("no-payload callers (secret bodies) keep the key until settle or reset", () => {
    const k = keeper();
    const first = k.get();
    k.settle(network);
    expect(k.get()).toBe(first);
    k.reset();
    expect(k.get()).not.toBe(first);
  });

  it("once an attempt was uncertain, a later 4xx (rate limit, any gate refusal) KEEPS the key", () => {
    // Uncertain (the first connect may have committed), then a 429 from the entry gate, which runs
    // before the replay lookup: the next identical retry must still replay, never connect again.
    const k = keeper();
    const first = k.get('{"name":"A"}');
    k.settle(serverError);
    expect(k.get('{"name":"A"}')).toBe(first);
    k.settle(rateLimited);
    expect(k.get('{"name":"A"}')).toBe(first);
    k.settle(definite);
    expect(k.get('{"name":"A"}')).toBe(first);
    // Only a 2xx ends it.
    k.settle();
    expect(k.get('{"name":"A"}')).not.toBe(first);
  });

  it("the same sticky rule for no-payload callers: uncertain, then 403/429, keeps the key until 2xx or reset", () => {
    const k = keeper();
    const first = k.get();
    k.settle(network);
    k.settle(rateLimited);
    expect(k.get()).toBe(first);
    k.settle(forbidden);
    expect(k.get()).toBe(first);
    k.reset();
    const fresh = k.get();
    expect(fresh).not.toBe(first);
    // A reset clears the uncertainty too: a definite failure of the new command drops its key.
    k.settle(rateLimited);
    expect(k.get()).not.toBe(fresh);
  });

  it("uncertainty belongs to one payload: an edit is a new command and a 4xx drops ITS key", () => {
    const k = keeper();
    k.get("p1");
    k.settle(network);
    const edited = k.get("p2");
    k.settle(rateLimited);
    expect(k.get("p2")).not.toBe(edited);
  });

  it("a 4xx with no uncertain attempt before it still drops the key (#53 useRosterCommand's rule)", () => {
    const k = keeper();
    const first = k.get();
    k.settle(rateLimited);
    expect(k.get()).not.toBe(first);
  });

  it("settling after a reset during the attempt is a no-op (the next attempt is a new command)", () => {
    const k = keeper();
    const first = k.get();
    k.reset();
    k.settle(network);
    expect(k.get()).not.toBe(first);
  });
});
