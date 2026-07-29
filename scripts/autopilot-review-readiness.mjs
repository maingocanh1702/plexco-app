#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { userInfo } from "node:os";
import path from "node:path";
// Explicit import, not the implicit Node global: a consumer repo that lints scripts/ (ESLint's
// `ignores: ["*.mjs"]` matches only the repo ROOT, so scripts/*.mjs IS linted) otherwise fails with
// 11 x `'process' is not defined` under js.configs.recommended, turning `pnpm lint` and its CI job red
// the moment this pack lands. Observed in Plexco at kit v11, 2026-07-29. The sibling
// check-review-readiness.mjs already imports it this way.
import process from "node:process";

const VERSION = "level3-readiness-v2";
const REVIEW_TOOL = "scripts/codex-review-pin.sh";
const TRUSTED_GATE_FILES = new Set([
  "scripts/autopilot-scope-gate",
  "scripts/autopilot-review-readiness.mjs",
  REVIEW_TOOL,
]);
const MAX_BUFFER = 20 * 1024 * 1024;
const DURABLE_HALT_CODES = new Set([
  "BASE_DRIFT",
  "BASE_MISMATCH",
  "BASE_STALE",
  "BRANCH_MISMATCH",
  "BREAKER_ACTIVE",
  "BREAKER_EVIDENCE_MISSING",
  "CONTRACT_INVALID",
  "DEPENDENCY_NOT_LANDED",
  "DEPENDENCY_PROOF_INVALID",
  "DEPENDENCY_PROOF_REUSED",
  "EMPTY_DIFF",
  "GATE_INPUT_DRIFT",
  "GATE_TIMEOUT",
  "MANIFEST_MISSING",
  "MANIFEST_DRIFT",
  "MAX_ROUNDS",
  "READINESS_COMMAND_FAILED",
  "READINESS_JSON_INVALID",
  "REGION_THRASH",
  "REQUIRED_TOOL_UNAVAILABLE",
  "REVIEW_UNAVAILABLE",
  "REVIEW_VERDICT_INVALID",
  "SCOPE_DRIFT",
  "SELF_CERTIFYING_GATE_CHANGE",
]);
let durableStateDir;

function deriveDurableStateDir(repo, manifestFile) {
  const relative = path.relative(repo, manifestFile).split(path.sep);
  if (
    relative.length === 4
    && relative[0] === ".autopilot"
    && relative[1] === "state"
    && /^[a-z0-9][a-z0-9._-]*$/.test(relative[2])
    && relative[3] === "manifest.json"
  ) {
    durableStateDir = path.dirname(manifestFile);
  }
}

function halt(code, message) {
  if (durableStateDir && DURABLE_HALT_CODES.has(code)) {
    try {
      mkdirSync(durableStateDir, { recursive: true });
      const safeCode = code.replace(/[^A-Z0-9_-]/gi, "_");
      const signalPath = path.join(durableStateDir, `HALT-${safeCode}.txt`);
      if (!existsSync(signalPath)) {
        writeFileSync(
          signalPath,
          [
            `HALT ${code}: ${message}`,
            `created_at_utc: ${new Date().toISOString()}`,
            "resolution: close this terminal lifecycle and create a fresh successor task after fixing the cause",
            "",
          ].join("\n"),
        );
      }
    } catch {
      // The original gate failure remains authoritative even if the signal path is not writable.
    }
  }
  process.stderr.write(`HALT ${code}: ${message}\n`);
  process.exit(1);
}

function awaitReview(code, signalName, message) {
  if (durableStateDir) {
    mkdirSync(durableStateDir, { recursive: true });
    const signalPath = path.join(durableStateDir, `AWAIT-FOUNDER-${signalName}.txt`);
    if (!existsSync(signalPath)) {
      writeFileSync(
        signalPath,
        [
          `AWAIT ${code}: ${message}`,
          `created_at_utc: ${new Date().toISOString()}`,
          "resolution: resolve the reviewer condition, remove this signal, then resume the same in-flight lifecycle",
          "",
        ].join("\n"),
      );
    }
  }
  process.stderr.write(`AWAIT ${code}: ${message}\n`);
  process.exit(1);
}

