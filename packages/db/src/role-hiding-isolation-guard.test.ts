/**
 * L32 guard (readiness DF4; threat-model rows 3 and 6). Roles and role memberships are cluster-global
 * while the test files run in parallel, each on its own database, so only the isolated files of
 * vitest.config.ts may rename, drop, create or alter a shared role, change a shared-role membership
 * or call the harness's membership mutators; and the config must still run every package test file.
 * It defends against drift written in good faith (a new parallel test that hides a role, a dropped
 * project or exclude), not against a deliberately obfuscated statement. A pure fs scan, no database.
 */
import { readdirSync, readFileSync } from "node:fs";
import { configDefaults } from "vitest/config";
import { describe, expect, it } from "vitest";
import config, { isolatedTestFiles } from "../vitest.config.js";

const ROOT = new URL("../../../", import.meta.url);
const SKIP = new Set(["node_modules", "dist", ".next"]);
/** vitest's default include pattern. */
const VITEST_DEFAULT = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
/** The test helpers named in step 0: both test-harness.ts files, apps/bot's test-db.ts, roster-money-fixtures.ts. */
const HELPER = /(?:harness|test-db|fixtures)\.tsx?$/;
/** Strings and template literals (kept) and comments (blanked, newlines kept). */
const STRIP =
  /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
/** A membership keyword (group 1) or a role statement (group 2), then its region up to a semicolon or a backtick. */
const STATEMENT = /\b(?:(GRANT|REVOKE)|(ALTER|CREATE|DROP)\s+(?:ROLE|USER|GROUP))\b([^;\x60]*)/gi;
/** A role list, then TO or FROM: an object grant's ON breaks the list, so object grants stay out (row OBJ). */
const MEMBERSHIP =
  /^\s+(?:(?:ADMIN|INHERIT|SET)\s+OPTION\s+FOR\s+)?(?:"[^"]*"|\$\{[^}]*\}|%[\d$*-]*[isl]|[\w$]+)(?:\s*,\s*(?:"[^"]*"|\$\{[^}]*\}|%[\d$*-]*[isl]|[\w$]+))*\s+(?:TO|FROM)\b/i;
/** Row DL: the per-database setting form, keyed by the file's own database. */
const DATABASE_SETTING = /^\s+(?:"[^"]*"|\$\{[^}]*\}|%[\d$*-]*[isl]|[\w$]+)\s+IN\s+DATABASE\b/i;
/** A shared role: any definer (job, chat, identity, a future one), app, app_worker, app_user, readonly, plexco, or ALL roles. */
const SHARED = /(?<![\w$])(?:\w+_definer|app_worker|app_user|app|readonly|plexco|all)(?![\w$])/i;
/** A name the scan cannot read, so it fails closed: an interpolation, a format() specifier, a concatenation, the session's own role, or no name inside the literal. */
const DYNAMIC =
  /\$\{|%[\d$*-]*[isl]|["'\x60]\s*(?:\+|\|\|)|\b(?:current_user|session_user|current_role)\b|^\s*$/i;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
/** The harness's exported membership mutators (T1: the owner hand-off; W9: the definer-membership helpers),
 * names split so this file holds no reference, each with its pinned reference count in test-harness.ts. */
const MUTATORS = new Map([
  ["setupNonSuperuser" + "OwnerContext", 1],
  ["revokeStaleChatDefiner" + "Membership", 3],
  ["revokeStaleDefiner" + "Membership", 3],
  ["restoreChatDefiner" + "Membership", 2],
  ["restoreDefiner" + "Membership", 3],
  ["ensureChatDefiner" + "MembershipRevoked", 2],
  ["ensureDefiner" + "MembershipRevoked", 3],
  ["revokeAllChatDefiner" + "Members", 1],
]);

const HARNESS = "packages/db/src/test-harness.ts";
const HARNESS_TEST = "packages/db/src/test-harness.test.ts";
/** Hits allowed outside the isolated files: [file, hit, exact count]; a new copy fails until it is reviewed. */
const PINS: [string, string, number][] = [
  // PL: the harness's permanent password lease of the shared runtime roles (:162, :183).
  [HARNESS, `\${client.escapeIdentifier(role)} WITH LOGIN PASSWORD \${password}`, 1],
  [HARNESS, `\${client.escapeIdentifier(role)} WITH \${login}PASSWORD \${password}`, 1],
  // W9: the definer-membership helpers that migrate.test.ts calls (:384, :417, :451).
  [HARNESS, `\${client.escapeIdentifier(definer)} FROM \${client.escapeIdentifier(rolname)}`, 1],
  [HARNESS, `\${client.escapeIdentifier(definer)} TO \${client.escapeIdentifier(rolname)}`, 1],
  [HARNESS, `\${client.escapeIdentifier(definer)} FROM \${client.escapeIdentifier(roleName)}`, 1],
  // T1: the hand-off's own owner role (:888, :890, :1063).
  [
    HARNESS,
    `\${ownerRole} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE \${inheritClause} PASSWORD '\${NONSUPER_OWNER_PW}'`,
    1,
  ],
  [
    HARNESS,
    `\${ownerRole} WITH LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE \${inheritClause} PASSWORD '\${NONSUPER_OWNER_PW}'`,
    1,
  ],
  [HARNESS, `IF EXISTS \${ownerRole}`, 1],
  // T1, W9: the mutators' own definitions and internal calls.
  ...[...MUTATORS].map(([name, count]): [string, string, number] => [HARNESS, name, count]),
  // SCR: test-harness.test.ts's own scratch roles, never a shared name (:333-368, :528-536).
  [HARNESS_TEST, `IF EXISTS \${name}`, 2],
  [HARNESS_TEST, `\${roleA} LOGIN PASSWORD 'rpw_orig_a'`, 1],
  [HARNESS_TEST, `\${roleB} NOLOGIN PASSWORD 'rpw_orig_b'`, 1],
  [HARNESS_TEST, `\${roleC} LOGIN PASSWORD 'rpw_orig_c'`, 1],
  [HARNESS_TEST, `IF EXISTS \${JDB_ROLE}`, 2],
  [HARNESS_TEST, `\${JDB_ROLE} NOLOGIN`, 1],
];

/** Every hit in one source: a statement's trimmed region or a mutator's name. */
const scan = (source: string): string[] => {
  const code = source.replace(STRIP, (m) => (m.startsWith("/") ? m.replace(/[^\n]+/g, " ") : m));
  const hits: string[] = [];
  for (const [, membership, verb, region = ""] of code.matchAll(STATEMENT)) {
    const exempt = membership
      ? !MEMBERSHIP.test(region)
      : verb?.toUpperCase() === "ALTER" && DATABASE_SETTING.test(region);
    if (!exempt && (SHARED.test(region) || DYNAMIC.test(region))) hits.push(region.trim());
  }
  for (const [name] of code.matchAll(IDENTIFIER)) if (MUTATORS.has(name)) hits.push(name);
  return hits;
};

const walk = (dir: string): string[] =>
  readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) return SKIP.has(d.name) ? [] : walk(rel);
    return VITEST_DEFAULT.test(d.name) || HELPER.test(d.name) ? [rel] : [];
  });
