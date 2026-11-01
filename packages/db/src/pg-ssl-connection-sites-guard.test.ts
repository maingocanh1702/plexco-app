import { existsSync, readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The connection-site guard of docs/sessions/web-mvp-phase5-readiness-p5-db-tls-ca-options.md (2.5):
// every pg Pool/Client and PgBoss that runtime source builds takes its options from
// pgSslConnectionConfig, so DATABASE_CA_CERT reaches every connection; the rest is a named allowlist.
// The owner CLIs under scripts/ take it through scripts/lib/operator-cli-pg-config.mjs, which calls it
// as a production build (docs/sessions/web-mvp-phase5-readiness-p5-operator-cli-pg-tls-helper.md, 2.5).
// ponytail: a regex scan of the source text, not an AST; a constructor reached through an alias, a
// wrapper or a computed name is not seen. Upgrade to a TypeScript AST walk when a site needs one.

const ROOT = new URL("../../../", import.meta.url);
const DIRS = ["apps/bot/src", "apps/web", "packages/db/src", "scripts"];
const SKIP = new Set(["node_modules", ".next"]);
const SOURCE = /\.[cm]?[jt]sx?$/;
const TEST = /\.(?:test|spec)\.tsx?$/;
const CTOR = /new (?:pg\.Pool|pg\.Client|Pool|Client|PgBoss)\(/g;
const ROUTED = /pgSslConnectionConfig\(|queueOptions\(|operatorCliPgConfig\(/;
// Left in the argument once the helper call is removed: a key of its own that would override the helper.
const OVERRIDE = /\b(?:ssl|connectionString)\b/;
const INSECURE = /rejectUnauthorized\s*:\s*false/;
// [1] a declared name, [2] its initializer up to ";"; all in a lookahead, so a match consumes only the keyword and no text swallows a later declaration.
const DECL = /(?:const|let)(?=\s+([A-Za-z_$][\w$]*)\b[^=]*=([^;]*))/g;

/** The thirteen sites (readiness 2.5: S1-S10, then L90's three owner CLIs), sorted: each file opens exactly one connection through the helper. */
const SITES = [
  "apps/bot/src/outbox-wake.ts",
  "apps/bot/src/preflight.ts",
  "apps/bot/src/projectors/public-sessions.ts",
  "apps/bot/src/projectors/web-realtime.ts",
  "apps/bot/src/projectors/zalo-dm.ts",
  "apps/bot/src/provision-queue.ts",
  "apps/bot/src/queue.ts",
  "apps/bot/src/worker.ts",
  "packages/db/src/client.ts",
  "packages/db/src/migrate.ts",
  "scripts/outbox-dlq-replay.mjs",
  "scripts/outbox-projector-enable.mjs",
  "scripts/public-alias-moderate.mjs",
];
/** [file, constructor ("*" = every one in the file), reason]: the constructors that may skip the helper. */
const ALLOW: [string, string, string][] = [
  ["packages/db/src/test-harness.ts", "*", "test support: the scratch databases the suites run on"],
  [
    "apps/bot/src/provision-queue.ts",
    "new PgBoss(",
    "borrows the S6 client (db.executeSql), opens no connection",
  ],
  [
    "apps/web/e2e/public-share-page-prod.proof.ts",
    "*",
    "a Playwright proof against a scratch database",
  ],
];

const walk = (dir: string): string[] =>
  readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) return SKIP.has(d.name) ? [] : walk(rel);
    return SOURCE.test(d.name) && !TEST.test(d.name) ? [rel] : [];
  });

/** The argument text of the call whose "(" sits at `open`, up to the balancing ")". */
const argText = (src: string, open: number): string => {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(") depth++;
    else if (src[i] === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return src.slice(open + 1);
};

/** A bare identifier argument (S1's `config`) is read through its declaration in the same file. */
const resolve = (src: string, arg: string): string => {
  const id = arg.trim();
  if (!/^[A-Za-z_$][\w$]*$/.test(id)) return arg;
  return [...src.matchAll(DECL)].find((m) => m[1] === id)?.[2] ?? arg;
};

const sources = new Map(DIRS.flatMap(walk).map((f) => [f, readFileSync(new URL(f, ROOT), "utf8")]));
const hits = [...sources].flatMap(([file, src]) =>
  [...src.matchAll(CTOR)].map((m) => {
    const open = (m.index ?? 0) + m[0].length - 1;
    const arg = resolve(src, argText(src, open));
    const rest = arg.replace(/pgSslConnectionConfig\([^()]*\)/g, "");
    return { file, ctor: m[0], routed: ROUTED.test(arg), override: OVERRIDE.test(rest) };
  }),
);
const allows = (h: { file: string; ctor: string }, [file, ctor]: [string, string, string]) =>
  file === h.file && (ctor === "*" || ctor === h.ctor);

describe("pg connection sites: every runtime connection takes pgSslConnectionConfig", () => {
  it("(a) every constructor passes the helper (or queueOptions) and sets no ssl or connectionString of its own, or is on the named allowlist", () => {
    const bare = hits.filter(
      (h) => (!h.routed || h.override) && !ALLOW.some((entry) => allows(h, entry)),
    );
    expect(bare.map((h) => `${h.file} ${h.ctor}`)).toEqual([]);
  });

  it("(b) the scan finds exactly the thirteen sites, and every allowlist entry still matches a constructor", () => {
    expect(
      hits
        .filter((h) => h.routed)
        .map((h) => h.file)
        .sort(),
    ).toEqual(SITES);
    expect(
      ALLOW.filter((entry) => !hits.some((h) => allows(h, entry))).map(([f, c]) => `${f} ${c}`),
    ).toEqual([]);
  });

  it("(c) no non-test source turns certificate verification off", () => {
    expect([...sources].filter(([, src]) => INSECURE.test(src)).map(([file]) => file)).toEqual([]);
  });

  it("(d) every allowlist entry names a file that exists", () => {
    expect(
      ALLOW.filter(([file]) => !existsSync(new URL(file, ROOT))).map(([file]) => file),
    ).toEqual([]);
  });

  it("(e) the owner CLIs' shared module loads the helper itself and calls it as a production build", () => {
    const shared = sources.get("scripts/lib/operator-cli-pg-config.mjs");
    expect(shared).toContain('new URL("../../packages/db/src/pg-ssl-options.ts", import.meta.url)');
    expect(shared).toContain(
      'pgSslConnectionConfig(connectionString, { ...env, NODE_ENV: "production" })',
    );
  });
});