function run(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_BUFFER,
    }).trim();
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim();
    halt("READINESS_COMMAND_FAILED", `${command} ${args.join(" ")}${detail ? ` — ${detail}` : ""}`);
  }
}

function runRaw(command, args, cwd) {
  try {
    return execFileSync(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: MAX_BUFFER,
    });
  } catch (error) {
    const detail = String(error.stderr || error.message || "").trim();
    halt("READINESS_COMMAND_FAILED", `${command} ${args.join(" ")}${detail ? ` — ${detail}` : ""}`);
  }
}

function tryRun(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER,
  });
}

function parseArguments(argv) {
  const mode = argv[2];
  let manifest;
  for (let index = 3; index < argv.length; index += 1) {
    if (argv[index] === "--manifest") {
      manifest = argv[index + 1];
      index += 1;
    } else {
      halt("READINESS_USAGE", `unknown argument: ${argv[index]}`);
    }
  }
  if (!["register", "ready"].includes(mode) || !manifest) {
    halt("READINESS_USAGE", "use: autopilot-review-readiness.mjs <register|ready> --manifest <path>");
  }
  return { mode, manifest };
}

function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch (error) {
    halt("READINESS_JSON_INVALID", `${label} ${file}: ${error.message}`);
  }
}

function requireString(value, label) {
  if (typeof value !== "string" || !value.trim() || /[<>]/.test(value)) {
    halt("CONTRACT_INVALID", `${label} must be a resolved non-placeholder string`);
  }
  return value.trim();
}

function requireStringArray(value, label, { allowEmpty = false } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    halt("CONTRACT_INVALID", `${label} must be ${allowEmpty ? "an" : "a non-empty"} array`);
  }
  return value.map((item, index) => requireString(item, `${label}[${index}]`));
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    halt("CONTRACT_INVALID", `${label} must be an object`);
  }
  return value;
}

function requireFullSha(value, label) {
  const sha = requireString(value, label);
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha) || /^0+$/.test(sha)) {
    halt("CONTRACT_INVALID", `${label} must be a real full commit SHA`);
  }
  return sha;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function relativeToRepo(repo, file) {
  return path.relative(repo, file).split(path.sep).join("/");
}

function artifactRecord(repo, file) {
  const body = readFileSync(file);
  return {
    path: relativeToRepo(repo, file),
    sha256: sha256(body),
    bytes: body.length,
  };
}

function lastNonEmptyLine(value) {
  const cleaned = String(value || "").replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*[A-Za-z]/g,
    "",
  );
  return cleaned.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).at(-1) || "";
}

