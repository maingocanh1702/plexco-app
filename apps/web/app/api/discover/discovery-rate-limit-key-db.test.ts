import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  setupRlsTestContext,
  type RlsTestContext,
} from "../../../../../packages/db/src/test-harness.js";
import { discoveryRateLimitKey } from "../../../lib/discovery-route-support";
import type { TrustedIngressProvider } from "../../../lib/session-cookies";

/**
 * The key-form contract test (L73), against a REAL database (DATABASE_URL_TEST) on the discovery
 * pool's `readonly` role: every form drs `discoveryRateLimitKey` builds (discovery-route-support.ts,
 * the whole key expression of discoveryRateLimited) is accepted by discovery_rate_limit_hit, whose
 * step 0 (0075:82-85) admits only the bare forms and RAISEs 22023 on any other. It exists so the
 * web's key form and the definer's check cannot drift apart again: a `discover:` prefix once made
 * every real call 22023, so discovery answered 503 everywhere while the keyed unit fakes stayed green.
 */
let ctx: RlsTestContext;

beforeAll(async () => {
  ctx = await setupRlsTestContext(`plexco_discovery_key_db_${process.pid}`);
}, 120_000);

afterAll(async () => {
  await ctx?.teardown();
}, 120_000);

// The web's own statement (discoveryRateLimited); 0 = admitted.
const hit = async (key: string) =>
  (
    await ctx.readonlyPool.query<{ discovery_rate_limit_hit: number }>(
      "SELECT discovery_rate_limit_hit($1)",
      [key],
    )
  ).rows[0]?.discovery_rate_limit_hit;

async function expectAdmitted(
  provider: TrustedIngressProvider,
  headers: Record<string, string>,
  expected: string,
) {
  const request = new Request("http://localhost/api/discover", { headers });
  const key = discoveryRateLimitKey(request, provider);
  expect(key).toBe(expected);
  expect(await hit(key)).toBe(0);
}

describe("L73 key form: discoveryRateLimitKey against discovery_rate_limit_hit (0075:82-85)", () => {
  it("an IPv4 client is its address", () =>
    expectAdmitted("digitalocean", { "do-connecting-ip": "203.0.113.7" }, "203.0.113.7"));

  it("an IPv6 client is its /64", () =>
    expectAdmitted("fly", { "fly-client-ip": "2001:db8:1:2::abcd" }, "2001:0db8:0001:0002"));

  it("an IPv4-mapped client is its IPv4 address", () =>
    expectAdmitted("fly", { "fly-client-ip": "::ffff:198.51.100.9" }, "198.51.100.9"));

  // The same key as the case above, counted a second time: still below 60, still 0.
  it("the hex spelling of an IPv4-mapped client is the same IPv4 address", () =>
    expectAdmitted("fly", { "fly-client-ip": "::ffff:c633:6409" }, "198.51.100.9"));

  it("digitalocean without its header is digitalocean:untrusted", () =>
    expectAdmitted("digitalocean", {}, "digitalocean:untrusted"));

  it("fly without its header is fly:untrusted", () => expectAdmitted("fly", {}, "fly:untrusted"));

  it("direct is local", () => expectAdmitted("direct", {}, "local"));

  it("the old prefixed form discover:<ip> is refused with 22023 (the bug class this file pins)", async () => {
    await expect(hit("discover:203.0.113.7")).rejects.toMatchObject({ code: "22023" });
  });
});
