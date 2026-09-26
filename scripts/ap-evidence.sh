#!/usr/bin/env bash
# ap-evidence.sh <FEATURE_ID> [--landing <record.json>] [--archive <archived-state-dir>] [--dry-run]
# AP_EVIDENCE_VERSION: 3
#
# Files ONE row of Level 3 routine evidence and, only for an authenticated eligible row, bumps the
# auto-merge maturity counter -- from the real gate artifacts of a run that just LANDED. The
# mechanical replacement for the hand-filed rows in level3-routine-evidence-ledger.md (rows 1-3).
# Invoked by ap-finish.sh right after it writes the landing record; callable by hand to re-file one.
#
# v3 (level3-upgrade review round 6) closes two P1s that weakened the check now running unattended:
#   a round is clean only on EQUALITY with its kind-specific marker (AUTOPILOT_CODE_VERDICT: CLEAN for a
#   code review, AUTOPILOT_SECURITY_VERDICT: CLEAN for a security review) -- `"CLEAN" in verdict`
#   accepted UNCLEAN and NOT CLEAN; and a landing whose head is its base, or whose base...head window is
#   empty, is a run that changed nothing and is never eligible.
#
# v2 (2026-09-09, level3-upgrade wave-0 review round 1) closes five findings from the code and
# security rounds. Read these before changing anything here; each is a control, not a preference:
#
#   PATH CONTAINMENT (security P1 "permits forged self-evidence"). The landing record and archive
#   directory are DERIVED from <FEATURE_ID> and the repo root, never taken on trust from a caller.
#   --landing/--archive remain accepted so ap-finish can pass what it just wrote, but a value that
#   does not resolve to exactly the canonical path is a HALT. Without this, any path could be handed
#   in as "evidence", and from a linked worktree the common-directory resolution below would happily
#   write the MAIN checkout's tracked ledgers from a run that never happened there.
#
#   CROSS-BINDING (same finding). A trigger record only counts as proof of an automatic start when
#   its feature and base_sha agree with the landing record, and the gate result agrees with both.
#   Any mismatch downgrades the row to manual_start_count 1 AND marks it ineligible with the exact
#   mismatch named -- a forged or stale trigger can never mint step-3 evidence.
#
#   ELIGIBILITY GATES MATURITY (security P1 "ineligible evidence still advances maturity"). v1
#   computed `eligible` and then bumped clean_runs regardless. It now bumps only for an eligible row.
#
#   NEVER WRITES A STATUS (same finding). v1 claimed this and then created absent classes with
#   `status: pilot`. It now refuses to create a row at all: an unknown class is reported for the
#   owner to add by hand, because adding a row is choosing a status.
#
#   TWO-PHASE, LOCKED (code P2 "filing is not atomic"). A directory lock serialises concurrent
#   finishes, and a per-run sidecar marks the window between the row append and the maturity bump so
#   an interrupted filing resumes instead of double-counting or silently losing the increment.
#
# What it reads (every field cites its source in the row; nothing is guessed):
#   landing record       <root>/.autopilot/landings/<slug>.json  -- status/mode/base/head/proof/recorded_at
#   archived state dir   <root>/.autopilot/state-archive/<slug>-<ts>/state/ (ap-finish archives $STATE first)
#                        manifest.json, gate-result.json, gate-attempt-count.txt, fix-round-count.txt,
#                        regions.log, gate-attempt-*-verify-*.txt, gate-attempt-*-code-review-round-*.txt,
#                        gate-attempt-*-security-review-round-*.txt, task-contract.md (mtime = start)
#   trigger record       <root>/.autopilot/triggers/<slug>.json   -- issuer ap-dispatch => manual_start_count 0
# What it writes (never commits, never pushes -- same rule ap-finish.sh applies to backlog edits):
#   <ledger-dir>/level3-routine-evidence-ledger.md   one appended "## Row N" block, keyed by run_id
#   <ledger-dir>/maturity-ledger.md                  clean_runs +1 on an EXISTING row of that class,
#                                                    only for an eligible row; `status` never written
# Anything it cannot measure is written as `unavailable`, never as zero, never omitted.
#
# Ledger dir: $AP_EVIDENCE_LEDGER_DIR (a test seam; it grants no forging power -- writing your own
# ledger elsewhere is not an attack on this repo's), else <repo-root>/autopilot/.autopilot, else SKIP.
set -uo pipefail
AP_EVIDENCE_VERSION=3

SLUG="${1:?usage: ap-evidence.sh <FEATURE_ID> [--landing <record.json>] [--archive <dir>] [--dry-run]}"
shift
LANDING=""; ARCHIVE=""; DRY=0
while [ $# -gt 0 ]; do
  case "$1" in
    --landing) [ $# -ge 2 ] || { echo "HALT: --landing needs a path" >&2; exit 2; }; LANDING="$2"; shift 2 ;;
    --archive) [ $# -ge 2 ] || { echo "HALT: --archive needs a path" >&2; exit 2; }; ARCHIVE="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    *) echo "HALT: unknown argument: $1" >&2; exit 2 ;;
  esac
done
case "$SLUG" in ""|*[!a-z0-9._-]*) echo "HALT: invalid feature id: $SLUG" >&2; exit 2 ;; esac
command -v python3 >/dev/null 2>&1 || { echo "HALT: python3 is required by ap-evidence.sh" >&2; exit 1; }