function trustedReviewEnvironment() {
  const environment = { ...process.env };
  const home = userInfo().homedir;
  environment.HOME = home;
  environment.PATH = [
    path.join(home, ".npm-global", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
  ].join(":");
  for (const key of [
    "AUTOPILOT_CODEX_REAL_BIN",
    "AUTOPILOT_CODEX_REVIEW_MODEL",
    "AUTOPILOT_CODEX_REVIEW_EFFORT",
    "AUTOPILOT_CODEX_REVIEW_TIER",
    "BASH_ENV",
    "ENV",
    "NODE_OPTIONS",
  ]) {
    delete environment[key];
  }
  return environment;
}

const { mode, manifest: manifestArgument } = parseArguments(process.argv);
const repo = run("git", ["rev-parse", "--show-toplevel"], process.cwd());
const manifestCandidate = path.resolve(process.cwd(), manifestArgument);
deriveDurableStateDir(repo, manifestCandidate);
if (!existsSync(manifestCandidate)) {
  halt("MANIFEST_MISSING", manifestCandidate);
}
const manifestPath = realpathSync(manifestCandidate);
deriveDurableStateDir(repo, manifestPath);

const manifest = readJson(manifestPath, "manifest");
const manifestHash = sha256(readFileSync(manifestPath));
if (manifest.manifest_schema_version !== "level3-operational-v2") {
  halt("CONTRACT_INVALID", "manifest_schema_version must equal level3-operational-v2");
}
if (manifest.review_gate_version !== VERSION) {
  halt("CONTRACT_INVALID", `review_gate_version must equal ${VERSION}`);
}

const taskId = requireString(manifest.task_id, "task_id");
const feature = requireString(manifest.feature, "feature");
const branch = requireString(manifest.branch, "branch");
const baseRef = requireString(manifest.base_ref, "base_ref");
const baseSha = requireFullSha(manifest.base_sha, "base_sha");
if (!/^[a-z0-9][a-z0-9._-]*$/.test(feature)) {
  halt("CONTRACT_INVALID", "feature must be a filesystem-safe lowercase identifier");
}

const taskSlug = taskId.split(":").at(-1);
if (feature !== taskSlug && !feature.startsWith(`${taskSlug}--`)) {
  halt("CONTRACT_INVALID", "feature must equal <task-slug> or start with <task-slug>--");
}
if (branch !== `feat/${feature}`) {
  halt("CONTRACT_INVALID", `branch must equal feat/${feature}`);
}

const stateDir = path.join(repo, ".autopilot", "state", feature);
if (path.dirname(manifestPath) !== stateDir || path.basename(manifestPath) !== "manifest.json") {
  halt("CONTRACT_INVALID", `manifest must be ${path.join(".autopilot", "state", feature, "manifest.json")}`);
}
durableStateDir = stateDir;
if (mode === "ready") {
  for (const staleTerminal of ["READY.txt", "gate-result.json"]) {
    const stalePath = path.join(stateDir, staleTerminal);
    if (existsSync(stalePath)) {
      unlinkSync(stalePath);
    }
  }
}

const risk = requireString(manifest.risk, "risk");
if (!["P1", "P2"].includes(risk)) {
  halt("CONTRACT_INVALID", "only P1/P2 writing slices may register");
}
const autonomyMode = requireString(manifest.autonomy_mode, "autonomy_mode");
if (!["supervised", "proactive_routine"].includes(autonomyMode) || (risk === "P1" && autonomyMode !== "supervised")) {
  halt("CONTRACT_INVALID", "autonomy_mode is invalid for this risk");
}
if (manifest.writer_processes_max !== 1) {
  halt("CONTRACT_INVALID", "writer_processes_max must equal 1");
}

requireStringArray(manifest.context_sources, "context_sources");
requireStringArray(manifest.applicable_skills, "applicable_skills", { allowEmpty: true });
const scope = requireStringArray(manifest.scope, "scope");
requireStringArray(manifest.negative_scope, "negative_scope");
for (const item of scope) {
  if (path.isAbsolute(item) || item.includes("..") || /[*?[\]]/.test(item) || item.endsWith("/")) {
    halt("CONTRACT_INVALID", `scope must contain exact worktree-relative file paths: ${item}`);
  }
  const existing = path.join(repo, item);
  if (existsSync(existing) && statSync(existing).isDirectory()) {
    halt("CONTRACT_INVALID", `scope item is a directory, not an exact file: ${item}`);
  }
}
if (new Set(scope).size !== scope.length) {
  halt("CONTRACT_INVALID", "scope contains duplicate paths");
}

const modelPolicy = requireObject(manifest.model_policy, "model_policy");
requireString(modelPolicy.planner, "model_policy.planner");
requireString(modelPolicy.worker, "model_policy.worker");
if (requireString(modelPolicy.independent_reviewer, "model_policy.independent_reviewer") !== REVIEW_TOOL) {
  halt("CONTRACT_INVALID", `model_policy.independent_reviewer must equal ${REVIEW_TOOL}`);
}
requireString(modelPolicy.fallback, "model_policy.fallback");
const permissions = requireObject(manifest.sandbox_and_permissions, "sandbox_and_permissions");
requireString(permissions.network, "sandbox_and_permissions.network");
requireString(permissions.secrets, "sandbox_and_permissions.secrets");
requireString(permissions.external_side_effects, "sandbox_and_permissions.external_side_effects");

const verification = requireObject(manifest.verification, "verification");
requireStringArray(verification.focused, "verification.focused");
requireStringArray(verification.canonical, "verification.canonical");
requireStringArray(verification.e2e, "verification.e2e", { allowEmpty: true });
const codeReview = requireObject(manifest.code_review, "code_review");
if (codeReview.required !== true || requireString(codeReview.tool, "code_review.tool") !== REVIEW_TOOL) {
  halt("CONTRACT_INVALID", `code_review must be required and use ${REVIEW_TOOL}`);
}
const requiredCleanRounds = risk === "P1" ? 2 : 1;
if (!Number.isInteger(codeReview.clean_rounds) || codeReview.clean_rounds < requiredCleanRounds) {
  halt("CONTRACT_INVALID", `code_review.clean_rounds must be at least ${requiredCleanRounds}`);
}
const securityReview = requireObject(manifest.security_review, "security_review");
if (typeof securityReview.required !== "boolean") {
  halt("CONTRACT_INVALID", "security_review.required must be boolean");
}
requireString(securityReview.reason, "security_review.reason");
if (securityReview.required && requireString(securityReview.tool, "security_review.tool") !== REVIEW_TOOL) {
  halt("CONTRACT_INVALID", `security_review.tool must equal ${REVIEW_TOOL}`);
}

const budgets = requireObject(manifest.budgets, "budgets");
if (!Number.isInteger(budgets.wall_time_minutes) || budgets.wall_time_minutes < 1) {
  halt("CONTRACT_INVALID", "budgets.wall_time_minutes must be a positive integer");
}
if (!Number.isInteger(budgets.fix_rounds_max) || budgets.fix_rounds_max < 0 || budgets.fix_rounds_max > 5) {
  halt("CONTRACT_INVALID", "budgets.fix_rounds_max must be an integer from 0 through 5");
}
const stopConditions = requireStringArray(manifest.stop_conditions, "stop_conditions");
for (const required of ["MAX_ROUNDS", "REGION_THRASH", "SCOPE_OR_BASE_DRIFT", "REQUIRED_TOOL_UNAVAILABLE"]) {
  if (!stopConditions.includes(required)) {
    halt("CONTRACT_INVALID", `stop_conditions is missing ${required}`);
  }
}

const currentBranch = run("git", ["branch", "--show-current"], repo);
if (currentBranch !== branch) {
  halt("BRANCH_MISMATCH", `current=${currentBranch || "detached"} expected=${branch}`);
}
run("git", ["cat-file", "-e", `${baseSha}^{commit}`], repo);
const baseRefSha = run("git", ["rev-parse", `${baseRef}^{commit}`], repo);
if (baseRefSha !== baseSha) {
  halt("BASE_STALE", `${baseRef}=${baseRefSha} manifest=${baseSha}`);
}

const dependencies = requireStringArray(manifest.depends_on, "depends_on", { allowEmpty: true });
if (!Array.isArray(manifest.dep_checks)) {
  halt("CONTRACT_INVALID", "dep_checks must be an array");
}
if (manifest.dep_checks.length !== dependencies.length) {
  halt("DEPENDENCY_PROOF_INVALID", "every depends_on entry needs exactly one dep_checks entry");
}
for (const [index, rawCheck] of manifest.dep_checks.entries()) {
  const check = requireObject(rawCheck, `dep_checks[${index}]`);
  const dependency = requireString(check.feature, `dep_checks[${index}].feature`);
  if (dependency !== dependencies[index]) {
    halt("DEPENDENCY_PROOF_INVALID", "dep_checks must match depends_on in the same order");
  }
  const dependencyBaseSha = requireFullSha(check.base_sha, `dep_checks[${index}].base_sha`);
  const landedSha = requireFullSha(check.landed_sha, `dep_checks[${index}].landed_sha`);
  const file = requireString(check.file, `dep_checks[${index}].file`);
  const symbol = requireString(check.symbol, `dep_checks[${index}].symbol`);
  if (path.isAbsolute(file) || file.includes("..") || !/^[A-Za-z_][A-Za-z0-9_]{2,}$/.test(symbol)) {
    halt("DEPENDENCY_PROOF_INVALID", `${dependency} needs an exact file and unique identifier symbol`);
  }
  run("git", ["cat-file", "-e", `${dependencyBaseSha}^{commit}`], repo);
  run("git", ["cat-file", "-e", `${landedSha}^{commit}`], repo);
  if (tryRun("git", ["merge-base", "--is-ancestor", dependencyBaseSha, landedSha], repo).status !== 0) {
    halt("DEPENDENCY_NOT_LANDED", `${dependency}: dependency base is not an ancestor of landed_sha`);
  }
  if (tryRun("git", ["merge-base", "--is-ancestor", landedSha, baseSha], repo).status !== 0) {
    halt("DEPENDENCY_NOT_LANDED", `${dependency}: landed_sha is not on the pinned downstream base`);
  }
  const before = tryRun("git", ["show", `${dependencyBaseSha}:${file}`], repo);
  if (before.status === 0 && String(before.stdout).includes(symbol)) {
    halt("DEPENDENCY_PROOF_REUSED", `${dependency}: symbol ${symbol} already existed on its pinned base`);
  }
  const landed = tryRun("git", ["show", `${landedSha}:${file}`], repo);
  const downstream = tryRun("git", ["show", `${baseSha}:${file}`], repo);
  if (
    landed.status !== 0
    || downstream.status !== 0
    || !String(landed.stdout).includes(symbol)
    || !String(downstream.stdout).includes(symbol)
  ) {
    halt("DEPENDENCY_NOT_LANDED", `${dependency}: unique symbol ${symbol} is not present on landed/downstream trees`);
  }
}

const reviewerPath = path.join(repo, REVIEW_TOOL);
if (!existsSync(reviewerPath) || !statSync(reviewerPath).isFile() || (statSync(reviewerPath).mode & 0o111) === 0) {
  halt("REQUIRED_TOOL_UNAVAILABLE", `${REVIEW_TOOL} must exist and be executable on the pinned worktree`);
}

const headSha = run("git", ["rev-parse", "HEAD"], repo);
if (mode === "register") {
  if (headSha !== baseSha) {
    halt("BASE_MISMATCH", `worktree HEAD=${headSha} expected=${baseSha}`);
  }
  process.stdout.write(`LEVEL3_REGISTER_VALID task=${taskId} feature=${feature} base=${baseSha}\n`);
  process.exit(0);
}

const registeredHashPath = path.join(stateDir, "registered-manifest.sha256");
if (!existsSync(registeredHashPath) || readFileSync(registeredHashPath, "utf8").trim() !== manifestHash) {
  halt("MANIFEST_DRIFT", "manifest changed after registration; HALT and create a successor task");
}
function liveDiffState() {
  const liveHead = run("git", ["rev-parse", "HEAD"], repo);
  const liveBaseRefSha = run("git", ["rev-parse", `${baseRef}^{commit}`], repo);
  if (liveBaseRefSha !== baseSha) {
    halt("BASE_STALE", `${baseRef} advanced from ${baseSha} to ${liveBaseRefSha}`);
  }
  if (run("git", ["merge-base", baseSha, liveHead], repo) !== baseSha) {
    halt("BASE_DRIFT", "pinned base is not an ancestor of HEAD");
  }
  const commitCount = Number(run("git", ["rev-list", "--count", `${baseSha}..${liveHead}`], repo));
  if (!Number.isInteger(commitCount) || commitCount < 1) {
    halt("EMPTY_DIFF", "HEAD has no commit beyond the pinned base");
  }
  const files = run("git", ["diff", "--name-only", "--no-renames", `${baseSha}...${liveHead}`], repo)
    .split("\n")
    .filter(Boolean);
  if (files.length === 0) {
    halt("EMPTY_DIFF", "no tracked files differ from the pinned base");
  }
  const outOfScope = files.filter((file) => !scope.includes(file));
  if (outOfScope.length) {
    halt("SCOPE_DRIFT", `out-of-scope files: ${outOfScope.join(", ")}`);
  }
  const selfCertifying = files.filter((file) => TRUSTED_GATE_FILES.has(file));
  if (selfCertifying.length) {
    halt(
      "SELF_CERTIFYING_GATE_CHANGE",
      `a normal feature cannot certify changes to its own trust gate: ${selfCertifying.join(", ")}`,
    );
  }
  const dirty = run("git", ["status", "--porcelain", "--untracked-files=all"], repo)
    .split("\n")
    .filter((line) => line && !line.slice(3).startsWith(".autopilot/"));
  if (dirty.length) {
    halt("WORKTREE_DIRTY", dirty.join(" | "));
  }
  const diff = runRaw("git", ["diff", "--binary", `${baseSha}...${liveHead}`], repo);
  return { headSha: liveHead, files, diffHash: sha256(diff) };
}

const initialState = liveDiffState();
const evidenceRelative = requireString(manifest.readiness_evidence_path, "readiness_evidence_path");
const expectedEvidenceRelative = path.join(".autopilot", "state", feature, "readiness.json");
if (evidenceRelative !== expectedEvidenceRelative) {
  halt("CONTRACT_INVALID", `readiness_evidence_path must equal ${expectedEvidenceRelative}`);
}
const evidencePath = path.join(repo, evidenceRelative);
const evidence = readJson(evidencePath, "readiness evidence");
if (
  evidence.evidence_schema_version !== VERSION
  || evidence.task_id !== taskId
  || evidence.feature !== feature
  || evidence.base_sha !== baseSha
  || evidence.head_sha !== initialState.headSha
) {
  halt("EVIDENCE_STALE", "readiness evidence identity/base/head does not match the live slice");
}
if (requireObject(evidence.acceptance, "evidence.acceptance").status !== "satisfied") {
  halt("ACCEPTANCE_NOT_SATISFIED", "evidence.acceptance.status must be satisfied");
}
if (requireObject(evidence.breakers, "evidence.breakers").status !== "clear") {
  halt("BREAKER_ACTIVE", "readiness evidence reports an active breaker");
}

const counterPath = path.join(stateDir, "fix-round-count.txt");
if (!existsSync(counterPath)) {
  halt("BREAKER_EVIDENCE_MISSING", counterPath);
}
const fixRounds = Number(readFileSync(counterPath, "utf8").trim());
if (!Number.isInteger(fixRounds) || fixRounds < 0 || fixRounds > budgets.fix_rounds_max) {
  halt("MAX_ROUNDS", `fix-round-count=${fixRounds}, max=${budgets.fix_rounds_max}`);
}
const regionsPath = path.join(stateDir, "regions.log");
if (!existsSync(regionsPath)) {
  halt("BREAKER_EVIDENCE_MISSING", regionsPath);
}
const regionEntries = readFileSync(regionsPath, "utf8")
  .split(/\r?\n/)
  .map((line) => line.match(/^round-(\d+)\s+(.+)$/))
  .filter(Boolean)
  .map((match) => ({ round: Number(match[1]), region: match[2].trim() }));
const roundsByRegion = new Map();
for (const { round, region } of regionEntries) {
  if (!roundsByRegion.has(region)) roundsByRegion.set(region, new Set());
  roundsByRegion.get(region).add(round);
}
for (const [region, roundSet] of roundsByRegion) {
  const rounds = [...roundSet].sort((a, b) => a - b);
  for (let index = 2; index < rounds.length; index += 1) {
    const [a, b, c] = rounds.slice(index - 2, index + 1);
    if (b === a + 1 && c === b + 1) {
      halt("REGION_THRASH", `${region} repeated in rounds ${a}-${c}`);
    }
  }
}
const blockers = ["HALT-", "AWAIT-FOUNDER-"].flatMap((prefix) =>
  readdirSync(stateDir).filter((name) => name.startsWith(prefix)));
if (blockers.length) {
  halt("TERMINAL_CONFLICT", `remove/resume the active signal first: ${blockers.join(", ")}`);
}
const pendingFindingPath = path.join(stateDir, "pending-review-finding.json");
if (existsSync(pendingFindingPath)) {
  const pending = readJson(pendingFindingPath, "pending review finding");
  if (pending.head_sha === initialState.headSha || fixRounds <= pending.fix_round_count) {
    halt(
      "UNRESOLVED_REVIEW_FINDING",
      `review finding at ${pending.head_sha} needs a committed fix and fix-round increment before retry`,
    );
  }
}

mkdirSync(stateDir, { recursive: true });
const attemptCounterPath = path.join(stateDir, "gate-attempt-count.txt");
const priorAttempts = existsSync(attemptCounterPath)
  ? Number(readFileSync(attemptCounterPath, "utf8").trim())
  : 0;
const attempt = Number.isInteger(priorAttempts) && priorAttempts >= 0 ? priorAttempts + 1 : 1;
writeFileSync(attemptCounterPath, `${attempt}\n`);
const attemptLabel = String(attempt).padStart(2, "0");
const deadline = Date.now() + budgets.wall_time_minutes * 60_000;
const generatedArtifacts = [];

function remainingMs() {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    halt("GATE_TIMEOUT", `wall-time budget of ${budgets.wall_time_minutes} minutes exhausted`);
  }
  return remaining;
}

