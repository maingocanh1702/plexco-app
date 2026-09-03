import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  loadAuthority,
  auditCoverage,
  listScriptFiles,
  generate,
  JSON_PATH,
  DOC_PATH,
} from "./check-kit-pack-membership.mjs";

const CHECKER = fileURLToPath(new URL("./check-kit-pack-membership.mjs", import.meta.url));
const REPO_ROOT = path.resolve(path.dirname(CHECKER), "..");

// owner/evidence are DERIVED from pack_pairs_verbatim and must never be stored.
const rec = (over = {}) => ({
  path: "scripts/a.sh",
  kit_version_header: false,
  overwrite_path: "kit-sync",
  overwrite_latency: "next successful autopilot-update.sh run",
  ...over,
});
const repoRec = (over = {}) =>
  rec({ overwrite_path: "none", overwrite_latency: "not overwritten", ...over });

/** Run an in-memory authority object through the real loader, so tests exercise validation. */
function loadFromObject(obj) {
  const dir = mkdtempSync(path.join(tmpdir(), "kpm-obj-"));
  mkdirSync(path.join(dir, "docs/standards"), { recursive: true });
  writeFileSync(path.join(dir, JSON_PATH), JSON.stringify(obj));
  try {
    return loadAuthority(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const authority = (files) => ({
  provenance: {
    canonical_repo: "~/x",
    canonical_commit_read_at: "a".repeat(40),
    also_verified_identical_at: "b".repeat(40),
    authority_file: "pack_pairs()",
    measured_on: "2026-09-03",
    reverify_command: "git rev-parse HEAD",
    note: "n",
  },
  overwrite_mechanisms: {
    "kit-sync": { status: "active", invoked_by: "a human", latency: "next run", wiring_evidence: "w", measured_on: "2026-09-03" },
  },
  pack_pairs_verbatim: ["x:scripts/a.sh:100755"],
  files,
});

// --- authority validation: fail-closed ---------------------------------------------------------

test("a missing files array is an error, never an empty kit", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kpm-"));
  mkdirSync(path.join(dir, "docs/standards"), { recursive: true });
  writeFileSync(path.join(dir, JSON_PATH), JSON.stringify(authority([])));
  assert.throws(() => loadAuthority(dir), /no "files" array/);
  rmSync(dir, { recursive: true, force: true });
});

test("invalid records are rejected: bad owner, missing overwrite_path, duplicate path", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kpm-"));
  mkdirSync(path.join(dir, "docs/standards"), { recursive: true });
  const write = (files) => writeFileSync(path.join(dir, JSON_PATH), JSON.stringify(authority(files)));

  write([rec({ owner: "kit-owned" })]);
  assert.throws(() => loadAuthority(dir), /must not be stored/);

  write([rec({ overwrite_path: "none" })]);
  assert.throws(() => loadAuthority(dir), /membership implies/);

  write([rec({ kit_version_header: "yes" })]);
  assert.throws(() => loadAuthority(dir), /must be a boolean/);

  write([rec(), rec()]);
  assert.throws(() => loadAuthority(dir), /appears twice/);

  write([rec()]);
  assert.equal(loadAuthority(dir).files.length, 1);
  rmSync(dir, { recursive: true, force: true });
});

test("malformed JSON fails closed with the parser's reason", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "kpm-"));
  mkdirSync(path.join(dir, "docs/standards"), { recursive: true });
  writeFileSync(path.join(dir, JSON_PATH), "{ not json");
  assert.throws(() => loadAuthority(dir), /not valid JSON/);
  rmSync(dir, { recursive: true, force: true });
});

// --- coverage ----------------------------------------------------------------------------------

test("coverage reports an unclassified script and a record whose file is gone", () => {
  const files = [rec(), repoRec({ path: "scripts/b.sh" })];
  assert.deepEqual(auditCoverage(files, ["scripts/a.sh", "scripts/new.sh"]), {
    missing: ["scripts/new.sh"],
    stale: ["scripts/b.sh"],
  });
});

test("records outside scripts/ are documentation, not audited", () => {
  const files = [rec(), repoRec({ path: "docs/autopilot-templates/level3-workflow.md" })];
  assert.deepEqual(auditCoverage(files, ["scripts/a.sh"]), { missing: [], stale: [] });
});

