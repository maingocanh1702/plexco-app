import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApiClientError, CLIENT_NETWORK_ERROR } from "./api-client";
import {
  createUncertainCommandIdSessionStore,
  type CommandIdScope,
} from "./uncertain-command-id-session-store";
import { useRosterCommand } from "./use-roster-command";

const TTL_MS = 86_400_000;
const PREFIX = "plx-cmd:v1:";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  };
}

/** Private mode / a locked-down browser: every method and the length getter throw. */
function throwingStorage(): Storage {
  const boom = (): never => {
    throw new Error("SecurityError");
  };
  return {
    get length(): number {
      return boom();
    },
    key: boom,
    getItem: boom,
    setItem: boom,
    removeItem: boom,
    clear: boom,
  };
}

/** A fake clock the test moves by hand. */
function clock(start = 1_000_000) {
  const c = { t: start, now: () => c.t };
  return c;
}

const scope: CommandIdScope = {
  tenantId: "t1",
  personId: "p1",
  kind: "mark-paid",
  targets: ["s1"],
};
const fp = JSON.stringify({
  method: "cash",
  items: [{ playerId: "a", amount: 50000 }],
  note: "Hoa",
});

function setup() {
  const storage = fakeStorage();
  const c = clock();
  return { storage, c, store: createUncertainCommandIdSessionStore({ storage, now: c.now }) };
}