function isTimeout(result) {
  return result?.error?.code === "ETIMEDOUT";
}

function writeProcessLog(file, metadata, result) {
  const error = result.error ? `${result.error.name}: ${result.error.message}` : "";
  writeFileSync(
    file,
    [
      ...Object.entries(metadata).map(([key, value]) => `${key}: ${value}`),
      `exit_status: ${result.status ?? "none"}`,
      `signal: ${result.signal || "none"}`,
      `error: ${error || "none"}`,
      "",
      "----- stdout -----",
      String(result.stdout || ""),
      "----- stderr -----",
      String(result.stderr || ""),
    ].join("\n"),
  );
  generatedArtifacts.push(file);
}

function runVerificationGroup(group, commands) {
  for (const [index, command] of commands.entries()) {
    const file = path.join(
      stateDir,
      `gate-attempt-${attemptLabel}-verify-${group}-${String(index + 1).padStart(2, "0")}.txt`,
    );
    const result = spawnSync("/bin/bash", ["-lc", command], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: remainingMs(),
      maxBuffer: MAX_BUFFER,
    });
    writeProcessLog(file, {
      kind: "verification",
      group,
      command,
      base_sha: baseSha,
      head_sha: initialState.headSha,
    }, result);
    if (isTimeout(result)) {
      halt("GATE_TIMEOUT", `${group}[${index}] exceeded the remaining wall-time budget; inspect ${relativeToRepo(repo, file)}`);
    }
    if (result.error || result.status !== 0) {
      halt("VERIFICATION_FAILED", `${group}[${index}] failed; inspect ${relativeToRepo(repo, file)}`);
    }
  }
}

