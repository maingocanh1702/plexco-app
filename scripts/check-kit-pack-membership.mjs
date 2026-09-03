#!/usr/bin/env node
// kit pack membership — JSON is the authority, Markdown is generated output.
//
//   node scripts/check-kit-pack-membership.mjs --audit               (pnpm kit:check)
//   node scripts/check-kit-pack-membership.mjs --audit --strict-generated
//   node scripts/check-kit-pack-membership.mjs --generate --write    (pnpm kit:generate)
//
// Exit: 0 pass · 1 the repository and the authority disagree · 2 the check could not run.
//
// WHY THE SUBSTRATE IS JSON. A predecessor kept the list in the Markdown table and parsed it. It
// HALTed REGION_THRASH after three review rounds closing successively finer Markdown boundaries —
// no delimiters, then delimiters that ignored fences, then a fence-closing rule that missed info
// strings. The remaining edge set is bounded by the CommonMark specification (HTML blocks, link
// reference definitions, setext headings, lazy continuation, tabs-as-indentation), not by how
// carefully the next patch is written, and no round proved it empty.
//
// So: nothing here parses Markdown to establish a fact. The .md file is opened for exactly one
// purpose — a byte comparison against freshly generated output. Drift cannot be *detected wrongly*
// because drift cannot *exist*: the document is a function of the data.
//
// If a future task appears to need a fact read out of the .md, that is the old defect returning.
// Stop and report; do not write a smarter reader.

import { readFileSync, readdirSync, existsSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const JSON_PATH = "docs/standards/kit-pack-membership.json";
export const DOC_PATH = "docs/standards/kit-pack-membership.md";
export const SCRIPTS_DIR = "scripts";

class CheckError extends Error {}

export function loadAuthority(repoRoot) {
  const abs = path.join(repoRoot, JSON_PATH);
  if (!existsSync(abs)) throw new CheckError(`${JSON_PATH} not found; it is the authority.`);
  let data;
  try {
    data = JSON.parse(readFileSync(abs, "utf8"));
  } catch (err) {
    throw new CheckError(`${JSON_PATH} is not valid JSON: ${err.message}`);
  }
  const files = data.files;
  if (!Array.isArray(files) || files.length === 0) {
    throw new CheckError(`${JSON_PATH} has no "files" array; refusing to treat that as an empty kit.`);
  }
  if (!Array.isArray(data.pack_pairs_verbatim) || data.pack_pairs_verbatim.length === 0) {
    throw new CheckError(`${JSON_PATH} has no "pack_pairs_verbatim"; that list IS the membership authority.`);
  }

  // OWNERSHIP IS DERIVED, NEVER STORED. `pack_pairs_verbatim` is the transcription of canonical, so
  // it is the single fact; `owner` and `evidence` are functions of it. An earlier revision stored
  // `owner` alongside it and nothing cross-checked the two — a probe flipped scripts/autopilot-scope-gate
  // to repo-owned while it stayed in pack_pairs, and the audit passed while the generated page told
  // contributors a synchronised file was safe to edit. Two representations of one fact drift; the
  // fix is to have one. (Same move as generating the Markdown instead of comparing it.)
  const destinations = new Set(
    data.pack_pairs_verbatim.map((line) => {
      const parts = String(line).split(":");
      if (parts.length < 2 || !parts[1]) throw new CheckError(`malformed pack_pairs entry: ${line}`);
      return parts[1];
    }),
  );

  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f.path !== "string" || !f.path) throw new CheckError(`a record has no path`);
    if (seen.has(f.path)) throw new CheckError(`${f.path} appears twice; one file, one record`);
    seen.add(f.path);
    if (typeof f.kit_version_header !== "boolean") {
      throw new CheckError(`${f.path}: kit_version_header must be a boolean (presence, never a value)`);
    }
    if ("owner" in f || "evidence" in f) {
      throw new CheckError(
        `${f.path}: owner/evidence are DERIVED from pack_pairs_verbatim and must not be stored. ` +
          "Storing them lets the authority contradict itself.",
      );
    }

    f.owner = destinations.has(f.path) ? "kit-owned" : "repo-owned";
    f.evidence = destinations.has(f.path) ? "present in `pack_pairs`" : "absent from `pack_pairs`";

    // overwrite_path/latency stay stored so the record is readable on its own, but they are checked
    // against what ownership implies rather than believed.
    const expected = f.owner === "kit-owned" ? "kit-sync" : "none";
    if (f.overwrite_path !== expected) {
      throw new CheckError(
        `${f.path}: overwrite_path is ${JSON.stringify(f.overwrite_path)} but membership implies ` +
          `${JSON.stringify(expected)}. Fix the record, or fix pack_pairs_verbatim if canonical changed.`,
      );
    }
    if (!f.overwrite_latency) throw new CheckError(`${f.path}: overwrite_latency is required`);
  }

  // Every synchronised destination must have a record, or the page silently omits a file a sync
  // overwrites — the exact question this document exists to answer.
  const missingRecords = [...destinations].filter((d) => !seen.has(d)).sort();
  if (missingRecords.length) {
    throw new CheckError(
      `pack_pairs_verbatim names destinations with no record: ${missingRecords.join(", ")}`,
    );
  }
  return data;
}

