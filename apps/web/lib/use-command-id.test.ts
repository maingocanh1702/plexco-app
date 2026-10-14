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
});