function runReview(kind, round, cleanMarker, findingsMarker, prompt) {
  const connectorPattern = /rmcp|mcp|transport::worker|TokenRefreshFailed/i;
  for (let invocation = 1; invocation <= 2; invocation += 1) {
    const retrySuffix = invocation === 1 ? "" : `-retry-${String(invocation - 1).padStart(2, "0")}`;
    const file = path.join(
      stateDir,
      `gate-attempt-${attemptLabel}-${kind}-round-${String(round).padStart(2, "0")}${retrySuffix}.txt`,
    );
    const result = spawnSync(reviewerPath, ["review", "--base", baseSha, prompt], {
      cwd: repo,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: remainingMs(),
      maxBuffer: MAX_BUFFER,
      env: trustedReviewEnvironment(),
    });
    writeProcessLog(file, {
      kind,
      round,
      invocation,
      tool: REVIEW_TOOL,
      base_sha: baseSha,
      head_sha: initialState.headSha,
      diff_sha256: initialState.diffHash,
    }, result);

    if (isTimeout(result)) {
      halt("GATE_TIMEOUT", `${kind} round ${round} exceeded the remaining wall-time budget; inspect ${relativeToRepo(repo, file)}`);
    }

    const rawStdout = String(result.stdout || "");
    const rawCombined = `${rawStdout}\n${String(result.stderr || "")}`;
    const stdoutWithoutConnectorNoise = rawStdout
      .split(/\r?\n/)
      .filter((line) => !connectorPattern.test(line))
      .join("\n");
    const combinedWithoutConnectorNoise = rawCombined
      .split(/\r?\n/)
      .filter((line) => !connectorPattern.test(line))
      .join("\n")
      .trim();
    const verdict = lastNonEmptyLine(stdoutWithoutConnectorNoise);

    // Verdict-first: connector shutdown noise or a nonzero wrapper exit cannot invalidate a real
    // completed model verdict.
    if (verdict === findingsMarker) {
      writeFileSync(
        pendingFindingPath,
        `${JSON.stringify({
          schema_version: "level3-pending-review-finding-v1",
          kind,
          round,
          head_sha: initialState.headSha,
          diff_sha256: initialState.diffHash,
          fix_round_count: fixRounds,
          artifact: relativeToRepo(repo, file),
        }, null, 2)}\n`,
      );
      halt("REVIEW_FINDINGS", `${kind} round ${round} returned findings; inspect ${relativeToRepo(repo, file)}`);
    }
    if (verdict === cleanMarker) return;

    if (/usage limit|Review was interrupted|try again at/i.test(rawCombined)) {
      awaitReview("CODEX_QUOTA", "CODEX-QUOTA", `review quota/interruption in ${relativeToRepo(repo, file)}; wait for reset, then resume this lifecycle`);
    }
    if (/(^|\D)401(\D|$)|token_invalidated|invalid_grant|log in again/i.test(combinedWithoutConnectorNoise)) {
      awaitReview("CODEX_AUTH_REQUIRED", "CODEX-AUTH", `reviewer authentication failed in ${relativeToRepo(repo, file)}; re-authenticate the pinned reviewer, then resume`);
    }

    const connectorOnly = connectorPattern.test(rawCombined) && !combinedWithoutConnectorNoise;
    if (connectorOnly && invocation === 1) {
      continue;
    }
    if (connectorOnly) {
      awaitReview("CODEX_CONNECTOR_PERSISTENT", "CODEX-CONNECTOR", `connector-only reviewer failure repeated in ${relativeToRepo(repo, file)}; repair/disable connectors, then resume`);
    }
    if (result.error || result.status !== 0) {
      halt("REVIEW_UNAVAILABLE", `${kind} round ${round} failed without a valid verdict; inspect ${relativeToRepo(repo, file)}`);
    }
    halt("REVIEW_VERDICT_INVALID", `${kind} round ${round} lacks exact clean marker; inspect ${relativeToRepo(repo, file)}`);
  }
}