/** Every file under scripts/ must have exactly one record, and every scripts/ record must exist. */
export function auditCoverage(files, actualFiles) {
  const listed = new Set(files.map((f) => f.path).filter((p) => p.startsWith(`${SCRIPTS_DIR}/`)));
  const actual = new Set(actualFiles);
  return {
    missing: [...actual].filter((p) => !listed.has(p)).sort(),
    stale: [...listed].filter((p) => !actual.has(p)).sort(),
  };
}

/** Recursive; symlinks are entries to classify but are never followed. */
export function listScriptFiles(repoRoot, dir = SCRIPTS_DIR) {
  const out = [];
  for (const entry of readdirSync(path.join(repoRoot, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listScriptFiles(repoRoot, rel));
    else out.push(rel);
  }
  return out.sort();
}

const cell = (s) => String(s ?? "").replace(/\|/g, "\\|");

// Header PRESENCE only, never the value. A generator that snapshots version numbers into the
// document buries hand-copied numbers in generated output — the exact rot this file guards against,
// and a defect a predecessor shipped (CLAUDE.md:180 forbids hard-pinning kit versions in prose).
const headerCell = (f) => (f.kit_version_header ? "present — read it, do not copy it" : "none");

function ownershipTable(files, predicate) {
  const rows = files.filter(predicate);
  return [
    "| File | Owner | Evidence | Overwritten by | Latency | `KIT_VERSION` header |",
    "|---|---|---|---|---|---|",
    ...rows.map(
      (f) =>
        `| \`${cell(f.path)}\` | **${cell(f.owner)}** | ${cell(f.evidence)} | ${cell(f.overwrite_path)} | ${cell(f.overwrite_latency)} | ${headerCell(f)} |`,
    ),
  ].join("\n");
}

function notesFor(files) {
  const withNotes = files.filter((f) => f.note);
  if (!withNotes.length) return "";
  return ["", ...withNotes.map((f) => `- **\`${f.path}\`** — ${f.note}`)].join("\n");
}

export function generate(data) {
  const f = data.files;
  const p = data.provenance;
  const m = data.overwrite_mechanisms || {};
  const inScripts = (r) => r.path.startsWith(`${SCRIPTS_DIR}/`);

  const mechRows = Object.entries(m).map(
    ([name, v]) =>
      `| \`${cell(name)}\` | **${cell(v.status)}** | ${cell(v.invoked_by)} | ${cell(v.latency)} | ${cell(v.measured_on)} |`,
  );

  return `<!-- GENERATED FROM ${JSON_PATH} — DO NOT EDIT BY HAND. Run \`pnpm kit:generate\`. -->

# Kit pack membership — will the next kit sync overwrite my edit?

**Audience:** anyone, human or agent, about to edit a file under \`scripts/\`.

> **If I edit this file, will the next kit sync silently overwrite my edit?**

**kit-owned** = yes. Fix it in canonical, not here.  **repo-owned** = no; it is ours, edit freely.

This page is **generated** from \`${JSON_PATH}\`, which is the only machine-read authority. Editing
this file by hand does nothing durable: \`pnpm kit:check\` regenerates it and byte-compares, so your
edit shows up as a failure rather than as a fact. Change the JSON.

---

## 0. Threat model — what this defends against, and what it does not

This defends against ONE thing: **editing a kit-owned file without knowing it is kit-owned**, where
the next sync would silently erase the work. That is a knowledge failure, closed by making the answer
available and keeping it correct.

It does NOT defend against anyone who already knows. Deliberate and not a gap to be closed later.
**Out of scope BY DESIGN — evasion by an informed actor:**

- \`--no-verify\` and equivalent escape hatches;
- editing the authority file itself, which is repo-owned like everything else here;
- a merge commit whose second parent carries an unclassified change.

**A finding that this can be circumvented by someone who knows about it is CONTESTED, not accepted:
Tier C item 8. Do not open a fix round for it.** Cite this section and say the boundary was declared,
not overlooked. Across two predecessor lanes this paragraph held for **eleven consecutive review
rounds** with zero re-derivations of that class; the lane that lacked it spent three of five rounds
there and died of it.

**Distinguish that from COVERAGE, which is in scope.** Someone who would have wanted to know, and was
not told, is a coverage gap — findings **accepted**. The test is intent, not mechanism: *would this
person have wanted to know?*

---

## 1. The trap: the \`KIT_VERSION\` header does NOT determine membership

The obvious rule — "files with a \`# KIT_VERSION:\` header are kit files" — is wrong in the direction
that loses work. \`scripts/autopilot-review-readiness.mjs\` carries **no** header and **is** a pack
member; it is also the most-patched kit file in this repo's history.

Mechanically, the updater reads a \`KIT_VERSION\` header from exactly one file,
\`scripts/autopilot-scope-gate\`, to version-gate the whole pack. Headers on the other files are never
read by it at all. A field consulted for one file cannot describe another file's membership.

This page therefore records header **presence**, never the number. To read a current value, measure
it — do not copy it from here:

\`\`\`bash
awk '/^# KIT_VERSION:/{print $3; exit}' scripts/autopilot-scope-gate
\`\`\`

---

## 2. Authority and provenance — re-verify, do not trust

| Field | Value |
|---|---|
| Canonical repository | ${cell(p.canonical_repo)} |
| **Canonical commit read at** | \`${cell(p.canonical_commit_read_at)}\` |
| Also verified identical at | \`${cell(p.also_verified_identical_at)}\` |
| Authority file | ${cell(p.authority_file)} |
| Measured on | ${cell(p.measured_on)} |

${p.note}

Re-verify with:

\`\`\`bash
${p.reverify_command}
\`\`\`

### \`pack_pairs()\`, verbatim and unreordered

\`\`\`text
${data.pack_pairs_verbatim.join("\n")}
\`\`\`

---

## 3. Overwrite mechanisms — and which are actually running

**A mechanism counts as ACTIVE only when its wiring point is measured**: who invokes it, where, and
an observed run or failure. Reading its code is not enough; a document describing it is not enough.

| Mechanism | Status | Invoked by | Latency | Measured |
|---|---|---|---|---|
${mechRows.join("\n")}

${Object.entries(m)
  .map(
    ([name, v]) =>
      `**\`${name}\`** — ${v.wiring_evidence}${v.stale_by_construction ? `\n\n> ⚠️ **Stale by construction.** ${v.stale_reason}` : ""}${v.history ? `\n>\n> *History:* ${v.history}` : ""}`,
  )
  .join("\n\n")}