git rev-parse --git-dir >/dev/null 2>&1 || { echo "HALT: not inside a git repo" >&2; exit 1; }
ROOT="$(cd "$(git rev-parse --git-common-dir)" && cd .. && pwd -P)"

# --- path containment: the canonical locations are derived, and an argument may only confirm them ---
CANON_LANDING="$ROOT/.autopilot/landings/$SLUG.json"
resolve() { # print the physical path of an existing file/dir, or nothing
  if [ -d "$1" ]; then (cd "$1" 2>/dev/null && pwd -P); else
    _d="$(cd "$(dirname "$1")" 2>/dev/null && pwd -P)" || return 0; [ -n "$_d" ] && printf '%s/%s' "$_d" "$(basename "$1")"; fi
}
if [ -n "$LANDING" ]; then
  [ "$(resolve "$LANDING")" = "$CANON_LANDING" ] || {
    echo "HALT UNCONTAINED_LANDING: --landing must resolve to $CANON_LANDING (got: $(resolve "$LANDING"))" >&2; exit 2; }
fi
LANDING="$CANON_LANDING"
[ -f "$LANDING" ] || { echo "HALT: landing record not found: $LANDING" >&2; exit 2; }
if [ -n "$ARCHIVE" ]; then
  _a="$(resolve "$ARCHIVE")"
  case "$_a" in
    "$ROOT/.autopilot/state-archive/$SLUG-"*) ;;
    *) echo "HALT UNCONTAINED_ARCHIVE: --archive must be under $ROOT/.autopilot/state-archive/$SLUG-<timestamp>/ (got: $_a)" >&2; exit 2 ;;
  esac
  [ -d "$_a" ] || { echo "HALT: archive dir not found: $ARCHIVE" >&2; exit 2; }
  ARCHIVE="$_a"
fi

LEDGER_DIR="${AP_EVIDENCE_LEDGER_DIR:-$ROOT/autopilot/.autopilot}"
if [ ! -d "$LEDGER_DIR" ]; then
  echo "SKIPPED_NO_LEDGER_DIR: no ledger directory at $LEDGER_DIR (set AP_EVIDENCE_LEDGER_DIR); routine evidence for '$SLUG' was NOT filed." >&2
  exit 0
fi

# --- lock: serialise concurrent finishes so row numbers and the counter cannot race ---
LOCK="$LEDGER_DIR/.ap-evidence.lock"
if [ "$DRY" = 0 ]; then
  _t=0
  until mkdir "$LOCK" 2>/dev/null; do
    _t=$((_t + 1)); [ "$_t" -gt 150 ] && { echo "HALT LEDGER_LOCK_TIMEOUT: $LOCK did not clear" >&2; exit 1; }
    sleep 0.2
  done
  # Same as the dispatcher: a signal must end the process, not just release the serialisation lock
  # and let filing continue unserialised (code round 4, P1).
  trap 'rmdir "$LOCK" 2>/dev/null || true' EXIT
  trap 'rmdir "$LOCK" 2>/dev/null || true; exit 130' INT
  trap 'rmdir "$LOCK" 2>/dev/null || true; exit 143' TERM
fi

AP_EVIDENCE_SLUG="$SLUG" AP_EVIDENCE_LANDING="$LANDING" AP_EVIDENCE_ARCHIVE="$ARCHIVE" \
AP_EVIDENCE_ROOT="$ROOT" AP_EVIDENCE_LEDGER="$LEDGER_DIR" AP_EVIDENCE_DRY="$DRY" \
AP_EVIDENCE_VERSION="$AP_EVIDENCE_VERSION" python3 - <<'PY'
import glob, hashlib, json, os, re, subprocess, sys
from datetime import datetime, timezone

slug = os.environ["AP_EVIDENCE_SLUG"]
landing_path = os.environ["AP_EVIDENCE_LANDING"]
archive = os.environ.get("AP_EVIDENCE_ARCHIVE") or ""
root = os.environ["AP_EVIDENCE_ROOT"]
ledger_dir = os.environ["AP_EVIDENCE_LEDGER"]
dry = os.environ.get("AP_EVIDENCE_DRY") == "1"
version = os.environ["AP_EVIDENCE_VERSION"]
UNAVAILABLE = "unavailable"

def read(path):
    try:
        with open(path) as f: return f.read()
    except OSError: return None

def read_json(path):
    txt = read(path)
    if txt is None: return None
    try: return json.loads(txt)
    except ValueError: return None

landing = read_json(landing_path)
if landing is None:
    print(f"HALT: landing record is not valid JSON: {landing_path}", file=sys.stderr); sys.exit(1)
if landing.get("feature") != slug:
    print(f"HALT: landing record is for '{landing.get('feature')}', not '{slug}'", file=sys.stderr); sys.exit(1)
status, mode = landing.get("status"), landing.get("mode")
if status != "landed" or mode not in ("ancestor", "squash"):
    print(f"SKIPPED_NOT_EVIDENCE: record for '{slug}' is status={status} mode={mode}; only a landed ancestor|squash record is routine evidence.")
    sys.exit(0)

def a(name): return os.path.join(archive, name) if archive else ""
manifest = read_json(a("manifest.json")) if archive else None
gate = read_json(a("gate-result.json")) if archive else None
task_contract = read(a("task-contract.md")) if archive else None

