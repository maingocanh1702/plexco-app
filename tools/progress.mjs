#!/usr/bin/env node
// Plexco progress reporter.
//
//   pnpm progress                 # measure origin/main against the pin ROADMAP.md declares
//   pnpm progress --ref HEAD      # measure some other ref instead
//   pnpm progress --json          # same numbers, machine-readable
//
// WHY THIS EXISTS: every number in docs/product/ROADMAP.md is pinned to one SHA by hand, and a
// re-pin costs a whole session. Between 2026-09-04 and 2026-09-19 the pin sat at `0aff7ad` while
// ten migrations and ~20 PRs landed, so the file could not answer "where are we". This script
// re-derives the mechanical axes from git at a named ref. It does NOT re-derive judgement: the
// matrix cells stay hand-maintained in ROADMAP §.Dev Progress, and this only applies the bar rule
// to them.
//
// BAR RULE (ROADMAP "LUAT THANH", kept identical here): code axes only -- Migration, BE, FE/UI,
// Tests, Invariant. Spec is excluded on purpose (rule 1: a spec is not progress). Scoring is
// done=1, merged-not-enabled / partial=0.5, not-started / blocked=0, and a "not applicable" cell
// is dropped from the denominator rather than counted as zero.
//
// It never runs the test suite: test-case counts have their own authority (the canonical runner)
// and inventing them from a grep is exactly the drift this repo has been bitten by.

import process from "node:process";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";

const out = (line = "") => process.stdout.write(`${line}\n`);

const DONE = "\u2705";
const MERGED = "\u{1F7E2}";
const PARTIAL = "\u{1F7E1}";
const NOT_STARTED = "\u2B1C";
const BLOCKED = "\u26D4";
const NA = "\u2014";

const SCORE = { [DONE]: 1, [MERGED]: 0.5, [PARTIAL]: 0.5, [NOT_STARTED]: 0, [BLOCKED]: 0 };
const CODE_AXES = ["Migration", "BE", "FE/UI", "Tests", "Invariant"];

function git(...args) {
  return execFileSync("git", ["--no-optional-locks", ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  }).trim();
}

function gitSafe(...args) {
  try {
    return git(...args);
  } catch {
    return null;
  }
}

function lines(value) {
  return value ? value.split("\n").filter(Boolean) : [];
}

function short(sha) {
  return sha ? sha.slice(0, 7) : "?";
}

function bar(pct, width = 20) {
  const filled = Math.round((pct / 100) * width);
  return "\u2588".repeat(filled) + "\u2591".repeat(width - filled);
}

// ---------------------------------------------------------------- mechanical counts at a ref

