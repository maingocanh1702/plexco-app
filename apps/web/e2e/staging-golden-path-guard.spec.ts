import { expect, test } from "@playwright/test";
import { REFUSED, stagingGoldenPathOrigin } from "./support/staging-golden-path-guard";

/**
 * The staging golden path's guard (support/staging-golden-path-guard.ts), in the default suite. Pure
 * calls only: no page, no request, no navigation. Every refused class and the accepted shape.
 */
const STAGING = "https://staging.plexco.app";
const OPT_IN = { STAGING_GOLDEN_PATH: "1" };
const at = (base: string) => ({ ...OPT_IN, STAGING_BASE_URL: base });

const refused: [string, Record<string, string | undefined>, string][] = [
  ["the opt-in is missing", { STAGING_BASE_URL: STAGING }, REFUSED.optIn],
  [
    "the opt-in is not 1 (true)",
    { STAGING_GOLDEN_PATH: "true", STAGING_BASE_URL: STAGING },
    REFUSED.optIn,
  ],
  [
    "the opt-in is not 1 (0)",
    { STAGING_GOLDEN_PATH: "0", STAGING_BASE_URL: STAGING },
    REFUSED.optIn,
  ],
  ["STAGING_BASE_URL is missing", { ...OPT_IN }, REFUSED.baseMissing],
  ["STAGING_BASE_URL is empty", at(""), REFUSED.baseMissing],
  ["STAGING_BASE_URL does not parse", at("staging.plexco.app"), REFUSED.baseUnparsable],
  [
    "PRODUCTION_BASE_URL is set but does not parse",
    { ...at(STAGING), PRODUCTION_BASE_URL: "plexco.app" },
    REFUSED.productionUnparsable,
  ],
  ["http", at("http://staging.plexco.app"), REFUSED.notHttps],
  ["a user name in the URL", at("https://owner@staging.plexco.app"), REFUSED.userInfo],
  ["plexco.app", at("https://plexco.app"), REFUSED.productionHost],
  ["www.plexco.app", at("https://www.plexco.app"), REFUSED.productionHost],
  ["another host", at("https://example.com"), REFUSED.notStaging],
  ["a plexco.app subdomain without staging", at("https://app.plexco.app"), REFUSED.notStaging],
  ["a staging label under another domain", at("https://staging.example.com"), REFUSED.notStaging],
  [
    "plexco.app inside another domain",
    at("https://staging.plexco.app.example.com"),
    REFUSED.notStaging,
  ],
  ["a look-alike domain", at("https://staging.notplexco.app"), REFUSED.notStaging],
  ["a trailing dot (an empty label)", at("https://staging.plexco.app."), REFUSED.notStaging],
  ["localhost", at("https://localhost"), REFUSED.loopbackOrIp],
  ["IPv6 loopback", at("https://[::1]"), REFUSED.loopbackOrIp],
  ["IPv4 loopback", at("https://127.0.0.1"), REFUSED.loopbackOrIp],
  ["a private IPv4 literal", at("https://10.0.0.1"), REFUSED.loopbackOrIp],
  ["an IPv6 literal", at("https://[2001:db8::1]"), REFUSED.loopbackOrIp],
  [
    "the origin of PRODUCTION_BASE_URL",
    { ...at(STAGING), PRODUCTION_BASE_URL: STAGING },
    REFUSED.productionOrigin,
  ],
];

for (const [name, env, reason] of refused) {
  test(`staging guard refuses ${name}`, () => {
    expect(() => stagingGoldenPathOrigin(env)).toThrow(`staging golden path refused: ${reason}`);
  });
}

test("staging guard accepts https://staging.plexco.app with the opt-in and returns its origin", () => {
  expect(stagingGoldenPathOrigin(at(STAGING))).toBe(STAGING);
});

test("staging guard returns the bare origin when a path and another production origin are set", () => {
  const env = { ...at(`${STAGING}/c/x?y=1`), PRODUCTION_BASE_URL: "https://plexco.app" };
  expect(stagingGoldenPathOrigin(env)).toBe(STAGING);
});
