import { describe, expect, it } from "vitest";
import { createQueue, queueOptions, QUEUE_SCHEMA } from "./queue.js";

describe("queueOptions", () => {
  it("disables runtime migrations — app_worker has no DDL privileges", () => {
    const opts = queueOptions("postgres://user:pass@localhost:5432/db");
    expect(opts.migrate).toBe(false);
    expect(opts.schema).toBe(QUEUE_SCHEMA);
  });

  it("rejects a missing connection string (fail-fast, no silent default)", () => {
    expect(() => queueOptions("")).toThrow(/DATABASE_URL_DIRECT/);
  });
});

describe("createQueue", () => {
  it("constructs a pg-boss instance without connecting", () => {
    const boss = createQueue("postgres://user:pass@localhost:5432/db");
    expect(boss).toBeDefined();
    expect(typeof boss.start).toBe("function");
  });
});
