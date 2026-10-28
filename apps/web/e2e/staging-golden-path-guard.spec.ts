import { expect, test } from "@playwright/test";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import {
  REFUSED,
  SESSION_POLL_NO_RESPONSE,
  signedInPersonId,
  stagingGoldenPathOrigin,
} from "./support/staging-golden-path-guard";

/**
 * The staging golden path's guard (support/staging-golden-path-guard.ts), in the default suite: pure
 * calls (no page, no request, no navigation) for every refused class and the accepted shape. The last
 * test forces the sign-in poll's failure on a closed local port: no server, no page, no navigation.
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

/** A local port that was free a moment ago and is closed now: a request to it gets no response. */
async function closedPort(): Promise<number> {
  const server = createServer().listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, "close");
  return port;
}

/** Passes every write through and keeps a copy of its chunk; returns the undo. */
function keepWrites(stream: NodeJS.WriteStream, chunks: string[]): () => void {
  const write = stream.write;
  stream.write = (chunk: unknown, ...rest: unknown[]) => {
    chunks.push(String(chunk));
    return Reflect.apply(write, stream, [chunk, ...rest]);
  };
  return () => {
    stream.write = write;
  };
}

test("a failed session poll prints no cookie, header or session token", async ({ browser }) => {
  // the list reporter prints a failed test's error and the worker's stdout/stderr, and the runbook
  // (docs/runbooks/local-mvp-smoke.md section 12) tells the owner to keep that output
  const base = `http://127.0.0.1:${await closedPort()}`;
  const token = `poll-probe-${Date.now()}`;
  const context = await browser.newContext({ baseURL: base });
  try {
    await context.addCookies([{ name: "plx_session", value: token, url: base }]);
    // control: Playwright's own error quotes the cookie header, so the check below can see a leak
    const control = await context.request.get("/api/auth/session").catch((e: unknown) => e);
    expect(control).toBeInstanceOf(Error);
    expect(String((control as Error).stack ?? control)).toContain(token);

    const chunks: string[] = [];
    const undo = [keepWrites(process.stdout, chunks), keepWrites(process.stderr, chunks)];
    let failure: unknown;
    try {
      failure = await signedInPersonId(context.request).catch((e: unknown) => e);
    } finally {
      for (const restore of undo) restore();
    }
    expect(failure).toBeInstanceOf(Error);
    const error = failure as Error;
    expect(error.message).toBe(SESSION_POLL_NO_RESPONSE);
    const seen = [error.message, error.stack, String(error.cause), ...chunks]
      .join("\n")
      .toLowerCase();
    for (const word of ["cookie", "authorization", token.toLowerCase()]) {
      expect(seen).not.toContain(word);
    }
  } finally {
    await context.close();
  }
});