---

## 4. Every file under \`scripts/\`

${ownershipTable(f, inScripts)}
${notesFor(f.filter(inScripts))}

---

## 5. Pack targets outside \`scripts/\`

Overwritten by a sync exactly like the ones above — the answer must not depend on which directory a
file happens to sit in.

${ownershipTable(f, (r) => !inScripts(r))}
${notesFor(f.filter((r) => !inScripts(r)))}

---

## 6. What is checked, and what is not

\`\`\`bash
pnpm kit:check      # authority vs scripts/, and this page vs the authority
pnpm kit:generate   # rewrite this page from the authority
\`\`\`

\`kit:check\` runs inside \`pnpm -w test\`, which is what CI executes, so both failures turn the build
red. It verifies two properties:

1. **Coverage** — every file under \`scripts/\` has exactly one record, and every \`scripts/\` record
   names a file that still exists. A new script nobody classified fails the build.
2. **Generation** — this page is byte-identical to what the authority generates. A hand-edit fails
   the build rather than becoming a silent fact.

**Not checked:** whether a kit-owned file was edited *without recording why*. There is no commit-time
guard; that is \`kit-owned-commit-guard\` in the backlog, held until its record format is specified up
front. Nor does anything re-read canonical automatically — §2 gives the command, and the rows above
are claims about the date they carry.
`;
}