def sha256_file(path):
    try:
        with open(path, "rb") as f: return hashlib.sha256(f.read()).hexdigest()
    except OSError: return None

def atomic_write(path, text):
    """Write-then-rename. A reader sees either the previous content or the complete new content --
    never a half-written row whose early `run_id:` line the resume path would mistake for a filed
    one and then bump maturity against (code round 3, P1)."""
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w") as f:
        f.write(text); f.flush(); os.fsync(f.fileno())
    os.replace(tmp, path)

_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
def one_line(value):
    """Every value in the ledger comes from an artifact this tool did not write. The ledger is
    line-oriented and `run_id:` lines are trusted, so a newline inside a task_id could forge a row
    for a future run and suppress its filing (security round 3, P2). Newlines become spaces and
    control characters are dropped; nothing that reaches the file can create a line."""
    s = "" if value is None else str(value)
    s = s.replace("\r\n", " ").replace("\n", " ").replace("\r", " ").replace("\t", " ")
    s = _CTRL.sub("", s)
    return s.strip() or UNAVAILABLE

def git_bytes(*args):
    """Raw stdout, unstripped -- for hashing, where a trailing newline is part of the content."""
    try:
        r = subprocess.run(["git", "-C", root, *args], capture_output=True, env=_GIT_ENV)
        return r.stdout if r.returncode == 0 else None
    except OSError: return None

# Filenames that reach git come from artifacts, and git reads a path as a PATHSPEC: `:(literal)x`,
# `*` and `!` all mean something there. A name chosen to select a different path -- or nothing --
# would make the landed content look identical to the reviewed content (code round 5, P2).
_GIT_ENV = dict(os.environ, GIT_LITERAL_PATHSPECS="1")

def git_out(*args):
    """Read-only git, for the landing proofs below. Never mutates anything."""
    try:
        r = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, env=_GIT_ENV)
        return r.stdout.strip() if r.returncode == 0 else None
    except OSError: return None

disqualify = []          # reasons the row is not eligible evidence
def require(cond, reason):
    if not cond: disqualify.append(reason)
    return cond

# --- identity, cross-bound across landing / gate / manifest ---
recorded_at = landing.get("recorded_at")
base_sha = landing.get("base_sha") or UNAVAILABLE
head_sha = landing.get("head_sha") or UNAVAILABLE
run_id = head_sha if head_sha != UNAVAILABLE else f"landing:{recorded_at}"
task_id = (manifest or {}).get("task_id") or (gate or {}).get("task_id") or UNAVAILABLE
manifest_hash = (gate or {}).get("manifest_sha256") or UNAVAILABLE

require(archive != "", "no archived state dir")
# A landing whose head IS its base, or whose base...head window is empty, is a run that changed
# nothing. It used to be filed like any other and could advance maturity (review round 6, code 1 /
# security 2, P1). An unreadable window fails the same way: it cannot be shown to be non-empty.
if head_sha == UNAVAILABLE or base_sha == UNAVAILABLE or head_sha == base_sha:
    disqualify.append("the landing changed nothing: head_sha is its base_sha, or one of them is missing")
elif not git_out("diff", "--name-only", f"{base_sha}...{head_sha}"):
    disqualify.append("the landing changed nothing: the base_sha...head_sha diff is empty or cannot be computed")
if manifest is not None:
    require(manifest.get("feature") == slug, f"manifest.feature={manifest.get('feature')} != {slug}")
else:
    disqualify.append("no runtime manifest in the archive")
if gate is not None:
    require(gate.get("feature") == slug, f"gate-result.feature={gate.get('feature')} != {slug}")
    # The archive is ordinary files on disk. The gate recorded the hash of the manifest it actually
    # enforced, so that hash -- not the file sitting next to it -- decides whether the risk,
    # autonomy_mode and change_class read below can be believed (code round 2, P1).
    archived_manifest_hash = sha256_file(a("manifest.json"))
    require(archived_manifest_hash is not None and archived_manifest_hash == gate.get("manifest_sha256"),
            f"archived manifest.json hash {archived_manifest_hash} != gate-result.manifest_sha256 {gate.get('manifest_sha256')}")
    require(gate.get("head_sha") == landing.get("head_sha"), "gate-result.head_sha != landing.head_sha")
    require(gate.get("base_sha") == landing.get("base_sha"), "gate-result.base_sha != landing.base_sha")
    require(gate.get("result") == "pass", f"gate-result.result={gate.get('result')}")
else:
    disqualify.append("no gate-result.json in the archive")

# change_class: manifest field, else CHANGE_CLASS: in task-contract.md, else unavailable
change_class, cc_source = UNAVAILABLE, "none"
if manifest and isinstance(manifest.get("change_class"), str) and manifest["change_class"].strip():
    change_class, cc_source = manifest["change_class"].strip(), "manifest.change_class"
elif task_contract:
    m = re.search(r"^CHANGE_CLASS:\s*(\S+)", task_contract, re.M)
    if m: change_class, cc_source = m.group(1), "task-contract.md CHANGE_CLASS"
if change_class != UNAVAILABLE and not re.match(r"^[a-z][a-z0-9._-]*$", change_class):
    print(f"HALT: change_class '{change_class}' is not a valid class token", file=sys.stderr); sys.exit(1)
require(change_class != UNAVAILABLE, "change_class unavailable")