// --- generation --------------------------------------------------------------------------------

test("generation is deterministic", () => {
  const a = loadFromObject(authority([rec()]));
  assert.equal(generate(a), generate(a));
});

test("owner and evidence are derived from pack_pairs_verbatim, not stored", () => {
  // Regression for the round-1 [P1]: two representations of one fact drift. A probe flipped
  // scripts/autopilot-scope-gate to repo-owned while it stayed in pack_pairs and the audit passed.
  const d = loadFromObject(authority([rec(), repoRec({ path: "scripts/not-in-pack.sh" })]));
  assert.equal(d.files[0].owner, "kit-owned", "listed in pack_pairs_verbatim");
  assert.equal(d.files[1].owner, "repo-owned", "not listed");
  assert.match(d.files[0].evidence, /present in/);
});

test("a pack destination with no record fails closed", () => {
  const a = authority([repoRec({ path: "scripts/other.sh" })]);
  a.pack_pairs_verbatim = ["x:scripts/a.sh:100755"];
  assert.throws(() => loadFromObject(a), /no record/);
});

test("a missing pack_pairs_verbatim fails closed", () => {
  const a = authority([rec()]);
  delete a.pack_pairs_verbatim;
  assert.throws(() => loadFromObject(a), /pack_pairs_verbatim/);
});

test("the generator emits header PRESENCE and never a version number", () => {
  // The trap a predecessor shipped: hand-copied 8/33/3 rotted while CI stayed green. A generator
  // that snapshots values just buries them in output instead.
  const out = generate(loadFromObject(authority([rec({ kit_version_header: true })])));
  assert.match(out, /present — read it, do not copy it/);
  assert.doesNotMatch(out, /KIT_VERSION:\s*\d+/, "no pinned version may appear in generated output");
  assert.match(out, /awk '\/\^# KIT_VERSION:\/\{print \$3; exit\}'/, "it must print the measurement command");
});

test("a pipe in a field cannot break out of the table", () => {
  // rec() covers the pack destination; the piped path is an extra repo-owned record.
  const out = generate(loadFromObject(authority([rec(), repoRec({ path: "scripts/a|b.sh" })])));
  assert.match(out, /a\\\|b/);
});

// --- the shipped artifacts ---------------------------------------------------------------------

test("the shipped .md is byte-identical to what the authority generates", () => {
  const data = loadAuthority(REPO_ROOT);
  assert.equal(readFileSync(path.join(REPO_ROOT, DOC_PATH), "utf8"), generate(data));
});

test("every file under scripts/ is classified exactly once", () => {
  const data = loadAuthority(REPO_ROOT);
  assert.deepEqual(auditCoverage(data.files, listScriptFiles(REPO_ROOT)), { missing: [], stale: [] });
});

test("the header counter-example is recorded as kit-owned with no header", () => {
  const byPath = new Map(loadAuthority(REPO_ROOT).files.map((f) => [f.path, f]));
  const ctr = byPath.get("scripts/autopilot-review-readiness.mjs");
  assert.equal(ctr.owner, "kit-owned");
  assert.equal(ctr.kit_version_header, false, "no header, yet a pack member — that is the whole point");
  assert.equal(byPath.get("scripts/check-kit-pack-membership.mjs").owner, "repo-owned");
});

test("every record carries an overwrite path and latency", () => {
  for (const f of loadAuthority(REPO_ROOT).files) {
    assert.ok(f.overwrite_path, `${f.path} overwrite_path`);
    assert.ok(f.overwrite_latency, `${f.path} overwrite_latency`);
  }
});

test("the dormant mechanism is recorded as dormant, with provenance and a staleness flag", () => {
  // It must never be presented as running. Three separate claims that it ran preceded anyone
  // measuring its wiring point.
  const m = loadAuthority(REPO_ROOT).overwrite_mechanisms["session-hook"];
  assert.equal(m.status, "dormant");
  assert.equal(m.stale_by_construction, true);
  assert.ok(m.measured_on, "a value measured outside this repo needs a date");
  assert.match(m.wiring_evidence, /settings\.json/, "the evidence must cite the WIRING, not the code");
});

