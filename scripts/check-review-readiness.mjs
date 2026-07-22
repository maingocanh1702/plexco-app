#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const REVIEW_POLICY_VERSION = "1.3";

const DIRECTIVE_RE =
  /<!--\s*review-readiness:\s*(code-ready|enforce|historical|criteria|policy|template)\s*-->/i;
const HISTORICAL_BLOCK_RE =
  /<!--\s*review-verdict:\s*historical\s*-->\s*$/i;
const CANDIDATE_NAME_RE = /(^|[-_.])(review|readiness|plan)([-_.]|$)/i;

export const REQUIRED_FIELDS = [
  "REVIEW_POLICY_VERSION",
  "REVIEW_VERDICT",
  "REVIEWED_AT",
  "AUTHORITY_SHA",
  "BASE_BRANCH",
  "TARGET_FILES",
  "SLICE",
  "IN_SCOPE",
  "OUT_OF_SCOPE",
  "G1_DECISION",
  "G2_SPEC",
  "G3_DEPENDENCY",
  "G4_TEST",
  "G5_SCOPE",
  "G6_EXTERNAL",
  "HARD_DEPENDENCIES",
  "PRIOR_SLICES",
  "OPEN_QUESTIONS_IN_SCOPE",
  "ENABLEMENT_ONLY_GATES",
  "LIVE_REPO_VERIFICATION",
  "CONTRACT_MATRIX",
  "CLOSURE_MATRIX",
  "ACCEPTANCE_MATRIX",
  "SECURITY_AND_MIGRATION_GATE",
  "IMPLEMENTATION_ARTIFACTS",
  "FIRST_IMPLEMENTATION_STEP",
  "REMAINING_BLOCKERS",
];

const ENUMS = {
  REVIEW_VERDICT: new Set([
    "PLAN_READY",
    "CODE_READY",
    "NOT_PLAN_READY",
    "NOT_CODE_READY",
  ]),
  G1_DECISION: new Set(["PASS", "FAIL"]),
  G2_SPEC: new Set(["PASS", "PARTIAL", "FAIL"]),
  G3_DEPENDENCY: new Set(["PASS", "FAIL"]),
  G4_TEST: new Set(["PASS", "PARTIAL", "FAIL"]),
  G5_SCOPE: new Set(["PASS", "PARTIAL", "FAIL"]),
  LIVE_REPO_VERIFICATION: new Set(["PASS", "FAIL"]),
  CONTRACT_MATRIX: new Set(["PASS", "PARTIAL", "FAIL"]),
  CLOSURE_MATRIX: new Set(["PASS", "PARTIAL", "FAIL"]),
  ACCEPTANCE_MATRIX: new Set(["PASS", "FAIL"]),
  SECURITY_AND_MIGRATION_GATE: new Set(["PASS", "PARTIAL", "FAIL"]),
  IMPLEMENTATION_ARTIFACTS: new Set([
    "PASS",
    "FAIL",
    "NOT_REQUIRED_FOR_PLAN_READY",
  ]),
};

function firstToken(value) {
  return value.trim().split(/[\s#(]/, 1)[0];
}

function addError(errors, file, line, code, message) {
  errors.push({ file, line, code, message });
}

function parseFieldSections(raw) {
  const sections = new Map();
  let current = null;

  for (const line of raw.split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]+):(?:\s*(.*))?$/);
    if (match) {
      current = match[1];
      if (!sections.has(current)) sections.set(current, []);
      sections.get(current).push(match[2] ?? "");
    } else if (current) {
      sections.get(current).push(line);
    }
  }

  return sections;
}

function sectionValue(sections, key) {
  return (sections.get(key) ?? []).join("\n").trim();
}

