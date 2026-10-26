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
/** Every source file but a declaration file: a support module or a re-exported mutator that a parallel test calls is scanned too. */
const SOURCE = /(?<!\.d)\.[cm]?[jt]sx?$/;
/** Strings, template literals and regex literals (kept) and comments (blanked, newlines kept). A regex literal is a `/` after
 * one of = ( [ , ; { : ! & | ? => or a keyword (so an ordinary division is not read as one) whose body opens no comment.
 * ponytail: a division after an identifier spelled like a keyword (of, await, yield) or after a TypeScript non-null `!` is
 * misread as a regex literal; the match is then kept, never blanked, but it can swallow a quote, a backtick or the first `/`
 * of a comment. The other way round, a real regex literal after a character outside that list (`)` in
 * `if (ok) /[/*]/.test(s);`, or `}`) is read as a division, so a comment opener, a quote or a backtick inside it takes
 * effect. Either way what follows can be blanked or shifted (after a backtick, the rest of the file) and a later role
 * statement hidden. A real tokenizer is the upgrade path. */
const STRIP =
  /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\x60(?:\\[\s\S]|[^\x60\\])*\x60|\/\/[^\n]*|\/\*[\s\S]*?\*\/|\/(?<=(?:[=([,;{:!&|?]|=>|(?<![\w$.])(?:return|typeof|case|void|yield|await|delete|throw|in|of|else|do))\s*\/)(?![*/])(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n[])+\/[a-z]*/g;
/** A membership keyword (group 1) or a role statement (group 2), then its region (group 3) up to a semicolon (group 4 when it ends there) or a backtick. */
const STATEMENT =
  /\b(?:(GRANT|REVOKE)|(ALTER|CREATE|DROP)\s+(?:ROLE|USER|GROUP))\b([^;\x60]*)(?=(;)?)/gi;
/** A role list, then TO or FROM: an object grant's ON breaks the list, so object grants stay out (row OBJ). */
const MEMBERSHIP =
  /^\s+(?:(?:ADMIN|INHERIT|SET)\s+OPTION\s+FOR\s+)?(?:"[^"]*"|\$\{[^}]*\}|%[\d$*-]*[isl]|[\w$]+)(?:\s*,\s*(?:"[^"]*"|\$\{[^}]*\}|%[\d$*-]*[isl]|[\w$]+))*\s+(?:TO|FROM)\b/i;
/** The list sits outside the literal (a quote, then + or ||) or is missing, so the statement is never exempt as an object grant. */
const SPLIT_LIST = /^\s*(?:["'\x60]\s*(?:\+|\|\|)|$)/;
/** Row DL: the per-database setting form, keyed by the file's own database. */
const DATABASE_SETTING = /^\s+(?:"[^"]*"|\$\{[^}]*\}|%[\d$*-]*[isl]|[\w$]+)\s+IN\s+DATABASE\b/i;
/** A shared role: any definer (job, chat, identity, a future one), app, app_worker, app_user, readonly, plexco, or ALL roles. */
const SHARED = /(?<![\w$])(?:\w+_definer|app_worker|app_user|app|readonly|plexco|all)(?![\w$])/i;
/** A name the scan cannot read, so it fails closed: an interpolation, a format() specifier, a concatenation, the session's own role, or no name inside the literal. */
const DYNAMIC =
  /\$\{|%[\d$*-]*[isl]|["'\x60]\s*(?:\+|\|\|)|\b(?:current_user|session_user|current_role)\b|^\s*$/i;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
/** The harness's exported membership mutators (T1: the owner hand-off; W9: the definer-membership helpers),
 * names split so this file holds no reference. */
const [OWNER, STALE_CHAT, STALE, RESTORE_CHAT, RESTORE, ENSURE_CHAT, ENSURE, ALL_CHAT] = [
  "setupNonSuperuser" + "OwnerContext",
  "revokeStaleChatDefiner" + "Membership",
  "revokeStaleDefiner" + "Membership",
  "restoreChatDefiner" + "Membership",
  "restoreDefiner" + "Membership",
  "ensureChatDefiner" + "MembershipRevoked",
  "ensureDefiner" + "MembershipRevoked",
  "revokeAllChatDefiner" + "Members",
] as const;
/** Where test-harness.ts references each mutator (D2): [name, scope], once in each scope. */
const MUTATOR_SCOPES: [string, string][] = [
  [OWNER, OWNER],
  [STALE_CHAT, STALE_CHAT],
  [STALE_CHAT, ALL_CHAT],
  [STALE_CHAT, OWNER],
  [STALE, STALE_CHAT],
  [STALE, STALE],
  [STALE, OWNER],
  [RESTORE_CHAT, RESTORE_CHAT],
  [RESTORE_CHAT, OWNER],
  [RESTORE, RESTORE_CHAT],
  [RESTORE, RESTORE],
  [RESTORE, OWNER],
  [ENSURE_CHAT, ENSURE_CHAT],
  [ENSURE_CHAT, OWNER],
  [ENSURE, ENSURE_CHAT],
  [ENSURE, ENSURE],
  [ENSURE, OWNER],
  [ALL_CHAT, ALL_CHAT],
];
const MUTATORS = new Set(MUTATOR_SCOPES.map(([name]) => name));

const HARNESS = "packages/db/src/test-harness.ts";
const HARNESS_TEST = "packages/db/src/test-harness.test.ts";
const MIGRATE = "packages/db/src/migrate.ts";
/** test-harness.test.ts's two scratch-role suites, as scope labels. */
const RPW = "describe(createRolePasswordLeaser, on scratch roles and keys (RPW))";
const JDB = "describe(withJobDefinerBootstrapLock (JDB))";
/** A pin (D2): [file, scope, hit, exact count]. */
type Pin = [file: string, scope: string, hit: string, count: number];
/** Hits allowed outside the isolated files, each in its scope; a new copy, or a move to another scope, fails until it is reviewed. */
const PINS: Pin[] = [
  // PL: the harness's permanent password lease of the shared runtime roles.
  [
    HARNESS,
    "createRolePasswordLeaser",
    `\${client.escapeIdentifier(role)} WITH LOGIN PASSWORD \${password}`,
    1,
  ],
  [
    HARNESS,
    "createRolePasswordLeaser",
    `\${client.escapeIdentifier(role)} WITH \${login}PASSWORD \${password}`,
    1,
  ],
  // W9: the definer-membership helpers that migrate.test.ts calls.
  [
    HARNESS,
    STALE,
    `\${client.escapeIdentifier(definer)} FROM \${client.escapeIdentifier(rolname)}`,
    1,
  ],
  [
    HARNESS,
    RESTORE,
    `\${client.escapeIdentifier(definer)} TO \${client.escapeIdentifier(rolname)}`,
    1,
  ],
  [
    HARNESS,
    ENSURE,
    `\${client.escapeIdentifier(definer)} FROM \${client.escapeIdentifier(roleName)}`,
    1,
  ],
  // T1: the hand-off's own owner role.
  [
    HARNESS,
    OWNER,
    `\${ownerRole} LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE \${inheritClause} PASSWORD '\${NONSUPER_OWNER_PW}'`,
    1,
  ],
  [
    HARNESS,
    OWNER,
    `\${ownerRole} WITH LOGIN NOSUPERUSER NOBYPASSRLS CREATEROLE \${inheritClause} PASSWORD '\${NONSUPER_OWNER_PW}'`,
    1,
  ],
  [HARNESS, OWNER, `IF EXISTS \${ownerRole}`, 1],
  // T1, W9: the mutators' own definitions and internal calls.
  ...MUTATOR_SCOPES.map(([name, scope]): Pin => [HARNESS, scope, name, 1]),
  // SCR: test-harness.test.ts's own scratch roles, never a shared name.
  [HARNESS_TEST, RPW, `IF EXISTS \${name}`, 2],
  [HARNESS_TEST, RPW, `\${roleA} LOGIN PASSWORD 'rpw_orig_a'`, 1],
  [HARNESS_TEST, RPW, `\${roleB} NOLOGIN PASSWORD 'rpw_orig_b'`, 1],
  [HARNESS_TEST, RPW, `\${roleC} LOGIN PASSWORD 'rpw_orig_c'`, 1],
  [HARNESS_TEST, JDB, `IF EXISTS \${JDB_ROLE}`, 2],
  [HARNESS_TEST, JDB, `\${JDB_ROLE} NOLOGIN`, 1],
  // BS: migrate()'s permanent, idempotent role ensure (ensureRoleExists, BR-1: CREATE ROLE when absent,
  // no temporary state) and its refusal message.
  [MIGRATE, "ensureRoleExists", `with unsafe identifier \${JSON.stringify(role)}`, 1],
  [
    MIGRATE,
    "ensureRoleExists",
    `\${role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE`,
    1,
  ],
];

/** A scoped hit (D2): the top-level unit that holds it, then the hit. */
type Hit = [scope: string, hit: string];

/** The pin check over a hits map (file to scoped hits): the pins whose count differs, and each file's unpinned hits. */
const checkPins = (hits: Map<string, Hit[]>) => {
  const pinned = (file: string, [scope, hit]: Hit) =>
    PINS.some(([f, s, h]) => f === file && s === scope && h === hit);
  const mismatched = PINS.flatMap(([file, scope, key, count]) => {
    const found = hits.get(file)?.filter(([s, hit]) => s === scope && hit === key).length ?? 0;
    return found === count ? [] : [`${file} ${scope} :: ${key}: pinned ${count}, found ${found}`];
  });
  const flagged = Object.fromEntries(
    [...hits]
      .map(([file, found]) => [file, found.filter((hit) => !pinned(file, hit))] as const)
      .filter(([, found]) => found.length > 0),
  );
  return { mismatched, flagged };
};

/** A top-level unit (D2): a column-0 declaration's name (group 1), or a column-0 test-API call (group 2) with its quoted title (group 4). */
const SCOPE =
  /^(?:export\s+(?:default\s+)?)?(?:(?:async\s+)?function|const|let|var|class)\s+([\w$]+)|^(describe|it|test|beforeAll|afterAll|beforeEach|afterEach)\(\s*(?:(["'])(.*?)\3)?/gm;

/** Every hit in one source with its scope: a statement's trimmed region or a mutator's name. */
const scopedScan = (source: string): Hit[] => {
  const code = source.replace(STRIP, (m) => (/^\/[/*]/.test(m) ? m.replace(/[^\n]+/g, " ") : m));
  const scopes = [...code.matchAll(SCOPE)].map(
    (m) => [m.index, m[1] ?? `${m[2] ?? ""}(${m[4] ?? ""})`] as const,
  );
  const hits: [number, string][] = [];
  for (const m of code.matchAll(STATEMENT)) {
    const [, membership, verb, region = "", semicolon] = m;
    // A bare GRANT or REVOKE word before a semicolon is no statement; before a backtick or at the end it stays flagged.
    if (membership && semicolon && !region.trim()) continue;
    const exempt = membership
      ? !MEMBERSHIP.test(region) && !SPLIT_LIST.test(region)
      : verb?.toUpperCase() === "ALTER" && DATABASE_SETTING.test(region);
    if (!exempt && (SHARED.test(region) || DYNAMIC.test(region)))
      hits.push([m.index, region.trim()]);
  }
  for (const m of code.matchAll(IDENTIFIER)) if (MUTATORS.has(m[0])) hits.push([m.index, m[0]]);
  // ponytail: a move inside one top-level unit stays invisible; a line-number pin would see it, but goes red on every edit above it.
  return hits.map(([at, hit]): Hit => [
    scopes.filter(([start]) => start < at).pop()?.[1] ?? "",
    hit,
  ]);
};
/** Every hit in one source, unscoped. */
const scan = (source: string): string[] => scopedScan(source).map(([, hit]) => hit);
/** Every file's scoped hits. */
const repoHits = (files: string[]) =>
  new Map(files.map((file) => [file, scopedScan(readFileSync(new URL(file, ROOT), "utf8"))]));

const walk = (dir: string): string[] =>
  readdirSync(new URL(`${dir}/`, ROOT), { withFileTypes: true }).flatMap((d) => {
    const rel = `${dir}/${d.name}`;
    if (d.isDirectory()) return SKIP.has(d.name) ? [] : walk(rel);
    return SOURCE.test(d.name) ? [rel] : [];
  });
const sourceFiles = () => [...walk("packages"), ...walk("apps")];
/** Per-root floors (D4), one per first-level directory under packages/ and apps/: floor(0.9 x the count at the lane base,
 * 36 / 411 / 22 / 108), minimum 1. A missing root counts 0 and fails; a new root is scanned but not required.
 * ponytail: a lost subtree no larger than its root's margin (count minus floor at the lane base: 4, 42, 3 and 11 files under
 * apps/bot, apps/web, packages/core and packages/db) still passes every per-root floor; for apps/web the kept single floor
 * binds first (577 - 551 = 26 files at the lane base), so up to 26 lost web files pass every floor. Per-directory floors or
 * a pinned file list is the upgrade path. */
const ROOT_FLOORS: [string, number][] = [
  ["apps/bot", 32],
  ["apps/web", 369],
  ["packages/core", 19],
  ["packages/db", 97],
];
/** The scanned-file floors over a file list: each floor that the list falls under, naming its root. */
const floorFailures = (files: string[]): string[] => [
  // Measured 574 at e37411a (every source file under packages/ and apps/, this file included); a broken walk falls far below.
  ...(files.length > 550 ? [] : [`total: ${files.length} files, floor 551`]),
  ...ROOT_FLOORS.flatMap(([root, floor]) => {
    const count = files.filter((file) => file.startsWith(`${root}/`)).length;
    return count >= floor ? [] : [`${root}: ${count} files, floor ${floor}`];
  }),
];
const readJson = <T>(path: string): T => JSON.parse(readFileSync(new URL(path, ROOT), "utf8")) as T;

describe("role-hiding isolation guard (L32)", () => {
  it("flags a planted role statement and ignores its commented twins", () => {
    const region = "job_definer RENAME TO x";
    const statement = ["ALTER", "ROLE", region].join(" ");
    expect(scan(`await su.query(\`${statement}\`);`)).toEqual([region]);
    expect(scan(`// ${statement}\n/* ${statement} */`)).toEqual([]);
    // A role list concatenated outside the literal cannot be read: flagged, not exempt as an object grant.
    const list = `" + "job_definer" + " TO app_worker")`;
    expect(scan(`await su.query("${"GR" + "ANT"} ${list};`)).toEqual([list]);
  });

  it("keeps a regex literal that holds a comment opener, so a later statement stays visible (P3-1a)", () => {
    const region = "job_definer RENAME TO x";
    const statement = ["ALTER", "ROLE", region].join(" ");
    expect(scan(`const re = /[/*]/;\nawait su.query(\`${statement}\`);\n/* end */`)).toEqual([
      region,
    ]);
  });

  it("keeps a regex literal that holds a backtick, so a later comment is still blanked (P3-1b)", () => {
    const statement = ["ALTER", "ROLE", "job_definer RENAME TO x"].join(" ");
    expect(scan(`const re = /\x60/;\n// ${statement}\nconst s = \`ok\`;`)).toEqual([]);
  });

  it("skips a bare membership word before a semicolon, and only there (P3-3)", () => {
    expect(scan("return gr" + "ant;")).toEqual([]);
    // Before a backtick or at the end of the input it stays flagged, and so does a bare role statement before a semicolon.
    expect(scan("\x60re" + "voke\x60")).toEqual([""]);
    expect(scan("return gr" + "ant")).toEqual([""]);
    expect(scan("DR" + "OP ROLE;")).toEqual([""]);
  });

  it("sees a pinned hit moved to another scope of its own file (P3-2)", () => {
    const hits = repoHits(sourceFiles());
    const moved = `IF EXISTS \${ownerRole}`;
    hits.set(
      HARNESS,
      (hits.get(HARNESS) ?? []).map(([scope, hit]): Hit => [
        hit === moved ? "elsewhere" : scope,
        hit,
      ]),
    );
    const { mismatched, flagged } = checkPins(hits);
    expect(mismatched).toEqual([expect.stringContaining(HARNESS)]);
    expect(flagged[HARNESS]).toEqual([["elsewhere", moved]]);
  }, 30_000);

  it("fails a root that falls under its floor while the total still passes (P3-4)", () => {
    // Re-root packages/core rather than drop it: the total stays live, and a root with no floor is counted but not required.
    const files = sourceFiles().map((file) =>
      file.startsWith("packages/core/")
        ? `packages/no-floor-root/${file.slice("packages/core/".length)}`
        : file,
    );
    expect(floorFailures(files)).toEqual([expect.stringContaining("packages/core")]);
  }, 30_000);

  it("finds shared-role mutations only in the isolated test files", () => {
    const files = sourceFiles();
    const { mismatched, flagged } = checkPins(repoHits(files));
    const isolated = isolatedTestFiles.map((file) => `packages/db/${file}`).sort();
    expect(mismatched).toEqual([]);
    expect(Object.entries(flagged).filter(([file]) => !isolated.includes(file))).toEqual([]);
    expect(Object.keys(flagged).sort()).toEqual(isolated);
    expect(floorFailures(files)).toEqual([]);
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
    type Pkg = {
      scripts: { test: string };
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
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
    expect(readJson<Pkg>("packages/db/package.json").scripts.test).toBe(
      "vitest run --passWithNoTests",
    );
    // The base config had no include, so vitest's default pattern ran every such file: each must still be a src test file.
    const unrun = sourceFiles().filter(
      (f) =>
        f.startsWith("packages/db/") &&
        VITEST_DEFAULT.test(f) &&
        !/^packages\/db\/src\/.+\.test\.ts$/.test(f),
    );
    expect(unrun).toEqual([]);
    // The apps' tests check privileges and read pg_roles. pnpm's default topological order starts them only after
    // the db suite exits; --parallel or --no-sort would let them overlap its isolated groups.
    const dependsOnDb = ["apps/bot", "apps/web"].map((app) => {
      const { dependencies, devDependencies } = readJson<Pkg>(`${app}/package.json`);
      return [app, "@plexco/db" in { ...dependencies, ...devDependencies }];
    });
    expect(dependsOnDb).toEqual([
      ["apps/bot", true],
      ["apps/web", true],
    ]);
    const rootTest = readJson<Pkg>("package.json").scripts.test;
    expect(rootTest).toMatch(/(?:^|&& )pnpm -r run test$/);
    expect(rootTest).not.toMatch(/--parallel|--no-sort/);
  }, 30_000);
});
