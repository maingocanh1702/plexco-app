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
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { renderBoardHtml, renderMarkdownTable } from "./render.mjs";

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
    stdio: ["ignore", "pipe", "ignore"],
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

// ---------------------------------------------------------------- module progress (feature x phase)

// The Module Progress table is the ROADMAP's own feature-to-phase mapping. Its code axes are
// Migration, BE, FE, Tests -- there is no Invariant column here -- and Spec is excluded for the
// same reason as in the delivery matrix (rule 1: a spec is not progress).
const MODULE_AXES = ["Migration", "BE", "FE", "Tests"];

// Canonical phase order. A cell naming several phases (e.g. "P2.5/P4.3/P4.7") is filed under the
// first one and flagged, rather than counted several times -- counting it twice would inflate
// every phase it touches.
const PHASE_ORDER = [
  "P0",
  "P0-P1",
  "P1",
  "P2",
  "P2.5",
  "P3",
  "P3.5",
  "P4",
  "P4.3",
  "P4.5",
  "P4.5-P4.7",
  "P4.7",
  "P5",
  "P6",
];

function normalizePhase(raw) {
  return raw
    .replace(/\*\*/g, "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/`/g, "")
    .trim();
}

function parseModules(text) {
  if (!text) return null;
  const all = text.split("\n");
  const anchor = all.findIndex((l) => l.startsWith("### Module Progress"));
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
  const col = (name) => header.findIndex((h) => h === name);
  const iId = col("#");
  const iName = col("Module");
  const iTrack = col("Track");
  const iPhase = col("Phase");
  const axisIndex = MODULE_AXES.map(col);
  if ([iId, iName, iTrack, iPhase, ...axisIndex].some((i) => i === -1)) return null;

  const rows = [];
  for (const line of table.slice(2)) {
    const cells = line.split("|").slice(1, -1);
    if (cells.length < header.length) continue;
    let sum = 0;
    let counted = 0;
    axisIndex.forEach((idx) => {
      const sym = cellSymbol(cells[idx] ?? "");
      if (sym === null || sym === NA) return;
      sum += SCORE[sym];
      counted += 1;
    });
    if (!counted) continue;
    const phases = normalizePhase(cells[iPhase] ?? "").split("/");
    rows.push({
      id: cells[iId].trim(),
      name: cells[iName]
        .replace(/\*\*/g, "")
        .replace(/\s*\(.*$/, "")
        .trim(),
      tracks: cells[iTrack].match(/\p{Extended_Pictographic}/gu) ?? [],
      phase: phases[0],
      phasesAll: phases,
      multiPhase: phases.length > 1,
      counted,
      pct: Math.round((sum / counted) * 100),
    });
  }
  return rows.length ? rows : null;
}

// docs/project/modules.json is the Project tier's source of truth once it exists (2026-09-19).
// The markdown table is rendered FROM it, so at any ref that has the JSON we read the JSON and
// ignore the table; older refs fall back to parsing the table. Scores use the same rule either
// way: done=1, merged/partial=0.5, not_started/blocked=0, n/a dropped from the denominator.
const JSON_SCORE = {
  done: 1,
  merged_not_enabled: 0.5,
  merged_dark: 0.5,
  partial: 0.5,
  not_started: 0,
  blocked_external: 0,
};
const TRACK_EMOJI = {
  core: "\u{1F3E2}",
  payment: "\u{1F4B0}",
  identity: "\u{1F194}",
  "web-sync": "\u{1F310}",
  marketplace: "\u{1F50E}",
  "player-channels": "\u{1F3AF}",
  security: "\u{1F512}",
};

function pctOver(axes, keys) {
  let sum = 0;
  let counted = 0;
  for (const k of keys) {
    const st = axes[k];
    if (st === undefined || st === "n/a") continue;
    if (!(st in JSON_SCORE)) return null;
    sum += JSON_SCORE[st];
    counted += 1;
  }
  return counted ? { pct: Math.round((sum / counted) * 100), counted } : null;
}

function weakest(axes) {
  let min = null;
  for (const st of Object.values(axes)) {
    if (st === "n/a" || !(st in JSON_SCORE)) continue;
    min = min === null ? JSON_SCORE[st] : Math.min(min, JSON_SCORE[st]);
  }
  return min;
}

function loadModulesJson(ref) {
  const path = "docs/project/modules.json";
  let raw = gitSafe("show", `${ref}:${path}`);
  if (raw === null) {
    // First render of a not-yet-committed JSON: only when the ref IS the working tree's HEAD.
    const head = gitSafe("rev-parse", "HEAD");
    if (gitSafe("rev-parse", ref) === head && existsSync(path)) raw = readFileSync(path, "utf8");
  }
  if (raw === null) return null;
  let doc;
  try {
    doc = JSON.parse(raw);
  } catch {
    return null;
  }
  if (doc?._schema !== "plexco-modules-v1" || !Array.isArray(doc.modules)) return null;
  const rows = [];
  for (const m of doc.modules) {
    const s = pctOver(m.axes, ["migration", "be", "fe", "tests"]);
    if (!s) continue;
    rows.push({
      ...m,
      tracks: (m.track ?? []).map((t) => TRACK_EMOJI[t] ?? t),
      phasesAll: m.phases_all ?? [m.phase],
      multiPhase: (m.phases_all ?? []).length > 1,
      counted: s.counted,
      pct: s.pct,
      source: "json",
    });
  }
  return { doc, rows };
}

// Two headline bars, both derived. The ROADMAP's own ~33% is a third, hand-kept scale that is
// quoted verbatim elsewhere and never recomputed here.
function headlineBars(rows) {
  const p1 = rows.filter((m) => m.phase1);
  const be = p1.map((m) => pctOver(m.axes, ["migration", "be", "tests"])).filter(Boolean);
  const launch = rows
    .filter((m) => m.launch_block)
    .map((m) => weakest(m.axes))
    .filter((v) => v !== null);
  return {
    be: be.length ? Math.round(be.reduce((a, x) => a + x.pct, 0) / be.length) : null,
    beModules: be.length,
    launch: launch.length
      ? Math.round((launch.reduce((a, x) => a + x, 0) / launch.length) * 100)
      : null,
    launchModules: launch.length,
  };
}

function loadInbox(ref) {
  const path = "docs/project/decisions-inbox.json";
  let raw = gitSafe("show", `${ref}:${path}`);
  if (raw === null && existsSync(path)) raw = readFileSync(path, "utf8");
  if (raw === null) return null;
  try {
    const doc = JSON.parse(raw);
    return Array.isArray(doc?.items) ? doc.items : null;
  } catch {
    return null;
  }
}

function byPhase(modules) {
  const seen = [...new Set(modules.map((m) => m.phase))];
  seen.sort((a, b) => {
    const ia = PHASE_ORDER.indexOf(a);
    const ib = PHASE_ORDER.indexOf(b);
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  });
  return seen.map((phase) => ({
    phase,
    modules: modules.filter((m) => m.phase === phase),
  }));
}

// Track rollup is the one aggregate the ROADMAP defines: "Track = trung binh module". A module
// listed under two tracks counts for both, exactly as the rule says.
function byTrack(modules) {
  const map = new Map();
  for (const m of modules) {
    for (const t of m.tracks) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(m);
    }
  }
  return [...map.entries()].map(([track, ms]) => ({
    track,
    modules: ms,
    pct: Math.round(ms.reduce((a, m) => a + m.pct, 0) / ms.length),
  }));
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
  const onlyPhases = argv.includes("--phases");
  const doRender = argv.includes("--render");
  const refArg = argv.indexOf("--ref");
  // Default ref: HEAD whenever the local branch already contains origin/main. The ROADMAP pin is an
  // authority statement that lives on the branch until it is pushed, so reading origin/main there
  // would report a pin the working branch has already superseded -- which is exactly the kind of
  // stale number this tool exists to catch.
  const hasOrigin = Boolean(gitSafe("rev-parse", "origin/main"));
  const headContainsOrigin =
    hasOrigin && gitSafe("merge-base", "--is-ancestor", "origin/main", "HEAD") !== null;
  const ref =
    refArg !== -1 ? argv[refArg + 1] : !hasOrigin || headContainsOrigin ? "HEAD" : "origin/main";

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
  const loaded = loadModulesJson(ref);
  const modules = loaded ? loaded.rows : parseModules(roadmap.text);
  const headlineBarsOut = loaded ? headlineBars(modules) : null;
  const inbox = loadInbox(ref);
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
          modules,
          headline: headlineBarsOut,
          inbox,
          phases: modules && byPhase(modules),
          tracks: modules && byTrack(modules),
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

  // PHASES -- the question "which feature is done in which phase" is answered by the ROADMAP's own
  // Module Progress table, not by the delivery-group matrix: only that table carries a Phase column.
  // Each module gets its own bar from the documented rule. No phase-level aggregate is invented --
  // the ROADMAP defines a mean for tracks and says nothing about phases, so phases get counts.
  const renderPhases = () => {
    out("PHASES \u2014 which module is done in which phase (ROADMAP \u00a7Module Progress)");
    if (!modules) {
      out(
        "  Module Progress table not parseable at this ref \u2014 fix the table or the parser, never guess",
      );
      out("");
      return;
    }
    for (const g of byPhase(modules)) {
      const done = g.modules.filter((m) => m.pct === 100).length;
      const zero = g.modules.filter((m) => m.pct === 0).length;
      const partial = g.modules.length - done - zero;
      out(
        `  ${g.phase.padEnd(10)} ${String(g.modules.length).padStart(2)} module${g.modules.length === 1 ? " " : "s"}: ${done} done \u00b7 ${partial} partial \u00b7 ${zero} not started`,
      );
      for (const m of g.modules) {
        const also = m.multiPhase ? `  (also ${m.phasesAll.slice(1).join(", ")})` : "";
        out(
          `    ${bar(m.pct, 10)} ${String(m.pct).padStart(3)}%  #${m.id.padEnd(4)} ${m.name}${also}`,
        );
      }
      out("");
    }
    out("  TRACKS (the one aggregate the ROADMAP defines: track = mean of its modules)");
    for (const t of byTrack(modules)) {
      out(
        `    ${bar(t.pct, 10)} ${String(t.pct).padStart(3)}%  ${t.track}  ${t.modules.length} module${t.modules.length === 1 ? "" : "s"}`,
      );
    }
    if (headlineBarsOut) {
      out("");
      out(`  HEADLINE (derived from modules.json)`);
      out(
        `    ${bar(headlineBarsOut.be, 10)} ${String(headlineBarsOut.be).padStart(3)}%  BE readiness for phase-1 (migration+be+tests over ${headlineBarsOut.beModules} phase-1 modules)`,
      );
      out(
        `    ${bar(headlineBarsOut.launch, 10)} ${String(headlineBarsOut.launch).padStart(3)}%  Launch readiness (weakest axis over ${headlineBarsOut.launchModules} launch-block modules)`,
      );
    }
    out("");
  };

  if (onlyPhases) {
    renderPhases();
    return;
  }

  if (doRender) {
    if (!loaded) {
      out("--render needs docs/project/modules.json at this ref (or in the working tree at HEAD)");
      process.exitCode = 1;
      return;
    }
    // 1. ROADMAP Module Progress table, between markers. Refuse rather than guess if absent.
    const rp = "docs/product/ROADMAP.md";
    const md = readFileSync(rp, "utf8");
    const B = "<!-- modules:begin -->";
    const E = "<!-- modules:end -->";
    const bi = md.indexOf(B);
    const ei = md.indexOf(E);
    if (bi === -1 || ei === -1 || ei < bi) {
      out(
        `ROADMAP.md has no ${B} / ${E} markers around the Module Progress table -- add them once, then re-run`,
      );
      process.exitCode = 1;
      return;
    }
    const table = renderMarkdownTable(loaded.doc.modules);
    const next = md.slice(0, bi + B.length) + "\n" + table + "\n" + md.slice(ei);
    const changed = next !== md;
    if (changed) writeFileSync(rp, next);
    out(
      `ROADMAP Module Progress table: ${changed ? "rewritten" : "unchanged"} (${loaded.doc.modules.length} rows)`,
    );

    // 2. board.html
    const wt =
      lines(gitSafe("worktree", "list", "--porcelain") ?? "").filter((l) =>
        l.startsWith("worktree "),
      ).length - 1;
    const html = renderBoardHtml({
      generatedAt: new Date().toISOString(),
      ref,
      sha: short(now.sha),
      pin: roadmap.pin ? short(roadmap.pin) : null,
      modulesPin: loaded.doc.pin ?? null,
      roadmapVersion: roadmap.version,
      roadmapHeadline: headline,
      carryFiles: carry.length,
      headline: headlineBarsOut,
      counts: now,
      countsAtPin: atPin,
      phases: byPhase(modules),
      tracks: byTrack(modules).map((t) => ({
        ...t,
        track: Object.keys(TRACK_EMOJI).find((k) => TRACK_EMOJI[k] === t.track) ?? t.track,
      })),
      inbox: inbox ?? [],
      lanes: {
        level3: `${Math.max(wt, 0)} worktree ngo\u00e0i root`,
        ap3: `queue ${ap3.queued.length} \u00b7 done ${ap3.done}${ap3.queued.length === 0 ? ' <span class="warn">\u2014 h\u00e0ng \u0111\u1ee3i r\u1ed7ng</span>' : ""}<br>${ap3.classes.map((c) => `${c.name}: clean_runs ${c.cleanRuns ?? "?"}`).join("<br>")}${ap3.paused ? '<br><span class="warn">PAUSED</span>' : ""}`,
        owner:
          (inbox ?? []).filter((i) => i.lane === "owner").length +
          " quy\u1ebft \u0111\u1ecbnh trong inbox",
        external:
          (inbox ?? []).filter((i) => i.lane === "external").length +
          " m\u1ee5c ch\u1edd ngo\u00e0i repo",
      },
      recent: { commits: recent.length, merges: recentMerges },
    });
    writeFileSync("docs/project/board.html", html);
    out("docs/project/board.html: written");
    return;
  }

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

  renderPhases();

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