test("the scope-gate row explains WHY it currently matches canonical", () => {
  // "identical" is the result of a manual sync, not evidence that drift pressure is absent.
  const row = loadAuthority(REPO_ROOT).files.find((f) => f.path === "scripts/autopilot-scope-gate");
  assert.match(row.note, /8e737fe/);
  assert.match(row.note, /NOT as evidence/i);
});

// --- capability, not shape ---------------------------------------------------------------------

test("the command the document tells you to run actually works", () => {
  const doc = readFileSync(path.join(REPO_ROOT, DOC_PATH), "utf8");
  const m = doc.match(/^[ \t]*(pnpm kit:check)[ \t]*(?:#.*)?$/m);
  assert.ok(m, "the document must state a runnable check command");
  const r = spawnSync("pnpm", ["kit:check"], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(r.status, 0, `documented command failed:\n${r.stderr}`);
  assert.match(r.stdout, /audit PASS/);
});

test("package.json wires kit:check into what CI runs", () => {
  const pkg = JSON.parse(readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.match(pkg.scripts["kit:check"], /check-kit-pack-membership\.mjs --audit/);
  assert.match(pkg.scripts.test, /kit:check/, "otherwise enforcement is incidental, not wired");
});

// --- end to end, through the real process --------------------------------------------------------

function scratchRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "kpm-e2e-"));
  execFileSync("git", ["init", "-q", "-b", "main"], { cwd: dir });
  mkdirSync(path.join(dir, "docs/standards"), { recursive: true });
  mkdirSync(path.join(dir, "scripts"), { recursive: true });
  const data = authority([rec({ path: "scripts/a.sh" }), repoRec({ path: "scripts/b.mjs" })]);
  writeFileSync(path.join(dir, JSON_PATH), JSON.stringify(data, null, 2));
  writeFileSync(path.join(dir, DOC_PATH), generate(loadFromObject(data)));
  writeFileSync(path.join(dir, "scripts/a.sh"), "kit\n");
  writeFileSync(path.join(dir, "scripts/b.mjs"), "repo\n");
  return { dir, data };
}

const runChecker = (dir, args) =>
  spawnSync(process.execPath, [CHECKER, ...args], { cwd: dir, encoding: "utf8" });

test("end to end: audit passes on a consistent repo", (t) => {
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = runChecker(dir, ["--audit"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /audit PASS/);
});

test("end to end: DRIFT FIXTURE — an unclassified script turns it red", (t) => {
  // Kept deliberately: a check whose failure mode has never been observed is a claim, not an
  // enforcement point. This is that observation.
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, "scripts/unclassified.sh"), "new\n");
  const r = runChecker(dir, ["--audit"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /missing record/);
  assert.match(r.stderr, /scripts\/unclassified\.sh/);
});

test("end to end: a record whose file is gone turns it red", (t) => {
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  rmSync(path.join(dir, "scripts/b.mjs"));
  const r = runChecker(dir, ["--audit"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stale record/);
});

test("end to end: hand-editing the generated page turns it red", (t) => {
  // The property that makes drift impossible rather than merely detectable.
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const docAbs = path.join(dir, DOC_PATH);
  writeFileSync(docAbs, readFileSync(docAbs, "utf8").replace("**kit-owned**", "**repo-owned**"));
  const r = runChecker(dir, ["--audit"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GENERATED_DOC_STALE/);
});

test("end to end: --generate --write restores it", (t) => {
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(path.join(dir, DOC_PATH), "clobbered\n");
  assert.equal(runChecker(dir, ["--audit"]).status, 1);
  assert.equal(runChecker(dir, ["--generate", "--write"]).status, 0);
  assert.equal(runChecker(dir, ["--audit"]).status, 0);
});

test("end to end: a missing authority fails closed", (t) => {
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  rmSync(path.join(dir, JSON_PATH));
  const r = runChecker(dir, ["--audit"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /CHECK_UNAVAILABLE/);
});

test("end to end: a missing generated page fails closed", (t) => {
  const { dir } = scratchRepo();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  rmSync(path.join(dir, DOC_PATH));
  const r = runChecker(dir, ["--audit"]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /is missing/);
});