function run(argv, repoRoot) {
  const data = loadAuthority(repoRoot);

  if (argv.includes("--generate")) {
    const out = generate(data);
    if (argv.includes("--write")) {
      writeFileSync(path.join(repoRoot, DOC_PATH), out);
      console.log(`kit-pack-membership: wrote ${DOC_PATH} from ${JSON_PATH}`);
      return 0;
    }
    process.stdout.write(out);
    return 0;
  }

  if (!argv.includes("--audit")) throw new CheckError("usage: --audit [--strict-generated] | --generate [--write]");

  const files = listScriptFiles(repoRoot);
  const { missing, stale } = auditCoverage(data.files, files);
  let failed = 0;

  if (missing.length || stale.length) {
    console.error(`⛔ AUDIT_FAILED — ${JSON_PATH} does not match ${SCRIPTS_DIR}/ exactly.`);
    for (const p of missing) console.error(`   missing record (file exists, not classified): ${p}`);
    for (const p of stale) console.error(`   stale record (classified, file gone):          ${p}`);
    console.error(`\n   Edit ${JSON_PATH} — never the generated .md — then run \`pnpm kit:generate\`.`);
    failed = 1;
  }

  // Byte comparison, never a parse. The document is a function of the data, so any difference is a
  // hand-edit or a stale regeneration; neither needs Markdown to be understood.
  const docAbs = path.join(repoRoot, DOC_PATH);
  if (!existsSync(docAbs)) {
    console.error(`⛔ ${DOC_PATH} is missing; run \`pnpm kit:generate\`.`);
    failed = 1;
  } else if (readFileSync(docAbs, "utf8") !== generate(data)) {
    console.error(`⛔ GENERATED_DOC_STALE — ${DOC_PATH} is not what ${JSON_PATH} generates.`);
    console.error(`   Someone hand-edited it, or the authority changed without regenerating.`);
    console.error(`   Fix: put the change in the JSON, then \`pnpm kit:generate\`.`);
    failed = 1;
  }

  if (!failed) {
    console.log(
      `kit-pack-membership: audit PASS (${files.length} files under ${SCRIPTS_DIR}/ classified; ${DOC_PATH} matches the authority)`,
    );
  }
  return failed;
}

// fileURLToPath, NOT new URL(...).pathname: the latter stays percent-encoded, so a repo path with a
// space ("Plexco app") never matches argv[1] and the CLI silently no-ops with exit 0 — a check that
// passes everything. That happened; only a test spawning the real process caught it.
const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  try {
    const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
    }).trim();
    process.exit(run(process.argv.slice(2), repoRoot));
  } catch (err) {
    console.error(`⛔ CHECK_UNAVAILABLE — ${err.message}`);
    process.exit(2);
  }
}