risk = (manifest or {}).get("risk", UNAVAILABLE)
autonomy = (manifest or {}).get("autonomy_mode", UNAVAILABLE)
require(risk in ("P1", "P2"), f"risk={risk} is not a writing-slice risk")
require(autonomy in ("supervised", "proactive_routine"), f"autonomy_mode={autonomy}")

# --- trigger record: proof of an automatic start ONLY when it cross-binds to this landing ---
trigger_path = os.path.join(root, ".autopilot", "triggers", f"{slug}.json")
trigger = read_json(trigger_path)
trigger_rel = os.path.relpath(trigger_path, root)
manual_start, trigger_note = 1, "no trigger record: human-started"
if trigger is not None:
    mismatches = []
    if trigger.get("issuer") != "ap-dispatch": mismatches.append(f"issuer={trigger.get('issuer')}")
    if trigger.get("feature") != slug: mismatches.append(f"feature={trigger.get('feature')}")
    if trigger.get("base_sha") != landing.get("base_sha"): mismatches.append("base_sha != landing.base_sha")
    if not re.match(r"^[0-9a-f]{32}$", str(trigger.get("nonce", ""))): mismatches.append("nonce malformed")
    # What follows is what makes the record a ROUTINE DISPATCH OF THIS CLASS rather than a file with
    # the right name: a manual or supervised replacement run could otherwise inherit an auto-start
    # record and advance the wrong class (code round 3 P1, security round 3 P1).
    if trigger.get("schema_version") != "level3-trigger-v1":
        mismatches.append(f"schema_version={trigger.get('schema_version')}")
    if trigger.get("change_class") != change_class:
        mismatches.append(f"change_class={trigger.get('change_class')} != {change_class}")
    if trigger.get("permission_mode") not in ("acceptEdits", "default", "plan"):
        mismatches.append(f"permission_mode={trigger.get('permission_mode')!r} is not a dispatchable mode")
    if autonomy != "proactive_routine":
        mismatches.append(f"manifest autonomy_mode={autonomy} is not a routine start")
    if risk != "P2":
        mismatches.append(f"manifest risk={risk} is never dispatched")
    _authored = git_bytes("show", f"{trigger.get('base_sha')}:docs/autopilot-manifests/{slug}.json")
    if _authored is None:
        mismatches.append("the authored manifest is not at the base the trigger recorded")
    elif hashlib.sha256(_authored).hexdigest() != str(trigger.get("manifest_sha256", "")):
        mismatches.append("manifest_sha256 does not match the authored manifest at the recorded base")
    _reg_path = os.environ.get("AP_DISPATCH_ROUTINES") or os.path.join(root, "autopilot", ".autopilot", "routines.json")
    try:
        with open(_reg_path, "rb") as _f: _reg_raw = _f.read()
    except OSError:
        _reg_raw = None
    if _reg_raw is None:
        mismatches.append("the routine registry is not readable, so the recorded authority cannot be checked")
    elif hashlib.sha256(_reg_raw).hexdigest() != str(trigger.get("routines_sha256", "")):
        mismatches.append("routines_sha256 does not match the registry on this machine")
    if mismatches:
        manual_start = 1
        trigger_note = (f"trigger record {trigger_rel} present but does NOT bind to this landing "
                        f"({'; '.join(mismatches)}) -- counted as human-started")
        disqualify.append("trigger record present but does not cross-bind to the landing")
    else:
        manual_start = 0
        trigger_note = (f"trigger record {trigger_rel} issuer=ap-dispatch nonce={trigger['nonce']} "
                        f"base_sha matches the landing")
    # TRACKED DEFERRAL, backlog task `routine-scope-enforced-only-at-evidence` (reported again as
    # code round 4 P1): what follows is DETECTION at the evidence boundary, not PREVENTION before
    # READY. An unattended writer can still reach READY having edited outside its earned scope; what
    # it cannot do is have that run counted as evidence. Prevention has to live in
    # autopilot-scope-gate, a trust-gate file that cannot certify its own change, so it is its own
    # slice with its own review -- not a line added here.
    # The routine boundary the dispatcher authorised, checked against what the run actually changed.
    # The readiness gate certifies whatever the diff turns out to be, so this is the place the earned
    # scope is enforced for an unattended run. Deliberately OUTSIDE the binding branch: a record that
    # fails one of the identity checks above is exactly when this reason is most worth printing, and
    # it used to be skipped there.
    boundary = trigger.get("allowed_scope")
    certified = (gate or {}).get("diff_files")
    if not isinstance(boundary, list):
        disqualify.append("trigger record carries no allowed_scope to check the diff against")
    elif not isinstance(certified, list):
        disqualify.append("gate-result.json lists no diff_files to check against allowed_scope")
    else:
        beyond = [f for f in certified if f not in set(boundary)]
        if beyond:
            disqualify.append("the certified diff went outside the routine allowed_scope: "
                              + ", ".join(sorted(beyond)))

def count_file(name):
    txt = read(a(name)) if archive else None
    if txt is None: return None
    txt = txt.strip()
    return int(txt) if txt.isdigit() else None

attempts = count_file("gate-attempt-count.txt")
fix_rounds = count_file("fix-round-count.txt")
regions = read(a("regions.log")) if archive else None

