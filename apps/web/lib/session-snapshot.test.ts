import { describe, expect, it } from "vitest";
import { clearSessionSnapshots, loadSnapshot, saveSnapshot } from "./session-snapshot";
import type { SessionListItemDto } from "./sessions-api";

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
const rows = [{ id: "s1" }] as SessionListItemDto[];

describe("session snapshot", () => {
  it("round-trips per tenant and tab, never across tenants", () => {
    const s = fakeStorage();
    saveSnapshot("t1", "all", rows, s);
    expect(loadSnapshot("t1", "all", s)?.sessions).toEqual(rows);
    expect(loadSnapshot("t2", "all", s)).toBeNull();
    expect(loadSnapshot("t1", "draft", s)).toBeNull();
  });
  it("clear removes only snapshot keys", () => {
    const s = fakeStorage();
    s.setItem("plx-lang", "en");
    saveSnapshot("t1", "all", rows, s);
    saveSnapshot("t1", "draft", rows, s);
    clearSessionSnapshots(s);
    expect(loadSnapshot("t1", "all", s)).toBeNull();
    expect(s.getItem("plx-lang")).toBe("en");
  });
  it("treats corrupt data and missing storage as no snapshot", () => {
    const s = fakeStorage();
    s.setItem("plx-snap:sessions:t1:all", "{not json");
    expect(loadSnapshot("t1", "all", s)).toBeNull();
    expect(loadSnapshot("t1", "all", null)).toBeNull();
    expect(() => saveSnapshot("t1", "all", rows, null)).not.toThrow();
  });
});
