import { describe, expect, it, vi } from "vitest";
import { DRAFT_EXPIRY_BATCH_LIMIT, outboxCronHandler, runDraftExpiry } from "./draft-expiry-job.js";
import type { Queryable } from "./projector-registry.js";

function fakeDb(rows: unknown[]) {
  const query = vi.fn(async () => ({ rows }));
  return { db: { query } as unknown as Queryable, query };
}

describe("runDraftExpiry (D-15/D-16, A28)", () => {
  it("calls job_expire_stale_drafts once with the batch limit 25 and logs only the two counts", async () => {
    const { db, query } = fakeDb([{ cancelled: 2, anomalies: 1 }]);
    const log = vi.fn();
    await expect(runDraftExpiry(db, log)).resolves.toEqual({ cancelled: 2, anomalies: 1 });
    expect(DRAFT_EXPIRY_BATCH_LIMIT).toBe(25);
    expect(query).toHaveBeenCalledExactlyOnceWith(
      "SELECT * FROM job_expire_stale_drafts($1)",
      [25],
    );
    expect(log.mock.calls).toEqual([["[worker] draft expiry: cancelled=2 anomalies=1"]]);
  });

  it("reads a missing result row as zero counts", async () => {
    const { db } = fakeDb([]);
    await expect(runDraftExpiry(db, () => {})).resolves.toEqual({ cancelled: 0, anomalies: 0 });
  });
});

describe("outboxCronHandler (D-16, A28)", () => {
  it("drains first, then runs exactly one expiry pass per cron tick", async () => {
    const order: string[] = [];
    const handler = outboxCronHandler({
      drain: async () => void order.push("drain"),
      expire: async () => void order.push("expire"),
    });
    await handler();
    expect(order).toEqual(["drain", "expire"]);
  });

  it("contains an expiry failure: one log line with the SQLSTATE, and the tick still resolves", async () => {
    const log = vi.fn();
    const failure = Object.assign(new Error("deadlock detected"), { code: "40P01" });
    const handler = outboxCronHandler({
      drain: async () => {},
      expire: async () => {
        throw failure;
      },
      log,
    });
    await expect(handler()).resolves.toBeUndefined();
    expect(log.mock.calls).toEqual([["[worker] draft expiry failed: 40P01 deadlock detected"]]);
  });
});