const testFiles = () => [...walk("packages"), ...walk("apps")];

describe("role-hiding isolation guard (L32)", () => {
  it("flags a planted role statement and ignores its commented twins", () => {
    const region = "job_definer RENAME TO x";
    const statement = ["ALTER", "ROLE", region].join(" ");
    expect(scan(`await su.query(\`${statement}\`);`)).toEqual([region]);
    expect(scan(`// ${statement}\n/* ${statement} */`)).toEqual([]);
  });

  it("finds shared-role mutations only in the isolated test files", () => {
    const files = testFiles();
    const hits = new Map(
      files.map((file) => [file, scan(readFileSync(new URL(file, ROOT), "utf8"))]),
    );
    const mismatched = PINS.flatMap(([file, key, pinned]) => {
      const found = hits.get(file)?.filter((hit) => hit === key).length ?? 0;
      return found === pinned ? [] : [`${file} ${key}: pinned ${pinned}, found ${found}`];
    });
    const flagged = Object.fromEntries(
      [...hits]
        .map(
          ([file, keys]) =>
            [file, keys.filter((key) => !PINS.some(([f, k]) => f === file && k === key))] as const,
        )
        .filter(([, keys]) => keys.length > 0),
    );
    const isolated = isolatedTestFiles.map((file) => `packages/db/${file}`).sort();
    expect(mismatched).toEqual([]);
    expect(Object.entries(flagged).filter(([file]) => !isolated.includes(file))).toEqual([]);
    expect(Object.keys(flagged).sort()).toEqual(isolated);
    // Measured 240 at 56d31b2, this file included; a broken walk falls far below.
    expect(files.length).toBeGreaterThan(220);
  }, 30_000);

  it("runs every package test file, each isolated file alone in a later group", () => {
    type Project = {
      test: {
        name: string;
        include: string[];
        exclude?: string[];
        sequence: { groupOrder: number };
      };
    };
    const [parallel, ...isolated] = (config.test?.projects ?? []) as Project[];
    expect(config.test).toMatchObject({
      fileParallelism: true,
      testTimeout: 30_000,
      hookTimeout: 120_000,
    });
    expect(parallel?.test).toMatchObject({
      name: "parallel",
      include: ["src/**/*.test.ts"],
      sequence: { groupOrder: 0 },
    });
    expect(parallel?.test.exclude).toEqual([...configDefaults.exclude, ...isolatedTestFiles]);
    expect(isolated.map((p) => [p.test.name, p.test.include])).toEqual(
      isolatedTestFiles.map((file, i) => [`isolated-${i + 1}`, [file]]),
    );
    const groups = isolated.map((p) => p.test.sequence.groupOrder);
    expect(new Set(groups).size).toBe(groups.length);
    expect(Math.min(...groups)).toBeGreaterThan(0);
    // Any flag here (--project, --sequence, --fileParallelism, a file filter) could run a subset or reorder the groups.
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      scripts: { test: string };
    };
    expect(pkg.scripts.test).toBe("vitest run --passWithNoTests");
    // The base config had no include, so vitest's default pattern ran every such file: each must still be a src test file.
    const unrun = testFiles().filter(
      (f) =>
        f.startsWith("packages/db/") &&
        VITEST_DEFAULT.test(f) &&
        !/^packages\/db\/src\/.+\.test\.ts$/.test(f),
    );
    expect(unrun).toEqual([]);
  }, 30_000);
});