# verification: one line per group, from each log's own header fields
verif_by_group = {"focused": [], "canonical": [], "e2e": []}
verif_other = []
if archive:
    for path in sorted(glob.glob(a("gate-attempt-*-verify-*.txt"))):
        head = (read(path) or "").splitlines()[:8]
        group = next((l.split(":", 1)[1].strip() for l in head if l.startswith("group:")), "?")
        exit_status = next((l.split(":", 1)[1].strip() for l in head if l.startswith("exit_status:")), "?")
        entry = f"{'PASS' if exit_status == '0' else 'FAIL'} -- {os.path.basename(path)} (exit_status {exit_status})"
        (verif_by_group[group] if group in verif_by_group else verif_other).append(entry)
all_verif = [v for vs in verif_by_group.values() for v in vs] + verif_other
require(bool(all_verif) and all(v.startswith("PASS") for v in all_verif), "verification missing or not all PASS")

def review_rows(kind):
    out = []
    if not archive: return out
    for path in sorted(glob.glob(a(f"gate-attempt-*-{kind}-round-*.txt"))):
        txt = read(path) or ""
        all_lines = txt.rstrip().splitlines()
        tail = all_lines[-12:]
        # The WHOLE artifact, from the end, exact marker first. A twelve-line window over a log that
        # appends stderr after stdout could push a valid verdict out of sight, and the run was then
        # ineligible for ever (code round 4, P2). The exact form is preferred over any line
        # mentioning VERDICT, because the reviewer PROMPT names both markers (kit-design-debt §17).
        #
        # The marker is KIND-SPECIFIC: a code-review artifact is answered by AUTOPILOT_CODE_VERDICT
        # only. The fallback below exists to show the reader what the artifact said; it can never
        # establish eligibility, because `clean_verdict` compares with the exact marker and nothing
        # else (review round 6, code 4 / security 5 P1: `"CLEAN" in verdict` accepted UNCLEAN).
        marker = "SECURITY" if kind == "security-review" else "CODE"
        verdict = next((l.strip() for l in reversed(all_lines)
                        if re.match(rf"^AUTOPILOT_{marker}_VERDICT: (CLEAN|FINDINGS)$", l.strip())), None)
        if verdict is None:
            verdict = next((l.strip() for l in reversed(all_lines) if "VERDICT" in l), "no verdict marker")
        tokens = UNAVAILABLE
        for i, l in enumerate(all_lines):
            if l.strip().lower() == "tokens used" and i + 1 < len(all_lines):
                tokens = all_lines[i + 1].strip()
        out.append((os.path.basename(path), len(txt.splitlines()), verdict, tokens))
    return out

code_reviews, sec_reviews = review_rows("code-review"), review_rows("security-review")
def clean_verdict(kind, v):
    """Equality with the exact terminal marker, never a substring test."""
    return v == f"AUTOPILOT_{kind}_VERDICT: CLEAN"
require(bool(code_reviews) and all(clean_verdict("CODE", v) for (_, _, v, _) in code_reviews[-1:]),
        "final code review is not CLEAN, or no review artifact")
sec_required = ((manifest or {}).get("security_review") or {}).get("required") if manifest else None
if sec_required is None:
    disqualify.append("manifest.security_review.required is absent")
elif sec_required and not sec_reviews:
    disqualify.append("security review required by the manifest but no artifact is present")
elif sec_required:
    require(all(clean_verdict("SECURITY", v) for (_, _, v, _) in sec_reviews[-1:]), "final security review is not CLEAN")