runVerificationGroup("focused", verification.focused);
runVerificationGroup("canonical", verification.canonical);
runVerificationGroup("e2e", verification.e2e);

const codePrompt = [
  `Review the exact non-empty diff against base ${baseSha} for correctness, regressions, tests and scope.`,
  "Report every actionable finding before the verdict.",
  "The LAST non-empty line must be exactly one of:",
  "AUTOPILOT_CODE_VERDICT: CLEAN",
  "AUTOPILOT_CODE_VERDICT: FINDINGS",
  "Use CLEAN only when there are zero actionable findings.",
].join("\n");
for (let round = 1; round <= codeReview.clean_rounds; round += 1) {
  runReview(
    "code-review",
    round,
    "AUTOPILOT_CODE_VERDICT: CLEAN",
    "AUTOPILOT_CODE_VERDICT: FINDINGS",
    codePrompt,
  );
}

if (securityReview.required) {
  const securityPrompt = [
    `Security-review the exact non-empty diff against base ${baseSha}.`,
    "Check trust boundaries, auth, secrets, permissions, external input, money and deployment effects.",
    "Report every actionable finding before the verdict.",
    "The LAST non-empty line must be exactly one of:",
    "AUTOPILOT_SECURITY_VERDICT: CLEAN",
    "AUTOPILOT_SECURITY_VERDICT: FINDINGS",
    "Use CLEAN only when there are zero actionable security findings.",
  ].join("\n");
  runReview(
    "security-review",
    1,
    "AUTOPILOT_SECURITY_VERDICT: CLEAN",
    "AUTOPILOT_SECURITY_VERDICT: FINDINGS",
    securityPrompt,
  );
}

const finalState = liveDiffState();
if (
  finalState.headSha !== initialState.headSha
  || finalState.diffHash !== initialState.diffHash
  || finalState.files.join("\n") !== initialState.files.join("\n")
) {
  halt("GATE_INPUT_DRIFT", "HEAD or diff changed while verification/review was running");
}
if (existsSync(pendingFindingPath)) {
  unlinkSync(pendingFindingPath);
}

const gateResultPath = path.join(stateDir, "gate-result.json");
writeFileSync(
  gateResultPath,
  `${JSON.stringify({
    gate_schema_version: VERSION,
    task_id: taskId,
    feature,
    base_ref: baseRef,
    base_sha: baseSha,
    head_sha: finalState.headSha,
    diff_sha256: finalState.diffHash,
    diff_files: finalState.files,
    manifest_sha256: manifestHash,
    attempt,
    generated_artifacts: generatedArtifacts.map((file) => artifactRecord(repo, file)),
    result: "pass",
  }, null, 2)}\n`,
);

process.stdout.write(
  `LEVEL3_READINESS_PASS task=${taskId} feature=${feature} base=${baseSha} head=${finalState.headSha} files=${finalState.files.length}\n`,
);