describe("createUncertainCommandIdSessionStore (L49 D1/D2)", () => {
  it("round trip: save then find returns the id, also from a second store over the same storage", () => {
    const { storage, c, store } = setup();
    store.save(scope, fp, "id-1");
    expect(store.find(scope, fp)).toBe("id-1");
    expect(store.find({ ...scope, targets: ["s1"] }, fp)).toBe("id-1"); // an equal scope, new object
    const again = createUncertainCommandIdSessionStore({ storage, now: c.now });
    expect(again.find(scope, fp)).toBe("id-1");
    store.drop(scope, fp);
    expect(store.find(scope, fp)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("isolation: another tenant, person, kind, targets or fingerprint never restores the record", () => {
    const { store } = setup();
    store.save(scope, fp, "id-1");
    expect(store.find({ ...scope, tenantId: "t2" }, fp)).toBeNull();
    expect(store.find({ ...scope, personId: "p2" }, fp)).toBeNull();
    expect(store.find({ ...scope, kind: "reverse" }, fp)).toBeNull();
    expect(store.find({ ...scope, targets: ["s2"] }, fp)).toBeNull();
    expect(store.find({ ...scope, targets: ["s1", "x"] }, fp)).toBeNull();
    expect(store.find(scope, `${fp} `)).toBeNull();
    expect(store.find(scope, fp)).toBe("id-1");
  });

  it("a record lives exactly 24 h: at the TTL it is found, one ms later it is null and removed", () => {
    const { storage, c, store } = setup();
    store.save(scope, fp, "id-1");
    c.t += TTL_MS;
    expect(store.find(scope, fp)).toBe("id-1");
    c.t += 1;
    expect(store.find(scope, fp)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("a record whose `at` is in the future (clock moved back) is null and removed", () => {
    const { storage, c, store } = setup();
    store.save(scope, fp, "id-1");
    c.t -= 1;
    expect(store.find(scope, fp)).toBeNull();
    expect(storage.length).toBe(0);
  });

  it("a malformed value (bad JSON, empty id, non-number or non-finite at) is null and removed", () => {
    const malformed = [
      "not json",
      "null",
      "[]",
      '{"id":"","at":1000000}',
      '{"id":"x","at":"1"}',
      '{"id":"x","at":1e999}', // JSON.parse -> Infinity
    ];
    for (const bad of malformed) {
      const { storage, store } = setup();
      store.save(scope, fp, "id-1");
      const key = storage.key(0) as string;
      storage.setItem(key, bad);
      expect(store.find(scope, fp)).toBeNull();
      expect(storage.getItem(key)).toBeNull();
    }
  });

  it("save prunes expired records under the prefix and leaves other keys alone", () => {
    const { storage, c, store } = setup();
    storage.setItem("plx-sessions:v1:t1:upcoming", "{}");
    store.save(scope, fp, "id-old");
    c.t += TTL_MS + 1;
    store.save({ ...scope, kind: "add" }, "Hoa", "id-new");
    expect(storage.length).toBe(2);
    expect(storage.getItem("plx-sessions:v1:t1:upcoming")).toBe("{}");
    expect(store.find({ ...scope, kind: "add" }, "Hoa")).toBe("id-new");
  });

  it("cap: the 51st save removes the oldest, never more than 50 under the prefix", () => {
    const { storage, c, store } = setup();
    storage.setItem("unrelated", "kept");
    const nth = (n: number) => ({ ...scope, targets: [`s${n}`] });
    for (let n = 1; n <= 50; n += 1) {
      store.save(nth(n), fp, `id-${n}`);
      c.t += 1;
    }
    store.save(nth(51), fp, "id-51");
    const ours = () =>
      [...Array(storage.length).keys()].filter((i) => storage.key(i)?.startsWith(PREFIX));
    expect(ours()).toHaveLength(50);
    expect(store.find(nth(1), fp)).toBeNull();
    expect(store.find(nth(2), fp)).toBe("id-2");
    expect(store.find(nth(51), fp)).toBe("id-51");
    expect(storage.getItem("unrelated")).toBe("kept");
    // Re-saving a record already held overwrites it: nothing else is evicted.
    c.t += 1;
    store.save(nth(51), fp, "id-51");
    expect(ours()).toHaveLength(50);
    expect(store.find(nth(2), fp)).toBe("id-2");
  });

  it("no storage (server render) and a throwing storage: no throw, find null, save and drop no-ops", () => {
    for (const storage of [null, throwingStorage()]) {
      const store = createUncertainCommandIdSessionStore({ storage });
      expect(() => store.save(scope, fp, "id-1")).not.toThrow();
      expect(store.find(scope, fp)).toBeNull();
      expect(() => store.drop(scope, fp)).not.toThrow();
    }
  });

  it("the value is exactly {id, at}; the key holds opaque ids and the hash, never the fingerprint text", () => {
    const { storage, c, store } = setup();
    const reverse: CommandIdScope = { ...scope, kind: "reverse", targets: ["s1", "alloc-9"] };
    const reason = "Nhập nhầm số tiền của Hoa";
    store.save(reverse, reason, "id-1");
    const key = storage.key(0) as string;
    expect(storage.getItem(key)).toBe(JSON.stringify({ id: "id-1", at: c.t }));
    expect(Object.keys(JSON.parse(storage.getItem(key) as string))).toEqual(["id", "at"]);
    expect(key).toMatch(/^plx-cmd:v1:t1:p1:reverse:s1,alloc-9:[0-9a-z]+$/);
    expect(key).not.toContain(reason);
    expect(key).not.toContain("Hoa");

    store.save(scope, fp, "id-2");
    const paidKey = [...Array(storage.length).keys()]
      .map((i) => storage.key(i) as string)
      .find((k) => k.includes(":mark-paid:")) as string;
    for (const field of ["method", "cash", "items", "amount", "50000", "note", "Hoa"]) {
      expect(paidKey).not.toContain(field);
    }
  });

  it("rows 16 and 11: the default store writes sessionStorage only; with no signed-in person an uncertain run saves nothing", async () => {
    let run!: ReturnType<typeof useRosterCommand>["run"];
    // no SessionProvider = no person; a setState after a server render is a no-op
    renderToStaticMarkup(createElement(() => ((run = useRosterCommand().run), null)));
    const session = fakeStorage();
    const local = fakeStorage();
    vi.stubGlobal("window", { sessionStorage: session, localStorage: local });
    try {
      // control: the stub reaches the default resolver (so the row 16 check is not vacuous)
      createUncertainCommandIdSessionStore().save(scope, fp, "probe");
      expect([session.length, local.length]).toEqual([1, 0]); // row 11: never localStorage
      session.clear();
      const intent = { tenantId: "t1", kind: "add" as const, targets: ["s1"], fingerprint: "Bình" };
      await run(() => Promise.reject(new ApiClientError(CLIENT_NETWORK_ERROR, "", 0)), intent);
      expect(session.length).toBe(0); // row 16: no person = no safe key, memory only
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
