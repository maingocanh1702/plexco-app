import { describe, expect, it } from "vitest";
import { createQueue } from "./queue.js";

describe("createQueue", () => {
  it("constructs a pg-boss instance without connecting", () => {
    const boss = createQueue("postgres://user:pass@localhost:5432/db");
    expect(boss).toBeDefined();
    expect(typeof boss.start).toBe("function");
  });

  it("rejects a missing connection string (fail-fast, no silent default)", () => {
    expect(() => createQueue("")).toThrow(/DATABASE_URL_DIRECT/);
  });
});