function extractVerdictBlocks(content) {
  const blocks = [];
  const fenceRe = /```(?:text)?[^\n]*\n([\s\S]*?)```/g;
  let match;

  while ((match = fenceRe.exec(content)) !== null) {
    if (!/^REVIEW_POLICY_VERSION:/m.test(match[1]) && !/^REVIEW_VERDICT:/m.test(match[1])) {
      continue;
    }

    const prefix = content.slice(Math.max(0, match.index - 320), match.index);
    blocks.push({
      raw: match[1],
      line: content.slice(0, match.index).split("\n").length + 1,
      historical: HISTORICAL_BLOCK_RE.test(prefix),
    });
  }

  return blocks;
}

function targetEntries(sections) {
  return (sections.get("TARGET_FILES") ?? [])
    .slice(1)
    .map((line) => line.match(/^\s*-\s+(.+?)\s*$/)?.[1])
    .filter(Boolean);
}

function normalizeTargetPath(entry) {
  const clean = entry.replaceAll("`", "").trim();
  const match = clean.match(/^([A-Za-z0-9_./-]+)(?:\s|$)/);
  return match?.[1] ?? null;
}

function gitSucceeds(repoRoot, args) {
  try {
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: repoRoot,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

function validateAuthority({ errors, file, line, value, repoRoot, gitCheck }) {
  const match = value.match(/^([0-9a-f]{40})(?:\s|\(|$)/);
  if (!match) {
    addError(
      errors,
      file,
      line,
      "AUTHORITY_SHA",
      "AUTHORITY_SHA must start with a full 40-character lowercase commit SHA.",
    );
    return;
  }

  if (!gitCheck) return;
  const sha = match[1];
  if (!gitSucceeds(repoRoot, ["cat-file", "-e", `${sha}^{commit}`])) {
    addError(
      errors,
      file,
      line,
      "AUTHORITY_SHA_UNKNOWN",
      `AUTHORITY_SHA ${sha} is not a commit available in this checkout.`,
    );
  } else if (!gitSucceeds(repoRoot, ["merge-base", "--is-ancestor", sha, "main"])) {
    addError(
      errors,
      file,
      line,
      "AUTHORITY_NOT_MAIN",
      `AUTHORITY_SHA ${sha} is not an ancestor of main.`,
    );
  }
}

function validateTargets({ errors, file, line, sections, repoRoot, checkPaths }) {
  const entries = targetEntries(sections);
  if (entries.length === 0) {
    addError(
      errors,
      file,
      line,
      "TARGET_FILES_EMPTY",
      "TARGET_FILES must contain at least one exact path.",
    );
    return;
  }

  for (const entry of entries) {
    if (/[*?[\]]/.test(entry)) {
      addError(
        errors,
        file,
        line,
        "TARGET_FILES_GLOB",
        `TARGET_FILES must use exact paths, not a glob: ${entry}`,
      );
      continue;
    }

    const target = normalizeTargetPath(entry);
    if (!target || path.isAbsolute(target) || target.startsWith("../")) {
      addError(
        errors,
        file,
        line,
        "TARGET_FILES_PATH",
        `Invalid repository-relative target path: ${entry}`,
      );
      continue;
    }

    if (checkPaths && !fs.existsSync(path.join(repoRoot, target))) {
      addError(
        errors,
        file,
        line,
        "TARGET_FILES_MISSING",
        `Target path does not exist in the working tree: ${target}`,
      );
    }
  }
}

function validateBlock({
  block,
  file,
  repoRoot,
  gitCheck = true,
  checkPaths = true,
}) {
  const errors = [];
  const sections = parseFieldSections(block.raw);

  for (const field of REQUIRED_FIELDS) {
    if (!sections.has(field)) {
      addError(
        errors,
        file,
        block.line,
        "FIELD_MISSING",
        `Missing mandatory field ${field}.`,
      );
    }
  }

  if (errors.length > 0) return errors;

  const value = (key) => sectionValue(sections, key);
  if (firstToken(value("REVIEW_POLICY_VERSION")) !== REVIEW_POLICY_VERSION) {
    addError(
      errors,
      file,
      block.line,
      "POLICY_VERSION",
      `REVIEW_POLICY_VERSION must be ${REVIEW_POLICY_VERSION}.`,
    );
  }

  for (const [field, allowed] of Object.entries(ENUMS)) {
    const actual = firstToken(value(field));
    if (!allowed.has(actual)) {
      addError(
        errors,
        file,
        block.line,
        "ENUM",
        `${field} must be one of ${[...allowed].join(" | ")}; got ${actual || "<empty>"}.`,
      );
    }
  }

  const g6 = firstToken(value("G6_EXTERNAL"));
  if (g6 !== "PASS" && g6 !== "FAIL" && !g6.startsWith("ENABLEMENT_ONLY:")) {
    addError(
      errors,
      file,
      block.line,
      "G6_EXTERNAL",
      "G6_EXTERNAL must be PASS, FAIL, or ENABLEMENT_ONLY:<named-gates>.",
    );
  }

  if (!/^\d{4}-\d{2}-\d{2}(?:\s|$)/.test(value("REVIEWED_AT"))) {
    addError(
      errors,
      file,
      block.line,
      "REVIEWED_AT",
      "REVIEWED_AT must start with an ISO YYYY-MM-DD date.",
    );
  }

  validateAuthority({
    errors,
    file,
    line: block.line,
    value: value("AUTHORITY_SHA"),
    repoRoot,
    gitCheck,
  });

  if (firstToken(value("BASE_BRANCH")) !== "main") {
    addError(
      errors,
      file,
      block.line,
      "BASE_BRANCH",
      "BASE_BRANCH must be the actual default branch main.",
    );
  }

  validateTargets({
    errors,
    file,
    line: block.line,
    sections,
    repoRoot,
    checkPaths,
  });

  const slice = firstToken(value("SLICE"));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(slice)) {
    addError(
      errors,
      file,
      block.line,
      "SLICE",
      "SLICE must start with a mechanism-named lowercase kebab-case slug.",
    );
  }

  for (const field of ["IN_SCOPE", "OUT_OF_SCOPE", "FIRST_IMPLEMENTATION_STEP"]) {
    const actual = value(field);
    if (!actual || /^<[^>\n]+>$/.test(actual.trim()) || /\bTBD\b/i.test(actual)) {
      addError(
        errors,
        file,
        block.line,
        "PLACEHOLDER",
        `${field} must be concrete and contain no placeholder/TBD.`,
      );
    }
  }

  const openQuestions = Number.parseInt(value("OPEN_QUESTIONS_IN_SCOPE"), 10);
  if (!Number.isInteger(openQuestions) || openQuestions < 0) {
    addError(
      errors,
      file,
      block.line,
      "OPEN_QUESTIONS",
      "OPEN_QUESTIONS_IN_SCOPE must start with a non-negative integer.",
    );
  }

  const verdict = firstToken(value("REVIEW_VERDICT"));
  const tokens = Object.fromEntries(
    [
      "G1_DECISION",
      "G2_SPEC",
      "G3_DEPENDENCY",
      "G4_TEST",
      "G5_SCOPE",
      "LIVE_REPO_VERIFICATION",
      "CONTRACT_MATRIX",
      "CLOSURE_MATRIX",
      "ACCEPTANCE_MATRIX",
      "SECURITY_AND_MIGRATION_GATE",
      "IMPLEMENTATION_ARTIFACTS",
    ].map((key) => [key, firstToken(value(key))]),
  );

  if (verdict === "CODE_READY") {
    const requiredPass = [
      "G1_DECISION",
      "G2_SPEC",
      "G3_DEPENDENCY",
      "G4_TEST",
      "G5_SCOPE",
      "LIVE_REPO_VERIFICATION",
      "CONTRACT_MATRIX",
      "CLOSURE_MATRIX",
      "ACCEPTANCE_MATRIX",
      "SECURITY_AND_MIGRATION_GATE",
      "IMPLEMENTATION_ARTIFACTS",
    ];
    for (const field of requiredPass) {
      if (tokens[field] !== "PASS") {
        addError(
          errors,
          file,
          block.line,
          "CODE_READY_GATE",
          `CODE_READY requires ${field}: PASS.`,
        );
      }
    }
    if (g6 !== "PASS" && !g6.startsWith("ENABLEMENT_ONLY:")) {
      addError(
        errors,
        file,
        block.line,
        "CODE_READY_G6",
        "CODE_READY requires G6_EXTERNAL PASS or named ENABLEMENT_ONLY gates.",
      );
    }
    if (openQuestions !== 0) {
      addError(
        errors,
        file,
        block.line,
        "CODE_READY_OQ",
        "CODE_READY requires OPEN_QUESTIONS_IN_SCOPE: 0.",
      );
    }
    if (!/^none(?:\s|$|\u2014)/i.test(value("REMAINING_BLOCKERS"))) {
      addError(
        errors,
        file,
        block.line,
        "CODE_READY_BLOCKERS",
        "CODE_READY requires REMAINING_BLOCKERS: none.",
      );
    }
    if (/\b(blocked|not merged|pending|chưa merge)\b/i.test(value("FIRST_IMPLEMENTATION_STEP"))) {
      addError(
        errors,
        file,
        block.line,
        "CODE_READY_FIRST_STEP",
        "CODE_READY requires an executable, unblocked FIRST_IMPLEMENTATION_STEP.",
      );
    }
  }

  if (verdict === "PLAN_READY") {
    for (const field of [
      "G1_DECISION",
      "G2_SPEC",
      "G5_SCOPE",
      "LIVE_REPO_VERIFICATION",
      "CONTRACT_MATRIX",
    ]) {
      if (tokens[field] !== "PASS") {
        addError(
          errors,
          file,
          block.line,
          "PLAN_READY_GATE",
          `PLAN_READY requires ${field}: PASS.`,
        );
      }
    }
    if (openQuestions !== 0) {
      addError(
        errors,
        file,
        block.line,
        "PLAN_READY_OQ",
        "PLAN_READY requires OPEN_QUESTIONS_IN_SCOPE: 0.",
      );
    }
  }

  if (verdict === "NOT_PLAN_READY" || verdict === "NOT_CODE_READY") {
    const blockerCount = (block.raw.match(/^\s*-\s+blocker:/gm) ?? []).length;
    const ownerCount = (block.raw.match(/^\s+owner:/gm) ?? []).length;
    const resolutionCount = (block.raw.match(/^\s+resolution:/gm) ?? []).length;
    if (blockerCount === 0 || ownerCount < blockerCount || resolutionCount < blockerCount) {
      addError(
        errors,
        file,
        block.line,
        "FAIL_BLOCKERS",
        "A NOT_* verdict requires each blocker to have blocker, owner, and binary resolution fields.",
      );
    }
    if (!sections.has("NEXT_REVIEW_TRIGGER") || !value("NEXT_REVIEW_TRIGGER")) {
      addError(
        errors,
        file,
        block.line,
        "NEXT_REVIEW_TRIGGER",
        "A NOT_* verdict requires a concrete NEXT_REVIEW_TRIGGER.",
      );
    }
  }

  return errors;
}

export function validateReviewDocument({
  file,
  content,
  repoRoot = process.cwd(),
  gitCheck = true,
  checkPaths = true,
}) {
  const errors = [];
  const firstLines = content.split("\n").slice(0, 30).join("\n");
  const directive = firstLines.match(DIRECTIVE_RE)?.[1]?.toLowerCase() ?? null;
  const hasVerdict = /^REVIEW_VERDICT:/m.test(content);
  const candidate = CANDIDATE_NAME_RE.test(path.basename(file)) || hasVerdict;

  if (!candidate) return { errors, directive: null, activeBlocks: 0 };

  if (!directive) {
    addError(
      errors,
      file,
      1,
      "DIRECTIVE_MISSING",
      "Review/readiness/plan documents must declare <!-- review-readiness: code-ready|enforce|historical|criteria|policy|template --> in the first 30 lines.",
    );
    return { errors, directive: null, activeBlocks: 0 };
  }

  if (directive !== "enforce" && directive !== "code-ready") {
    return { errors, directive, activeBlocks: 0 };
  }

  const blocks = extractVerdictBlocks(content);
  const activeBlocks = blocks.filter((block) => !block.historical);
  if (activeBlocks.length === 0) {
    addError(
      errors,
      file,
      1,
      "VERDICT_MISSING",
      "An enforced review document must contain at least one active fenced canonical verdict block.",
    );
  }

  for (const block of activeBlocks) {
    errors.push(
      ...validateBlock({ block, file, repoRoot, gitCheck, checkPaths }),
    );
    if (
      directive === "code-ready" &&
      firstToken(
        sectionValue(parseFieldSections(block.raw), "REVIEW_VERDICT"),
      ) !== "CODE_READY"
    ) {
      addError(
        errors,
        file,
        block.line,
        "PLAN_NOT_CODE_READY",
        "A code-ready plan artifact may contain only active CODE_READY verdicts; use enforce for a draft/blocker audit that must not authorize coding.",
      );
    }
  }

  return { errors, directive, activeBlocks: activeBlocks.length };
}

function walkMarkdown(directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkMarkdown(absolute));
    else if (entry.isFile() && entry.name.endsWith(".md")) files.push(absolute);
  }
  return files;
}

