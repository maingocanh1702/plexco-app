import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listActiveSports } from "./sports-read.js";
import { setupRlsTestContext, type RlsTestContext } from "./test-harness.js";

/** Sports picker read model: runs as the runtime `app` role (proves its SELECT grant is enough). */

let ctx: RlsTestContext;
beforeAll(async () => {
  ctx = await setupRlsTestContext("plexco_sports_read");
}, 120_000);
afterAll(async () => {
  await ctx?.teardown();
});

describe("listActiveSports", () => {
  it("returns the seeded active sports as {id,key,name}, name-ordered, via the app role", async () => {
    const list = await listActiveSports(ctx.appDb.db);
    expect(list.length).toBeGreaterThanOrEqual(6);
    expect(list.find((s) => s.key === "badminton")).toEqual({
      id: ctx.badmintonSportId,
      key: "badminton",
      name: expect.any(String),
    });
    expect(Object.keys(list[0]!).sort()).toEqual(["id", "key", "name"]);
  });

  it("never returns an inactive sport", async () => {
    const { rows } = await ctx.owner.query<{ id: string }>(
      `INSERT INTO sports (key, name, active) VALUES ('retired-sport', 'Retired', false) RETURNING id`,
    );
    const list = await listActiveSports(ctx.appDb.db);
    expect(list.some((s) => s.id === rows[0]!.id)).toBe(false);
    expect(list.some((s) => s.key === "retired-sport")).toBe(false);
  });
});