# duration: task-contract.md mtime (worktree creation) -> landing recorded_at
duration = UNAVAILABLE
if archive and task_contract is not None and recorded_at:
    try:
        start = datetime.fromtimestamp(os.stat(a("task-contract.md")).st_mtime, tz=timezone.utc)
        end = datetime.strptime(recorded_at, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        secs = int((end - start).total_seconds())
        duration = (f"{secs // 3600}h{(secs % 3600) // 60:02d}m{secs % 60:02d}s (task-contract.md mtime "
                    f"{start.strftime('%Y-%m-%dT%H:%M:%SZ')} -> landing recorded_at {recorded_at}; wall-clock, "
                    f"includes the human merge wait)") if secs >= 0 else \
                   f"{UNAVAILABLE} (task-contract.md mtime is after recorded_at)"
    except (ValueError, OSError):
        duration = UNAVAILABLE

scope_expanded = (gate or {}).get("scope_expanded")
require(scope_expanded is False, f"gate-result.scope_expanded={scope_expanded}")
halt_files = sorted(os.path.basename(p) for p in glob.glob(a("HALT-*.txt"))) if archive else []
fix_max = ((manifest or {}).get("budgets") or {}).get("fix_rounds_max") if manifest else None
# The live gate halts MAX_ROUNDS on `fixRounds > fix_rounds_max` (autopilot-review-readiness.mjs);
# a clean run that used its last permitted round is NOT a breach. v1 used >= and wrongly disqualified it.
breaker_breach = bool(halt_files) or (fix_rounds is not None and fix_max is not None and fix_rounds > fix_max)
require(not breaker_breach, "breaker breach")

scope_and_invariants_hash = UNAVAILABLE
if manifest is not None and isinstance(manifest.get("scope"), list) and isinstance(manifest.get("invariants"), list):
    scope_and_invariants_hash = hashlib.sha256(json.dumps(
        {"scope": manifest["scope"], "invariants": manifest["invariants"]}, sort_keys=True).encode()).hexdigest()

learning = UNAVAILABLE
if task_contract:
    m = re.search(r"^\s*(?:LEARNING|LEARNING_CAPTURED|LEARNING_OR_EXCEPTION):\s*(.+)$", task_contract, re.M)
    if m: learning = m.group(1).strip()

# The ledger rule is that material human steering makes a row ineligible, and nothing in this kit
# measures steering. Silence therefore cannot mean "none" (code round 2, P2): a row is eligible only
# when a human wrote the claim down in the task contract, where it can be read back and disputed.
steering = UNAVAILABLE
if task_contract:
    m = re.search(r"^\s*HUMAN_STEERING:\s*(.+)$", task_contract, re.M)
    if m: steering = m.group(1).strip()
if steering == UNAVAILABLE:
    disqualify.append("HUMAN_STEERING is not attested in task-contract.md (unmeasured steering fails closed)")
elif not re.match(r"^none\b", steering, re.I):
    disqualify.append(f"HUMAN_STEERING attests steering occurred: {steering}")

# --- resume / idempotency ---
ledger_path = os.path.join(ledger_dir, "level3-routine-evidence-ledger.md")
maturity_path = os.path.join(ledger_dir, "maturity-ledger.md")
sidecar = os.path.join(ledger_dir, f".ap-evidence-pending-{run_id}")
ledger = read(ledger_path)
if ledger is None:
    print(f"SKIPPED_NO_LEDGER: {ledger_path} does not exist; create it from autopilot/parallel/maturity-ledger.TEMPLATE.md first.", file=sys.stderr)
    sys.exit(0)
already_filed = bool(re.search(rf"^run_id: {re.escape(run_id)}\s*$", ledger, re.M))

def landing_preserves_reviewed_content():
    """Is the content that landed provably the content that was reviewed?

    `merge-base --is-ancestor` says the reviewed tip is REACHABLE from the default branch. It does
    not say the merge kept it: a non-fast-forward merge can resolve conflicts differently and still
    leave the tip an ancestor (code round 2, P1). `--squash-verified` is different -- ap-finish
    proved an exact binary diff there, which is the whole point of that mode.

    For an ancestor landing this compares the slice files as they stand on the default branch now
    against the reviewed head. A later unrelated commit touching the same files also fails it, so
    this can only UNDER-count: the safe direction for a counter that unlocks automation."""
    if mode == "squash":
        return True, "squash landing: ap-finish proved an exact binary diff against the origin commit"
    files = (gate or {}).get("diff_files")
    if not isinstance(files, list) or not files:
        return False, "no diff_files recorded, so the landed content cannot be compared with the reviewed content"
    # Same resolution order as ap-dispatch.sh and ap-finish.sh: env override, origin/HEAD, exactly
    # one conventional name, else refuse. Falling back to "main" alone meant a valid master-branch
    # run filed its row and could never increment maturity, with idempotency blocking the retry
    # (code round 3, P2).
    default_branch = os.environ.get("AUTOPILOT_DEFAULT_BRANCH") or ""
    if not default_branch:
        sym = git_out("symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD") or ""
        default_branch = sym.split("origin/", 1)[-1] if sym else ""
    if not default_branch:
        found = [c for c in ("main", "master", "trunk")
                 if git_out("rev-parse", "--verify", "--quiet", f"refs/remotes/origin/{c}") is not None]
        if len(found) == 1: default_branch = found[0]
    if not default_branch:
        return False, "the origin default branch cannot be resolved (set AUTOPILOT_DEFAULT_BRANCH), so the landed content cannot be re-verified"
    ref = f"origin/{default_branch}"
    if git_out("rev-parse", "--verify", "--quiet", f"{ref}^{{commit}}") is None:
        return False, f"{ref} is not available locally, so the landed content cannot be re-verified"
    if git_out("merge-base", "--is-ancestor", head_sha, ref) is None:
        return False, f"{head_sha} is no longer an ancestor of {ref}"
    diff = git_out("diff", "--name-only", head_sha, ref, "--", *files)
    if diff is None:
        return False, "the comparison against the default branch could not be run"
    if diff:
        return False, ("the slice files on " + ref + " differ from the reviewed head (" + diff.replace("\n", ", ")
                       + ") -- a founder fix at merge, or later work on the same files; count this by hand if it was neither")
    return True, f"ancestor landing: the slice files on {ref} are identical to the reviewed head"

# The proof that what landed is what was reviewed decides ELIGIBILITY, not just the counter. It ran
# after `eligible` was already fixed, so a conflict-modified ancestor landing was filed
# evidence_eligible: true and merely skipped the bump -- and a promotion decision reading the ledger
# would accept that row (code round 3, P1).
_preserved, _preserved_why = landing_preserves_reviewed_content()
if not _preserved:
    disqualify.append("the landed content is not provably the reviewed content: " + _preserved_why)

eligible = not disqualify

def _maturity_row(maturity):
    row_re = re.compile(rf"^(\| *{re.escape(change_class)} *\| *)(P[0-3]) *(\| *)(\d+)( *\| *)(\w+)( *\|)\s*$", re.M)
    return row_re.search(maturity)

def maturity_plan():
    """(target, note) -- what clean_runs should become. Writes nothing.

    clean_runs means CONSECUTIVE clean runs OF THE SAME RISK TIER. It was neither (code round 3,
    P1): the tier on the row was read and never compared, and an ineligible run left the count
    standing, so three non-consecutive or wrong-tier runs could present themselves as maturity. An
    eligible run increments; an ineligible one resets to 0. The status column is never written --
    creating or promoting a row is owner authority."""
    if change_class == UNAVAILABLE:
        return None, "maturity-ledger: NOT updated (change_class unavailable)"
    maturity = read(maturity_path)
    if maturity is None:
        return None, f"maturity-ledger: NOT updated ({os.path.relpath(maturity_path, root)} missing)"
    m = _maturity_row(maturity)
    if not m:
        return None, (f"maturity-ledger: NOT updated -- no row for '{change_class}'. Adding one would mean "
                      f"choosing a status, which is owner authority; add it by hand if this class should be tracked.")
    if m.group(2) != risk:
        return None, (f"maturity-ledger: NOT updated -- the '{change_class}' row counts {m.group(2)} runs and this "
                      f"run is {risk}; a counter that mixes tiers is evidence for neither")
    cur = int(m.group(4))
    target = cur + 1 if eligible else 0
    if target == cur:
        return target, f"maturity-ledger: {change_class} clean_runs stays {cur}" + ("" if eligible else " (already 0; this row is ineligible)")
    if eligible:
        return target, f"maturity-ledger: {change_class} clean_runs {cur} -> {target}, status '{m.group(6)}' untouched"
    return target, (f"maturity-ledger: {change_class} clean_runs {cur} -> 0 -- this row is ineligible "
                    f"({'; '.join(disqualify)}), and the count is of CONSECUTIVE clean runs")

def bump_maturity():
    """Apply maturity_plan(). Never creates a row and never writes the status column."""
    target, note = maturity_plan()
    if target is None or dry:
        return note
    maturity = read(maturity_path)
    m = _maturity_row(maturity)
    if m and int(m.group(4)) != target:
        atomic_write(maturity_path, maturity[:m.start(4)] + str(target).rjust(len(m.group(4))) + maturity[m.end(4):])
    return note

def maturity_count(cls):
    m2 = read(maturity_path)
    if m2 is None or cls == UNAVAILABLE: return None
    mm = re.search(rf"^\| *{re.escape(cls)} *\| *P[0-3] *\| *(\d+) *\| *\w+ *\|\s*$", m2, re.M)
    return int(mm.group(1)) if mm else None

if already_filed:
    if os.path.exists(sidecar) and not dry:
        # The sidecar records the value the bump was supposed to produce. Without it, a crash AFTER
        # the bump but BEFORE the sidecar was removed looked identical to a crash before the bump,
        # and the resume incremented a second time (code round 2, P2).
        want = None
        try: want = int((read(sidecar) or "").strip().splitlines()[2])
        except (IndexError, ValueError): want = None
        have = maturity_count(change_class)
        if want is not None and have is not None and have == want:
            os.remove(sidecar)
            print(f"RESUMED: row for run_id {run_id} was already filed and its maturity update had already "
                  f"completed (clean_runs={have}, expected {want}); nothing to redo.")
            sys.exit(0)
        note = bump_maturity()
        os.remove(sidecar)
        print(f"RESUMED: row for run_id {run_id} was already filed but its maturity update had not completed.")
        print(f"evidence: {note}")
        sys.exit(0)
    print(f"SKIPPED_ALREADY_FILED: run_id {run_id} is already in {os.path.relpath(ledger_path, root)}")
    sys.exit(0)

# One unfinished maturity update at a time. A sidecar left by ANOTHER run means some counter is
# mid-flight; filing this row now lets the two interleave, and the resumed run can mistake this
# run's value for its own completed bump (code round 4, P1). The operator resolves it by re-running
# the interrupted slug, which takes the RESUMED path above.
_stale = [f for f in sorted(glob.glob(os.path.join(ledger_dir, ".ap-evidence-pending-*")))
          if os.path.basename(f) != f".ap-evidence-pending-{run_id}"]
if _stale and not dry:
    print("HALT PENDING_EVIDENCE_UNRESOLVED: another run left an unfinished maturity update: "
          + ", ".join(os.path.basename(f) for f in _stale)
          + ". Re-run ap-evidence.sh for that slug (it resumes), or remove the sidecar deliberately, "
            "before filing this row -- two unfinished updates on one class cannot be ordered.",
          file=sys.stderr)
    sys.exit(1)

row_n = len(re.findall(r"^## Row \d+", ledger, re.M)) + 1

def fmt_reviews(rows, empty):
    if not rows: return empty
    return "; ".join(f"{name} ({lines} lines) tail: {verdict}; tokens {tokens}" for (name, lines, verdict, tokens) in rows)

def group_line(g):
    return "; ".join(verif_by_group[g]) if verif_by_group[g] else UNAVAILABLE

lines = [
    "evidence_schema_version: level3-routine-evidence-v1",
    f"filed_by: ap-evidence.sh v{version} (machine-filed from gate artifacts; nothing below is hand-typed)",
    f"repo_id: {one_line(os.path.basename(root))}",
    f"change_class: {one_line(change_class)} (source: {one_line(cc_source)})",
    f"task_id: {one_line(task_id)}",
    f"run_id: {one_line(run_id)}",
    f"risk: {risk}",
    f"autonomy_mode: {autonomy}",
    f"manual_start_count: {manual_start} ({trigger_note})",
    f"base_sha: {base_sha}",
    f"head_sha: {head_sha}",
    f"manifest_hash: {manifest_hash} (source: gate-result.json manifest_sha256)",
    f"scope_and_invariants_hash: {scope_and_invariants_hash}"
    + ("" if scope_and_invariants_hash == UNAVAILABLE else
       " (SELF-COMPUTED, no such native gate field: sha256 of json.dumps({scope, invariants}, sort_keys=True) over the archived runtime manifest; reproducible from the same source)"),
    f"focused_verification: {one_line(group_line('focused'))}",
    f"canonical_verification: {one_line(group_line('canonical'))}",
    f"e2e_verification: {one_line(group_line('e2e'))}",
] + ([f"other_verification: {one_line('; '.join(verif_other))}"] if verif_other else []) + [
    f"code_review_artifacts: {one_line(fmt_reviews(code_reviews, UNAVAILABLE))}",
    "security_review: " + one_line(fmt_reviews(sec_reviews, "none")
                           if sec_reviews else
                           (f"not_applicable (manifest.security_review.required={sec_required})"
                            if manifest is not None else UNAVAILABLE)),
    f"terminal_state: READY (landing record status={status} mode={mode}, origin_proof_sha={landing.get('origin_proof_sha')})",
    "human_interventions: >=1 -- the READY->merge authorization is implied by the landing record "
    "(STOP_AT_READY as designed); the exact count, and whether any of it was material steering, is "
    f"{UNAVAILABLE}: no artifact in this kit measures it",
    f"material_scope_change_after_start: {str(scope_expanded).lower() if scope_expanded is not None else UNAVAILABLE} (gate-result.json scope_expanded)",
    f"breaker_breach: {str(breaker_breach).lower()} (fix-round-count {fix_rounds if fix_rounds is not None else UNAVAILABLE}/{fix_max if fix_max is not None else UNAVAILABLE}, breach only when strictly greater; HALT files: {', '.join(halt_files) if halt_files else 'none'}; regions.log: {'empty' if regions is not None and not regions.strip() else (UNAVAILABLE if regions is None else 'non-empty')})",
    f"merge_or_disposition: {os.path.relpath(landing_path, root)} (status {status}, mode {mode})",
    f"origin_verified_at: {recorded_at or UNAVAILABLE} (landing record recorded_at)",
    f"duration: {duration}",
    f"gate_attempts: {attempts if attempts is not None else UNAVAILABLE} (gate-attempt-count.txt)",
    # Counted from the review artifacts themselves: one gate attempt can carry two clean rounds, and
    # an attempt that halts early carries none, so the attempt count was never the round count
    # (code round 4, P2).
    f"review_rounds: {len(code_reviews) + len(sec_reviews) if (code_reviews or sec_reviews) else UNAVAILABLE}"
    f" (counted from the archived review artifacts: {len(code_reviews)} code, {len(sec_reviews)} security)",
    f"fix_rounds: {fix_rounds if fix_rounds is not None else UNAVAILABLE} (fix-round-count.txt)",
    f"cost_or_token_measurement: reviewer tokens per round as printed at each round's tail (see code_review_artifacts); total agent tokens: {UNAVAILABLE}",
    f"human_steering_attested: {one_line(steering)} (source: task-contract.md HUMAN_STEERING; absent = ineligible)",
    f"learning_or_exception: {one_line(learning)}",
    f"evidence_eligible: {str(eligible).lower()}" + ("" if eligible else " (" + "; ".join(disqualify) + ")"),
]
# Applied to EVERY line, not field by field: a per-field call is a rule each future field has to
# remember, and the fields that had been forgotten (trigger_note, the landing hashes, the
# disqualification reasons) were exactly the ones carrying artifact text (code round 4, P2).
lines = [one_line(l) for l in lines]
body = "\n".join(lines)
row_hash = hashlib.sha256(body.encode("utf-8")).hexdigest()
block = (f"\n## Row {row_n} — {slug} (machine-filed by ap-evidence.sh)\n\n"
         f"Filed {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')} by ap-evidence.sh v{version} from "
         f"{os.path.relpath(landing_path, root)}"
         + (f" and {os.path.relpath(archive, root)}" if archive else " (no archived state dir)")
         + ". Values are read from the named artifacts; `unavailable` means no artifact measures it.\n\n"
         f"```text\n{body}\nrow_hash: {row_hash} (sha256 of the lines above this one, inside the fence)\n```\n")

if dry:
    print(block)
    print(bump_maturity())
    print("DRY_RUN: nothing written")
    sys.exit(0)

# two-phase: sidecar -> row -> maturity -> clear sidecar. An interruption leaves the sidecar, and the
# next run takes the RESUMED path above instead of double-counting or losing the increment.
_target, _ = maturity_plan()
with open(sidecar, "w") as f:
    f.write(f"{run_id}\n{change_class}\n{'' if _target is None else _target}\n")
    f.flush(); os.fsync(f.fileno())
# Whole row or no row: appending directly could leave a partial block whose early `run_id:` line the
# next run would read as "already filed" (code round 3, P1).
atomic_write(ledger_path, ledger + block)
note = bump_maturity()
os.remove(sidecar)
print(f"evidence: row {row_n} filed for {slug} in {os.path.relpath(ledger_path, root)} "
      f"(run_id {run_id}, manual_start_count {manual_start}, eligible {str(eligible).lower()})")
print(f"evidence: {note}")
print("evidence: nothing committed or pushed -- review and commit the ledger change yourself")
PY