function gitOutput(repoRoot, args) {
  try {
    return execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function changedMarkdown(repoRoot) {
  const changed = gitOutput(repoRoot, [
    "diff",
    "--name-only",
    "--diff-filter=ACMR",
    "HEAD",
    "--",
    "docs",
  ]);
  const untracked = gitOutput(repoRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    "docs",
  ]);
  return [...new Set(`${changed}\n${untracked}`.split("\n").filter((file) => file.endsWith(".md")))];
}

function readRequired(repoRoot, relative, errors) {
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) {
    addError(errors, relative, 1, "WIRING_MISSING", `Required policy file is missing: ${relative}`);
    return "";
  }
  return fs.readFileSync(absolute, "utf8");
}

export function validatePolicyWiring(repoRoot = process.cwd()) {
  const errors = [];
  const agents = readRequired(repoRoot, "AGENTS.md", errors);
  const claude = readRequired(repoRoot, "CLAUDE.md", errors);
  const gate = readRequired(
    repoRoot,
    "docs/standards/review-code-readiness-gate.md",
    errors,
  );
  const template = readRequired(
    repoRoot,
    "docs/templates/review-doc-plan-session-template.md",
    errors,
  );
  const launcher = readRequired(
    repoRoot,
    ".claude/commands/review-doc-plan.md",
    errors,
  );
  const ci = readRequired(repoRoot, ".github/workflows/ci.yml", errors);
  const prTemplate = readRequired(
    repoRoot,
    ".github/PULL_REQUEST_TEMPLATE.md",
    errors,
  );

  for (const [file, content] of [
    ["AGENTS.md", agents],
    ["CLAUDE.md", claude],
    [".claude/commands/review-doc-plan.md", launcher],
  ]) {
    for (const token of [
      "REVIEW_POLICY_VERSION",
      "CLOSURE_MATRIX",
      "review-readiness: code-ready",
      "pnpm review:check:changed",
    ]) {
      if (!content.includes(token)) {
        addError(
          errors,
          file,
          1,
          "WIRING_TOKEN",
          `${file} must require ${token}.`,
        );
      }
    }
  }

  if (!gate.includes(`Version:** ${REVIEW_POLICY_VERSION}`)) {
    addError(
      errors,
      "docs/standards/review-code-readiness-gate.md",
      1,
      "GATE_VERSION",
      `Canonical gate version must be ${REVIEW_POLICY_VERSION}.`,
    );
  }
  if (!gate.includes("<!-- review-readiness: policy -->")) {
    addError(
      errors,
      "docs/standards/review-code-readiness-gate.md",
      1,
      "GATE_DIRECTIVE",
      "Canonical gate must declare the policy directive.",
    );
  }
  if (!template.includes("<!-- review-readiness: template -->")) {
    addError(
      errors,
      "docs/templates/review-doc-plan-session-template.md",
      1,
      "TEMPLATE_DIRECTIVE",
      "Session template must declare the template directive.",
    );
  }

  let packageJson = {};
  try {
    packageJson = JSON.parse(readRequired(repoRoot, "package.json", errors));
  } catch {
    addError(errors, "package.json", 1, "PACKAGE_JSON", "package.json must be valid JSON.");
  }
  const scripts = packageJson.scripts ?? {};
  for (const name of [
    "review:check",
    "review:check:changed",
    "test:review-readiness",
  ]) {
    if (!scripts[name]) {
      addError(errors, "package.json", 1, "PACKAGE_SCRIPT", `Missing package script ${name}.`);
    }
  }

  if (!ci.includes("pnpm -w review:check")) {
    addError(
      errors,
      ".github/workflows/ci.yml",
      1,
      "CI_WIRING",
      "CI must run pnpm -w review:check.",
    );
  }
  if (!prTemplate.includes("Review-readiness validator")) {
    addError(
      errors,
      ".github/PULL_REQUEST_TEMPLATE.md",
      1,
      "PR_WIRING",
      "PR template must include the Review-readiness validator checklist item.",
    );
  }

  try {
    const settings = JSON.parse(
      readRequired(repoRoot, ".claude/settings.json", errors),
    );
    const serialized = JSON.stringify(settings);
    if (!settings.hooks?.Stop || !serialized.includes("review:check:changed")) {
      addError(
        errors,
        ".claude/settings.json",
        1,
        "CLAUDE_HOOK",
        "Claude project settings must block Stop on pnpm review:check:changed failures.",
      );
    }
  } catch {
    addError(
      errors,
      ".claude/settings.json",
      1,
      "CLAUDE_SETTINGS",
      ".claude/settings.json must be valid JSON.",
    );
  }

  return errors;
}

