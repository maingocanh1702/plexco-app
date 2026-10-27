import { describe, expect, it } from "vitest";
import { ApiClientError, CLIENT_NETWORK_ERROR } from "./api-client";
import { createCommandIdKeeper } from "./use-command-id";
import type { CommandIdScope, UncertainCommandIdStore } from "./uncertain-command-id-session-store";

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

/** An in-memory store that records every call (the real one is covered by its own test file). */
function fakeStore() {
  const records = new Map<string, string>();
  const calls: string[] = [];
  const k = (s: CommandIdScope, fp: string) =>
    JSON.stringify([s.tenantId, s.personId, s.kind, s.targets, fp]);
  const store: UncertainCommandIdStore = {
    find: (s, fp) => {
      calls.push("find");
      return records.get(k(s, fp)) ?? null;
    },
    save: (s, fp, id) => {
      calls.push("save");
      records.set(k(s, fp), id);
    },
    drop: (s, fp) => {
      calls.push("drop");
      records.delete(k(s, fp));
    },
  };
  return { store, records, calls };
}
/** A keeper over `store` whose keys are `${name}1`, `${name}2`, ... (a second mount gets another name). */
function persistentKeeper(store: UncertainCommandIdStore, name = "k") {
  let n = 0;
  return createCommandIdKeeper(() => `${name}${++n}`, store);
}
const paid: CommandIdScope = { tenantId: "t1", personId: "p1", kind: "mark-paid", targets: ["s1"] };
const body = '{"method":"cash","items":[{"playerId":"a","amount":50000}],"note":""}';
const conflict = new ApiClientError("COMMAND_ID_CONFLICT", "", 409, "req");

describe("createCommandIdKeeper with a store (L49 D3)", () => {
  it("an uncertain key is restored for the identical payload + scope after a remount, and stays sticky", () => {
    const { store } = fakeStore();
    const first = persistentKeeper(store, "a");
    const id = first.get(body, paid);
    first.settle(network);
    // A reload: a new keeper (a new mount) over the same store.
    const second = persistentKeeper(store, "b");
    expect(second.get(body, { ...paid, targets: ["s1"] })).toBe(id);
    // Sticky: a definite 4xx from the entry gate proves nothing about the earlier attempt.
    second.settle(rateLimited);
    expect(second.get(body, paid)).toBe(id);
    second.settle(forbidden);
    expect(persistentKeeper(store, "c").get(body, paid)).toBe(id);
  });

  it("a fresh but equal scope object is the same entry; another target or person is another command", () => {
    const { store } = fakeStore();
    const k = persistentKeeper(store);
    const id = k.get(body, paid);
    expect(k.get(body, { ...paid, targets: [...paid.targets] })).toBe(id);
    expect(k.get(body, { ...paid, targets: ["s2"] })).not.toBe(id);
    expect(k.get(body, { ...paid, personId: "p2" })).not.toBe(id);
  });

  it("a changed payload mints a NEW key and leaves the old record untouched", () => {
    const { store, records } = fakeStore();
    const k = persistentKeeper(store, "a");
    const id = k.get(body, paid);
    k.settle(serverError);
    const edited = k.get('{"method":"transfer"}', paid);
    expect(edited).not.toBe(id);
    expect(records.size).toBe(1);
    expect(persistentKeeper(store, "b").get(body, paid)).toBe(id);
  });

  it("reset() clears memory only: the record survives a dialog Cancel and get restores the same key", () => {
    const { store, records } = fakeStore();
    const k = persistentKeeper(store, "a");
    const id = k.get(body, paid);
    k.settle(network);
    k.reset();
    expect(records.size).toBe(1);
    expect(k.get(body, paid)).toBe(id);
    expect(persistentKeeper(store, "b").get(body, paid)).toBe(id);
  });

  it("COMMAND_ID_CONFLICT drops the record and the entry even when sticky; the next get mints", () => {
    const { store, records } = fakeStore();
    const k = persistentKeeper(store, "a");
    const id = k.get(body, paid);
    k.settle(network);
    k.settle(conflict);
    expect(records.size).toBe(0);
    expect(k.get(body, paid)).not.toBe(id);
    // The same for a key restored from the store (sticky from the start).
    k.settle(network);
    const restoredKeeper = persistentKeeper(store, "b");
    const restored = restoredKeeper.get(body, paid);
    restoredKeeper.settle(conflict);
    expect(records.size).toBe(0);
    expect(restoredKeeper.get(body, paid)).not.toBe(restored);
  });

  it("success drops the record and the entry", () => {
    const { store, records } = fakeStore();
    const k = persistentKeeper(store, "a");
    const id = k.get(body, paid);
    k.settle(network);
    expect(k.get(body, paid)).toBe(id);
    k.settle();
    expect(records.size).toBe(0);
    expect(k.get(body, paid)).not.toBe(id);
    expect(persistentKeeper(store, "b").get(body, paid)).toBe("b1");
  });

  it("a definite failure on a non-sticky entry drops memory and writes no record", () => {
    const { store, records, calls } = fakeStore();
    const k = persistentKeeper(store);
    const id = k.get(body, paid);
    k.settle(definite);
    expect(calls).not.toContain("save");
    expect(records.size).toBe(0);
    expect(k.get(body, paid)).not.toBe(id);
  });

  it("get() without a payload or without a scope never reads or writes the store", () => {
    const { store, calls } = fakeStore();
    const noPayload = persistentKeeper(store);
    const id = noPayload.get(undefined, paid);
    noPayload.settle(network);
    expect(noPayload.get(undefined, paid)).toBe(id);
    noPayload.settle(conflict);
    noPayload.get(undefined, paid);
    noPayload.settle();
    const noScope = persistentKeeper(store);
    const other = noScope.get(body);
    noScope.settle(network);
    expect(noScope.get(body)).toBe(other);
    noScope.reset();
    noScope.get(body);
    noScope.settle(definite);
    expect(calls).toEqual([]);
  });
});