function countsAt(ref) {
  const tree = (path) => lines(gitSafe("ls-tree", "-r", "--name-only", ref, path) ?? "");

  const migrations = tree("packages/db/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const testFiles = tree("packages")
    .concat(tree("apps"))
    .filter((f) => /\.test\.tsx?$/.test(f));
  const routes = tree("apps/web/app/api").filter((f) => f.endsWith("/route.ts"));
  const business = routes.filter(
    (f) => !f.startsWith("apps/web/app/api/auth/") && !f.startsWith("apps/web/app/api/onboarding/"),
  );
  const pages = tree("apps/web/app").filter((f) => f.endsWith("/page.tsx"));

  return {
    ref,
    sha: gitSafe("rev-parse", ref),
    migrations: migrations.length,
    migrationTail: migrations.length ? migrations[migrations.length - 1].split("/").pop() : null,
    testFiles: testFiles.length,
    routes: routes.length,
    businessRoutes: business.length,
    fePages: pages.length,
    feScreens: pages.filter((f) => f !== "apps/web/app/page.tsx").length,
    specProduct: tree("docs/features/FE").filter((f) => /feature_.*\.md$/.test(f)).length,
    specBe: tree("docs/features/BE").filter((f) => /feature_.*_tech\.md$/.test(f)).length,
    specFeDesign: tree("docs/channels/web/FE").filter((f) => /feature_.*_fe\.md$/.test(f)).length,
  };
}

// ---------------------------------------------------------------- ROADMAP pin + matrix

function roadmapAt(ref) {
  const text = gitSafe("show", `${ref}:docs/product/ROADMAP.md`);
  if (!text) return { text: null };

  const version = text.match(/\*\*Phi\u00ean b\u1ea3n:\*\*\s*(\S+)/)?.[1] ?? null;
  const pin = text.match(/main@([0-9a-f]{7,40})/)?.[1] ?? null;
  return { text, version, pin };
}

function cellSymbol(cell) {
  const hit = cell.match(new RegExp(`[${DONE}${MERGED}${PARTIAL}${NOT_STARTED}${BLOCKED}]`, "u"));
  if (hit) return hit[0];
  if (cell.trim() === NA || cell.trim() === "-") return NA;
  return null;
}

function parseMatrix(text) {
  if (!text) return null;
  const all = text.split("\n");
  const anchor = all.findIndex((l) => l.includes("Ma tr\u1eadn theo delivery group"));
  if (anchor === -1) return null;

  const table = [];
  for (let i = anchor; i < all.length; i += 1) {
    const line = all[i];
    if (line.startsWith("|")) table.push(line);
    else if (table.length) break;
  }
  if (table.length < 3) return null;

  const header = table[0]
    .split("|")
    .slice(1, -1)
    .map((c) => c.trim());
  const axisIndex = CODE_AXES.map((axis) => header.findIndex((h) => h === axis));
  if (axisIndex.some((i) => i === -1)) return null;

  const rows = [];
  for (const line of table.slice(2)) {
    const cells = line.split("|").slice(1, -1);
    if (cells.length < header.length) continue;
    const name = cells[0].replace(/\*\*/g, "").trim();
    let sum = 0;
    let counted = 0;
    const axes = {};
    axisIndex.forEach((idx, k) => {
      const sym = cellSymbol(cells[idx] ?? "");
      axes[CODE_AXES[k]] = sym;
      if (sym === null || sym === NA) return;
      sum += SCORE[sym];
      counted += 1;
    });
    if (!counted) continue;
    rows.push({ name, axes, counted, pct: Math.round((sum / counted) * 100) });
  }
  if (!rows.length) return null;

  const total = Math.round(
    (rows.reduce((acc, r) => acc + (r.pct / 100) * r.counted, 0) /
      rows.reduce((acc, r) => acc + r.counted, 0)) *
      100,
  );
  return { rows, total };
}

// ---------------------------------------------------------------- ap3 lane state

function ap3State() {
  const read = (p) => (existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null);
  const routines = read("ap3/routines.json");
  const trust = read("ap3/state/trust.json");

  let queued = [];
  let done = 0;
  if (existsSync("ap3/queue")) {
    queued = readdirSync("ap3/queue").filter((f) => f.endsWith(".md") && f !== "EXAMPLE.md");
  }
  if (existsSync("ap3/queue/done")) {
    done = readdirSync("ap3/queue/done").filter((f) => f.endsWith(".md")).length;
  }

  const classes = Object.entries(routines?.classes ?? {}).map(([name, c]) => ({
    name,
    status: c.status,
    risk: c.risk,
    paused: trust?.[name]?.paused ?? null,
    cleanRuns: trust?.[name]?.clean_runs ?? null,
    lastException: trust?.[name]?.last_exception ?? null,
  }));

  return { queued, done, classes, paused: existsSync("ap3/PAUSED") };
}

// ---------------------------------------------------------------- report

function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes("--json");
  const refArg = argv.indexOf("--ref");
  const ref =
    refArg !== -1 ? argv[refArg + 1] : gitSafe("rev-parse", "origin/main") ? "origin/main" : "HEAD";

  const head = gitSafe("rev-parse", "HEAD");
  const headSubject = gitSafe("log", "-1", "--pretty=%s", "HEAD");
  const origin = gitSafe("rev-parse", "origin/main");
  const divergence = origin
    ? gitSafe("rev-list", "--left-right", "--count", `HEAD...origin/main`)
    : null;
  const dirty = lines(gitSafe("status", "--porcelain") ?? "").filter((l) => !l.startsWith("??"));
  const untracked = lines(gitSafe("status", "--porcelain") ?? "").filter((l) => l.startsWith("??"));

  const roadmap = roadmapAt(ref);
  const now = countsAt(ref);
  const atPin = roadmap.pin ? countsAt(roadmap.pin) : null;
  const carry = roadmap.pin
    ? lines(
        gitSafe(
          "diff",
          "--name-only",
          `${roadmap.pin}..${ref}`,
          "--",
          "packages",
          "apps",
          "scripts",
        ) ?? "",
      )
    : [];
  const matrix = parseMatrix(roadmap.text);
  const headline =
    roadmap.text?.match(/T\u1ed4NG \(code[^\n]*?(~\s*\d+\s*%)/)?.[1]?.replace(/\s+/g, "") ?? null;
  const ap3 = ap3State();

  const recent = lines(gitSafe("log", ref, "--since=7.days", "--pretty=%h %s") ?? "");
  const recentMerges = recent.filter((l) => / Merge pull request /.test(l)).length;

  if (asJson) {
    out(
      JSON.stringify(
        {
          ref,
          head,
          origin,
          divergence,
          roadmap: { version: roadmap.version, pin: roadmap.pin },
          carry: carry.length,
          counts: now,
          countsAtPin: atPin,
          matrix,
          ap3,
          recent: { commits: recent.length, merges: recentMerges },
        },
        null,
        2,
      ),
    );
    return;
  }

  const delta = (a, b) => (atPin === null ? "" : `${b - a >= 0 ? "+" : ""}${b - a}`);
  const row = (label, pinValue, nowValue) =>
    `  ${label.padEnd(22)}${String(pinValue ?? "?").padStart(8)}${String(nowValue).padStart(14)}${String(delta(pinValue ?? 0, nowValue)).padStart(8)}`;

  out("");
  out(
    `PLEXCO PROGRESS  \u2014  measured ${new Date().toISOString().slice(0, 10)} at ${ref} (${short(now.sha)})`,
  );
  out("");

  out("GIT");
  out(`  HEAD          ${short(head)}  ${headSubject ?? ""}`);
  out(`  origin/main   ${short(origin)}`);
  if (divergence) {
    const [ahead, behind] = divergence.split(/\s+/);
    out(`  divergence    local ahead ${ahead} / behind ${behind}`);
  }
  out(`  worktree      ${dirty.length} tracked dirty \u00b7 ${untracked.length} untracked`);
  out("");

  out("ROADMAP PIN");
  if (!roadmap.pin) {
    out(
      "  could not read a `main@<sha>` pin out of docs/product/ROADMAP.md \u2014 numbers below stand alone",
    );
  } else {
    out(`  ROADMAP ${roadmap.version ?? "?"} pins main@${short(roadmap.pin)}`);
    out(
      `  carry check   git diff --name-only ${short(roadmap.pin)}..${ref} -- packages apps scripts`,
    );
    out(
      carry.length === 0
        ? "                \u2192 empty \u21d2 the pinned numbers still carry"
        : `                \u2192 ${carry.length} files \u21d2 PIN IS STALE, do not quote its numbers in a verdict`,
    );
  }
  out("");

  out(`COUNTS${atPin ? `                 at pin      at ${ref}       \u0394` : ""}`);
  out(row("migrations", atPin?.migrations, now.migrations));
  out(`  ${"migration tail".padEnd(22)}  at pin: ${atPin?.migrationTail ?? "?"}`);
  out(`  ${"".padEnd(22)}  at ref: ${now.migrationTail}`);
  out(row("test files", atPin?.testFiles, now.testFiles));
  out(row("api routes (total)", atPin?.routes, now.routes));
  out(row("api routes (business)", atPin?.businessRoutes, now.businessRoutes));
  out(row("FE screens (non-root)", atPin?.feScreens, now.feScreens));
  out(row("spec: product", atPin?.specProduct, now.specProduct));
  out(row("spec: BE tech", atPin?.specBe, now.specBe));
  out(row("spec: FE design", atPin?.specFeDesign, now.specFeDesign));
  out(
    "  test cases            \u2014 authority is the canonical runner (pnpm -w test); not derived here",
  );
  out("");

  out("MATRIX (ROADMAP \u00a7Dev Progress \u2014 code axes only, Spec excluded)");
  if (!matrix) {
    out(
      "  matrix table not parseable at this ref \u2014 fix the table or the parser, do not guess a %",
    );
  } else {
    for (const r of matrix.rows) {
      out(`  ${bar(r.pct, 14)} ${String(r.pct).padStart(3)}%  ${r.name}`);
    }
    const full = matrix.rows.filter((r) => r.pct === 100).length;
    const zero = matrix.rows.filter((r) => r.pct === 0).length;
    out("");
    out(
      `  ${matrix.rows.length} delivery groups: ${full} at 100% \u00b7 ${matrix.rows.length - full - zero} partial \u00b7 ${zero} not started`,
    );
    out("  (hand-maintained cells: this only applies the bar rule to them)");
    // The headline bar in the ROADMAP is a DIFFERENT scale and the file says so out loud. It is
    // quoted verbatim rather than recomputed -- averaging the rows above would produce a number
    // that looks like it and is not it, which is precisely the confusion the rule warns about.
    if (headline) {
      out(`  headline bar, quoted from ROADMAP (separate scale): ${headline}`);
    }
  }
  out("");

  out("AP3 LANE");
  out(
    `  kill switch   ${ap3.paused ? "ap3/PAUSED present \u2014 dispatcher will not run" : "off"}`,
  );
  out(`  queue         ${ap3.queued.length} dispatchable \u00b7 ${ap3.done} done`);
  for (const c of ap3.classes) {
    out(
      `  ${c.name.padEnd(20)} ${String(c.status).padEnd(9)} risk ${c.risk ?? "?"} \u00b7 clean_runs ${c.cleanRuns ?? "?"} \u00b7 last ${c.lastException ?? "none"}${c.paused ? " \u00b7 PAUSED" : ""}`,
    );
  }
  out("");

  out(`LAST 7 DAYS on ${ref}`);
  out(`  ${recent.length} commits \u00b7 ${recentMerges} PR merges`);
  for (const l of recent.slice(0, 8)) out(`  ${l}`);
  if (recent.length > 8) out(`  \u2026 ${recent.length - 8} more`);
  out("");
}

main();