export function validateRepository({
  repoRoot = process.cwd(),
  mode = "all",
  gitCheck = true,
  checkPaths = true,
} = {}) {
  const errors = validatePolicyWiring(repoRoot);
  const docsRoot = path.join(repoRoot, "docs");
  const relativeFiles =
    mode === "changed"
      ? changedMarkdown(repoRoot)
      : walkMarkdown(docsRoot).map((file) => path.relative(repoRoot, file));
  let activeBlocks = 0;
  let candidates = 0;

  for (const relative of relativeFiles.sort()) {
    const absolute = path.join(repoRoot, relative);
    if (!fs.existsSync(absolute)) continue;
    const content = fs.readFileSync(absolute, "utf8");
    const result = validateReviewDocument({
      file: relative,
      content,
      repoRoot,
      gitCheck,
      checkPaths,
    });
    if (result.directive || result.errors.length > 0) candidates += 1;
    activeBlocks += result.activeBlocks;
    errors.push(...result.errors);
  }

  return { errors, files: relativeFiles.length, candidates, activeBlocks };
}

function main() {
  const args = new Set(process.argv.slice(2));
  const mode = args.has("--changed") ? "changed" : "all";
  const hook = args.has("--hook");
  const result = validateRepository({ mode });

  if (result.errors.length > 0) {
    for (const error of result.errors) {
      process.stderr.write(
        `${error.file}:${error.line} [${error.code}] ${error.message}\n`,
      );
    }
    process.stderr.write(
      `review-readiness: FAIL (${result.errors.length} error(s)); fix before verdict/commit.\n`,
    );
    process.exitCode = hook ? 2 : 1;
    return;
  }

  process.stdout.write(
    `review-readiness: PASS (${result.candidates} classified document(s), ${result.activeBlocks} active verdict block(s), mode=${mode})\n`,
  );
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) main();
