#!/usr/bin/env python3
"""ap3 shared brain: frontmatter parse, glob match, scope classify, task lint.

Single source of truth so the hook (scope-guard), the reconcile scope-check and the
task lint cannot drift on glob semantics. Pure stdlib — no PyYAML — so it runs under
whatever python3 a launchd-started writer finds on PATH.

Subcommands (all read cwd = the repo being operated on):
  frontmatter <taskfile>       print the parsed frontmatter as JSON
  classify <taskfile> <path>   print one of: scratch | forbidden | in | out
  lint <taskfile>              print 'OK' or 'INVALID_TASK <slug>: <reason>' (exit 1)
  rubric <rubric.md>           print a feature-readiness rubric as {readiness_version, items} JSON
  intake-score <rubric.md> <evidence.json>   print {status, hard_gaps, supervised_gaps, gaps}
  plan-emit <plan.json>        write ap3/queue/<slug>.md per dispatchable slice; see plan_emit()
  findings <transcript.txt>    print the reviewer's real verdict block; exit 1 if none exists
  budget-remaining <budget_usd> <spent_usd> [floor]   print the rounded remaining budget;
                                             exit 1 if <= floor (default 0.5), 2 if floor is malformed

The git/network-dependent lint checks (run record, origin branch) live in lint-task.sh;
this file only does what it can decide from files in the working tree.
"""
import json
import shlex
import math
import os
import re
import sys

# Paths a routine may never edit, whatever the registry says (DESIGN §5.1 / §4).
FORBIDDEN_PREFIXES = (".claude/", "ap3/", ".github/")
SCRATCH_PREFIX = ".ap3-run/"
VERIFY_PREFIXES = ("npm", "npx", "pnpm", "yarn", "bash")  # writer-runnable test runners
RISKS = ("P1", "P2", "P3")


# ---------------------------------------------------------------- frontmatter
def parse_frontmatter(path):
    """Minimal YAML-frontmatter parser for the fixed ap3 task schema.

    Handles exactly two shapes: 'key: scalar' and a 'key:' block of '- item' lines.
    Anything richer is out of contract (the task template stays this simple), and a
    required key that does not parse cleanly fails the type checks in lint.
    Returns (frontmatter_dict, body_str). Raises ValueError if no frontmatter fence.
    """
    with open(path, "r", encoding="utf-8") as fh:
        text = fh.read()
    lines = text.split("\n")
    if not lines or lines[0].strip() != "---":
        raise ValueError("missing frontmatter '---' fence on line 1")
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        raise ValueError("frontmatter never closed with '---'")
    fm = {}
    key = None
    for raw in lines[1:end]:
        if not raw.strip():
            continue
        if raw.startswith((" ", "\t")) and raw.strip().startswith("- "):
            # list item under the most recent 'key:' block
            if key is None or not isinstance(fm.get(key), list):
                continue
            fm[key].append(_unquote(raw.strip()[2:].strip()))
            continue
        m = re.match(r"^([A-Za-z0-9_]+):\s*(.*)$", raw)
        if not m:
            continue
        key = m.group(1)
        val = m.group(2).strip()
        fm[key] = _unquote(val) if val else []  # empty value opens a list block
    body = "\n".join(lines[end + 1:])
    return fm, body


def _unquote(s):
    if len(s) >= 2 and s[0] == s[-1] and s[0] in ("'", '"'):
        return s[1:-1]
    return s


# ---------------------------------------------------------------- glob
# ---------------------------------------------------------------- K27: socket-binding tests
# The writer's sandbox refuses every listen() (`listen EPERM`, measured on Trum Bia Hoi
# agent-verification-m03-dev-port-wire, 2026-09-18), so a test that binds a real port can only
# ever pass on the host, i.e. through the task's `verify_host` (dispatcher-side, unsandboxed,
# after review is CLEAN). Nothing said so before a $9 writer round found out. This is the
# intake-time half of the K27 fix: a cheap static scan of the TEST files the scope already
# contains. Its limits are deliberate and documented -- it reads the working tree at lint time,
# so a binding test the writer CREATES during the run is invisible here (that case still ends
# as a VERIFY_FAIL halt, now with the README pointing at verify_host); and it cannot know what
# `npm test` runs, so only a `verify` that names a flagged file EXPLICITLY is rejected.
# W5.2.6 review (code 2): constructing a server is not binding one -- `net.createServer()` touches
# no port until `.listen()`, so the constructor is NOT in this list. What IS: the calls that bind
# (`.listen(`, Python's `.bind((`), and Python's `HTTPServer(` / `serve_forever(` (TCPServer binds
# in its constructor). A conservative textual heuristic -- a `.listen(` in a comment or a string
# still trips it -- documented as such; the task author routes that file through verify_host or
# rewords it.
_SOCKET_BIND_RE = re.compile(
    r"(\.listen\s*\(|\.bind\s*\(\s*\(|\bserve_forever\s*\(|\bHTTPServer\s*\()"
)
_SOCKET_SCAN_MAX_BYTES = 256 * 1024
_TEST_FILE_RE = re.compile(
    r"(\.(test|spec)\.[a-z]+$|(^|/)(test|tests|__tests__|spec)/|(^|/)test_[^/]+\.py$|_test\.(py|go|rb)$)"
)
_SCAN_SKIP_DIRS = {".git", "node_modules", ".ap3-run", "ap3", ".claude", "dist", "build", "coverage", ".next"}


def _inside_repo(path):
    """True iff `path` is a NON-symlink regular file whose resolved location is under cwd.
    W5.2.6 review (code 1): this scan runs unsandboxed (lint-task.sh on the owner's shell, and the
    dispatcher on every candidate), so a tracked scoped symlink must never lead it to /dev/zero,
    an owner file, or anything outside the worktree -- skip symlinks outright, and refuse a path
    that resolves elsewhere even without a symlink in its last component."""
    if os.path.islink(path) or not os.path.isfile(path):
        return False
    root = os.path.realpath(os.getcwd())
    real = os.path.realpath(path)
    return real == root or real.startswith(root + os.sep)


def _scope_files(scope):
    """Existing regular, in-repo, non-symlink files matched by the scope globs (cwd = repo root)."""
    found = []
    seen = set()
    for entry in scope:
        if not isinstance(entry, str):
            continue
        if not any(ch in entry for ch in "*?"):
            if entry not in seen and _inside_repo(entry):
                seen.add(entry); found.append(entry)
            continue
        # walk only the static prefix of the glob, never the whole repo; os.walk never follows
        # directory symlinks (followlinks=False) and symlinked directories are pruned explicitly
        cut = min([i for i in (entry.find("*"), entry.find("?")) if i >= 0])
        root = entry[:cut].rsplit("/", 1)[0] if "/" in entry[:cut] else "."
        if os.path.islink(root) or not os.path.isdir(root):
            continue
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            dirnames[:] = [d for d in dirnames
                           if d not in _SCAN_SKIP_DIRS and not os.path.islink(os.path.join(dirpath, d))]
            for fn in filenames:
                rel = os.path.normpath(os.path.join(dirpath, fn))
                if rel.startswith("./"):
                    rel = rel[2:]
                if rel not in seen and gmatch(entry, rel) and _inside_repo(rel):
                    seen.add(rel); found.append(rel)
    return found



def _verify_names_file(verify, path):
    """True iff a token of the `verify` command selects `path` -- by full path, by a ./-prefixed or
    otherwise-spelled path to the same file, or by bare basename (test runners such as
    `npm test -- port.test.ts` / `vitest port` select by basename; W5.2.6 review, security 3).
    Tokenised with shlex so quoting cannot hide the name; a substring test alone was bypassable."""
    try:
        tokens = shlex.split(verify)
    except ValueError:
        tokens = verify.split()
    npath = os.path.normpath(path)
    base = os.path.basename(npath)
    stem = base.split(".")[0]
    for tok in tokens:
        t = tok.strip("'\"")
        if not t or t.startswith("-"):
            continue
        # a runner filter can be a bare "port" for port.test.ts; a 3+ char stem match counts
        if t == npath or os.path.normpath(t) == npath or t == base or t.endswith("/" + base) \
                or npath.endswith("/" + os.path.normpath(t)) or (len(stem) >= 3 and t == stem):
            return True
    return False

def socket_binding_tests(scope):
    """[(path, matched_call), ...] for scope TEST files that bind a socket (K27).
    Reads at most _SOCKET_SCAN_MAX_BYTES of each file: a test file larger than that is not a test
    file this heuristic can judge, and an unbounded read is how a scan hangs."""
    hits = []
    for path in _scope_files(scope):
        if not _TEST_FILE_RE.search(path):
            continue
        try:
            with open(path, "rb") as fh:
                text = fh.read(_SOCKET_SCAN_MAX_BYTES).decode("utf-8", "replace")
        except OSError:
            continue
        m = _SOCKET_BIND_RE.search(text)
        if m:
            hits.append((path, m.group(1).strip()))
    return hits


def glob_to_regex(glob):
    """Translate a path glob to an anchored regex. '**' spans '/', '*' does not."""
    out = ["^"]
    i = 0
    while i < len(glob):
        c = glob[i]
        if c == "*":
            if glob[i:i + 2] == "**":
                out.append(".*")
                i += 2
                continue
            out.append("[^/]*")
        elif c == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(c))
        i += 1
    out.append("$")
    return "".join(out)


def gmatch(glob, path):
    return re.match(glob_to_regex(glob), path) is not None


def _contained(inner, outer):
    """True iff every path matched by scope glob `inner` is also matched by allowed glob `outer`.

    Soundness over generality (a single-witness approximation is not sound — `src/**` is not
    contained in `src/*/**`): a LITERAL scope path must match the allowed glob; a WILDCARD scope
    must EXACTLY equal an allowed glob. This never widens the ceiling. Over-strict is safe — the
    owner narrows the scope or lists the exact glob in `allowed_scope`.
    """
    if "*" in inner or "?" in inner:
        return inner == outer
    return gmatch(outer, inner)


def _static_prefix(glob):
    """The literal portion of a glob before its first wildcard character."""
    for i, c in enumerate(glob):
        if c in "*?":
            return glob[:i]
    return glob


def scopes_overlap(globs_a, globs_b):
    """D3: conservative (fail-closed) glob-set overlap check for the parallel-scope gate — reuses
    this module's own glob matcher (the one scope-check.sh and the PreToolUse hook use), so it
    can never drift from what "in scope" means elsewhere in the kit.

    Two globs are ruled DISJOINT only when that is provable: two different literal paths, or a
    literal that the other (wildcarded) glob does not match. Two wildcarded globs are compared by
    static prefix; a nesting/ambiguous pair (e.g. src/** vs src/payments/**) is treated as
    OVERLAPPING rather than risking a silent collision between two concurrent writers.
    """
    for a in globs_a:
        an = _norm(a)
        a_wild = "*" in an or "?" in an
        for b in globs_b:
            bn = _norm(b)
            b_wild = "*" in bn or "?" in bn
            if not a_wild and not b_wild:
                if an == bn:
                    return True
                continue
            if not a_wild:
                if gmatch(bn, an):
                    return True
                continue
            if not b_wild:
                if gmatch(an, bn):
                    return True
                continue
            pa, pb = _static_prefix(an), _static_prefix(bn)
            if pa.startswith(pb) or pb.startswith(pa):
                return True
    return False


def tokens_overlap(tokens_a, tokens_b):
    """D3 review-2 finding 1: exact-match overlap for optional per-task invariant_tokens -- a
    coarser, cheaper signal than file-glob disjointness for shared state a glob can't see (ports,
    external fixtures, domain invariants). Any shared token means busy."""
    return bool(set(tokens_a) & set(tokens_b))


def _norm(path):
    p = path.replace("\\", "/")
    while p.startswith("./"):
        p = p[2:]
    return p


def classify(scope_globs, relpath):
    """scratch (always writable) | forbidden (never) | in (a scope glob) | out."""
    p = _norm(relpath)
    if p == ".ap3-run" or p.startswith(SCRATCH_PREFIX):
        return "scratch"
    # any basename starting with .env is a credential file: .env, .env.local, .envrc, ...
    if p.startswith(FORBIDDEN_PREFIXES) or re.search(r"(^|/)\.env[^/]*$", p):
        return "forbidden"
    for g in scope_globs:
        if gmatch(_norm(g), p):
            return "in"
    return "out"


# ---------------------------------------------------------------- rubric (I1)
# A feature-readiness rubric (ap3/templates/feature-readiness.md, or a target repo's own
# docs/standards/feature-readiness.md) is loose markdown, not a data format: '## R<n> — <title>'
# tier headings, each followed by '- R<n>.<m> <criterion text>' bullets that may wrap onto
# indented continuation lines. Plexco's real v0.1 file predates the readiness_version frontmatter
# convention entirely (no '---' fence at all), so this loader tolerates both shapes rather than
# requiring parse_frontmatter's fence.
_RUBRIC_TIER_RE = re.compile(r"^## (R\d+)\b")
_RUBRIC_ITEM_RE = re.compile(r"^- (R\d+\.\d+)\s+(.*)$")


def _tier_gate(tier):
    """DESIGN-v2-product-flow.md §2 is explicit and numeric: "R1-R5" are hard gates, "R6-R8" are
    supervised. The tier NUMBER is authoritative -- review round 4 (code): an earlier design read
    the gate from the heading's own WORDING (whether it contained "supervised"), which let a
    heading merely mentioning that word in passing (e.g. "R1 -- Scope (needs supervised review)")
    silently demote a mandatory R1-R5 hard gate. A malformed tier string fails closed to "hard".
    """
    try:
        n = int(tier[1:])
    except (ValueError, IndexError):
        return "hard"
    return "supervised" if 6 <= n <= 8 else "hard"


def parse_rubric(path):
    """-> {"readiness_version": <val-or-None>, "items": [{"id","tier","text","gate"}, ...]}."""
    try:
        fm, body = parse_frontmatter(path)
    except ValueError:
        fm, body = {}, open(path, "r", encoding="utf-8").read()
    items = []
    tier = None
    current = None
    for raw in body.split("\n"):
        m = _RUBRIC_TIER_RE.match(raw)
        if m:
            tier = m.group(1)
            current = None
            continue
        m = _RUBRIC_ITEM_RE.match(raw)
        if m:
            item_tier = tier or m.group(1).split(".")[0]
            current = {"id": m.group(1), "tier": item_tier, "text": m.group(2).strip(),
                       "gate": _tier_gate(item_tier)}
            items.append(current)
            continue
        if raw.startswith("## "):    # any other heading ends the current item's continuation
            current = None
            continue
        stripped = raw.strip()
        if current is not None and stripped:
            current["text"] = (current["text"] + " " + stripped).strip()
    # review round 3 (security): a duplicate id would let one evidence.json verdict silently
    # answer for two distinct criteria; an id whose own numeric tier disagrees with the heading
    # it was actually filed under (e.g. "R1.1" misfiled under an "## R6" heading) would silently
    # inherit the WRONG gate strength -- a hard R1-R5 criterion demoted to supervised, or vice
    # versa. Both are rubric-authoring mistakes that must fail loud, not weaken the gate quietly.
    seen_ids = set()
    for it in items:
        if it["id"] in seen_ids:
            raise ValueError("rubric has a duplicate item id %r: %s" % (it["id"], path))
        seen_ids.add(it["id"])
        id_tier = it["id"].split(".")[0]
        if id_tier != it["tier"]:
            raise ValueError("rubric item %r is filed under %r's heading but its own id implies "
                              "tier %r: %s" % (it["id"], it["tier"], id_tier, path))
    # review round 1 (both code + security): zero items must fail CLOSED. A rubric that is
    # empty, unparseable, or simply the wrong file must never read as "everything passed" --
    # intake_score() sees no gaps at all over an empty item list and would otherwise return
    # READY_FOR_PLAN for input that is not a scored rubric at all.
    if not items:
        raise ValueError("rubric has no scorable items (check '## R<n>' / '- R<n>.<m>' "
                          "headings/bullets): %s" % path)
    return {"readiness_version": fm.get("readiness_version"), "items": items}


# ---------------------------------------------------------------- intake-score (I2)
def intake_score(rubric_path, evidence_path):
    """-> {"status", "hard_gaps", "supervised_gaps", "gaps"} from a rubric + a per-item verdict.

    Deterministic aggregation only -- gathering the evidence itself is the interactive
    ap3-intake skill's job (it needs docs + judgement, not a pure function). Fail-closed to match
    DESIGN-v2-product-flow.md §2 ("no suy diễn"): a verdict that is neither PASS nor N/A --
    including one simply absent from evidence.json -- counts as GAP. A single GAP in a "hard"
    tier (R1-R5) always wins over any number of GAPs in a "supervised" tier (R6-R8).
    """
    rubric = parse_rubric(rubric_path)
    with open(evidence_path, encoding="utf-8") as fh:
        evidence = json.load(fh)
    hard_gaps, supervised_gaps = [], []
    for item in rubric["items"]:
        if evidence.get(item["id"]) in ("PASS", "N/A"):
            continue
        (hard_gaps if item["gate"] == "hard" else supervised_gaps).append(item["id"])
    if hard_gaps:
        status = "NOT_READY"
    elif supervised_gaps:
        status = "READY_WITH_SUPERVISED_SLICES"
    else:
        status = "READY_FOR_PLAN"
    return {"status": status, "hard_gaps": hard_gaps, "supervised_gaps": supervised_gaps,
            "gaps": hard_gaps + supervised_gaps}


# ---------------------------------------------------------------- lint
def _section(body, heading):
    """Return the text under '## heading' up to the next '## ' or EOF, or None."""
    lines = body.split("\n")
    start = None
    for i, ln in enumerate(lines):
        if ln.strip() == "## " + heading:
            start = i + 1
            break
    if start is None:
        return None
    out = []
    for ln in lines[start:]:
        if ln.startswith("## "):
            break
        out.append(ln)
    return "\n".join(out)


# a strict repo-file shape: dir/…/name.ext — used to find real paths named in Context
_PATHISH = re.compile(r"[A-Za-z0-9._/-]+\.[A-Za-z0-9]+")


def _context_paths(context_text):
    out = []
    for tok in _PATHISH.findall(context_text):
        if "/" not in tok or ".." in tok or tok.startswith(SCRATCH_PREFIX):
            continue
        out.append(tok)
    return out


def lint(taskfile):
    """Return None on success, else 'INVALID_TASK <slug>: <reason>'. cwd = repo root."""
    npath = _norm(taskfile)
    slug_from_name = os.path.basename(npath)[:-3] if npath.endswith(".md") else ""
    parent = os.path.dirname(npath)

    def bad(reason):
        return "INVALID_TASK %s: %s" % (slug_from_name or "?", reason)

    if not (parent.endswith("ap3/queue") or parent == "ap3/queue"):
        return bad("task must live at ap3/queue/<slug>.md, not %r" % taskfile)
    if not re.match(r"^[a-z0-9][a-z0-9-]{2,60}$", slug_from_name):
        return bad("filename slug must match ^[a-z0-9][a-z0-9-]{2,60}$")

    try:
        fm, body = parse_frontmatter(taskfile)
    except (OSError, ValueError) as e:
        return bad(str(e))

    # required keys + types
    if fm.get("slug") != slug_from_name:
        return bad("frontmatter slug %r != filename slug %r" % (fm.get("slug"), slug_from_name))
    cls = fm.get("class")
    if not isinstance(cls, str) or not cls:
        return bad("class must be a non-empty string")
    if fm.get("risk") not in RISKS:
        return bad("risk must be one of P1|P2|P3, got %r" % fm.get("risk"))
    if fm.get("risk") != "P2":
        return bad("only P2 tasks are auto-dispatchable (P1 stays supervised, P3 is read-only)")
    scope = fm.get("scope")
    if not isinstance(scope, list) or not scope:
        return bad("scope must be a non-empty list of globs")
    # D3 review-2 finding 1: optional -- free-form tags for shared state a file glob can't see
    # (ports, external fixtures, domain invariants) that ALSO gate parallel admission. Absent =
    # today's file-glob-only behaviour, unaffected.
    inv_tokens = fm.get("invariant_tokens")
    if inv_tokens is not None:
        if not isinstance(inv_tokens, list) or not all(isinstance(t, str) and t for t in inv_tokens):
            return bad("invariant_tokens must be a list of non-empty strings")
    verify = fm.get("verify")
    if not isinstance(verify, str) or not verify.strip():
        return bad("verify must be a non-empty string")
    # D5: optional -- a command the DISPATCHER runs unsandboxed on the host, after review is
    # CLEAN and before push, for verification the sandboxed writer cannot do itself (e.g. a real
    # DB connection). A single command string, same shape as `verify`.
    verify_host = fm.get("verify_host")
    if verify_host is not None:
        if not isinstance(verify_host, str) or not verify_host.strip():
            return bad("verify_host must be a non-empty single command string")
        # review round-3 finding 4: runs via `bash -c` on the host -- any shell composition
        # (chaining, piping, substitution, redirection, subshell, background) could fabricate a
        # PASS regardless of the real command's outcome (e.g. `npm test || true` always exits 0),
        # defeating the whole point of the gate. Same character class `verify` already rejects
        # above, but stricter: verify_host allows NO joining at all (not even '&&'/';') -- it
        # must be exactly ONE plain command + arguments, matching the addendum's own words ("a
        # single command string"); a multi-step check belongs in a committed wrapper script.
        if re.search(r"[\n|`$><()]", verify_host) or "\\" in verify_host or "&" in verify_host or ";" in verify_host:
            return bad("verify_host must be a single plain command (no chaining/pipe/substitution/redirection/subshell/background)")
    try:
        budget = float(fm.get("budget_usd"))
    except (TypeError, ValueError):
        return bad("budget_usd must be a number")
    if not math.isfinite(budget) or budget <= 0:   # reject nan/inf, which slip past <=0 and >cap
        return bad("budget_usd must be a finite number > 0")
    try:
        rounds = int(fm.get("max_review_rounds"))
    except (TypeError, ValueError):
        return bad("max_review_rounds must be an integer")
    if not (1 <= rounds <= 5):
        return bad("max_review_rounds must be 1..5")

    # routines.json (from the repo being linted, not the kit)
    try:
        with open("ap3/routines.json", encoding="utf-8") as fh:
            routines = json.load(fh)
    except (OSError, ValueError) as e:
        return bad("cannot read ap3/routines.json: %s" % e)
    classes = routines.get("classes", {})
    if cls not in classes:
        return bad("class %r not in ap3/routines.json" % cls)
    cdef = classes[cls]
    if cdef.get("status") != "enabled":
        return bad("class %r is not enabled" % cls)
    if cdef.get("risk") != fm.get("risk"):
        return bad("risk %r != class risk %r" % (fm.get("risk"), cdef.get("risk")))
    try:
        cap = float(cdef.get("budget_usd_max"))
    except (TypeError, ValueError):
        return bad("class %r has no numeric budget_usd_max" % cls)
    if not math.isfinite(cap) or cap <= 0:
        return bad("class %r budget_usd_max must be a finite number > 0" % cls)
    if budget > cap:
        return bad("budget_usd %s exceeds class cap %s" % (budget, cap))
    # registry policy must be well-formed, else the dispatcher's numeric/enum checks fail open
    mrpd = cdef.get("max_runs_per_day")
    if not isinstance(mrpd, int) or isinstance(mrpd, bool) or mrpd < 1:
        return bad("class %r max_runs_per_day must be a positive integer" % cls)
    if cdef.get("security_review") not in ("auto", "always", "none"):
        return bad("class %r security_review must be one of auto|always|none" % cls)
    # K26: optional per-class override of the fix-writer budget floor. Validated here, at lint
    # time, for the same reason max_parallel is: dispatch.sh reads it with a python default and a
    # malformed value would otherwise fail OPEN into "use the default" -- silently restoring the
    # very behaviour this key exists to change.
    if "writer_min_budget_usd" in cdef:
        wmb = cdef["writer_min_budget_usd"]
        if isinstance(wmb, bool) or not isinstance(wmb, (int, float)):
            return bad("class %r writer_min_budget_usd must be a number" % cls)
        if not math.isfinite(float(wmb)) or float(wmb) <= 0:
            return bad("class %r writer_min_budget_usd must be a finite number > 0" % cls)
    # review round-2 finding 2: a malformed max_parallel (e.g. a string) slips past dispatch.sh's
    # bash integer comparisons and fails OPEN into the parallel-admission branch -- catch it here,
    # at lint time, before any candidate of this class is ever dispatched under it.
    mp = cdef.get("max_parallel", 1)
    if not isinstance(mp, int) or isinstance(mp, bool) or mp < 1:
        return bad("class %r max_parallel must be a positive integer" % cls)
    if "db_per_run" in cdef and not isinstance(cdef["db_per_run"], bool):
        return bad("class %r db_per_run must be a boolean" % cls)
    # D5: needs_db (optional, default false) marks a class whose sandboxed writer can never reach
    # a real database (sandbox network denies raw TCP to Postgres) -- a task in that class must
    # route DB-touching verification through verify_host (dispatcher-side, unsandboxed) rather
    # than a `verify` that would just fail in the sandbox every time.
    if "needs_db" in cdef and not isinstance(cdef["needs_db"], bool):
        return bad("class %r needs_db must be a boolean" % cls)
    # review round-4 finding 3: this must fire regardless of verify_host. verify_host is an
    # ADDITIONAL dispatcher-side step, never a substitute for `verify` -- the writer's own
    # `verify` always runs inside the sandbox first (reconcile_running requires .ap3-run/verify to
    # read pass before review even starts), so a DB marker in `verify` fails there every time,
    # whether or not the task also declares a verify_host. The original D5 addendum's "when
    # verify_host is absent" qualifier was a spec oversight, not a deliberate design choice.
    if cdef.get("needs_db"):
        for marker in ("test:db", "psql", "docker"):
            if marker in verify:
                return bad("class %r is needs_db: verify %r mentions %r, which would fail in the sandbox -- route DB-touching checks through verify_host instead" % (cls, verify, marker))
        # review round-5 finding 1: forbidding DB markers in `verify` isn't enough on its own -- a
        # needs_db task with an innocuous `verify` (e.g. "npm test", no DB markers) and no
        # verify_host at all would still reach READY having never run any real DB check, exactly
        # the gap D5 exists to close. needs_db must actually REQUIRE verify_host, not just forbid
        # one way of faking a DB check inside the sandbox. This is the limit of what lint can
        # enforce here: it cannot verify a command's real semantics, so a lying verify_host (e.g.
        # `true`) still passes -- the rest is an operator/reviewer trust boundary, same as `verify`
        # itself already is.
        if not verify_host:
            return bad("class %r is needs_db: task must set verify_host (verify alone cannot reach a real database from the sandbox)" % cls)
    # review round-4 finding 6: an explicit [] must be rejected, not silently treated the same as
    # "key absent" -- `cdef.get(...) or [default]` masks a config mistake either way. And a
    # writer_models_allowed that is accidentally a STRING (not a list) makes the later `model not
    # in models_allowed` check do Python's SUBSTRING match instead of list membership (e.g.
    # "claude-sonnet-5" in "claude-sonnet-50" is True) -- validating the type here, once, makes
    # that downstream `in` check correct for free (it can only ever see a real list from here on).
    if "writer_models_allowed" in cdef:
        wma = cdef["writer_models_allowed"]
        if not isinstance(wma, list) or not wma or not all(isinstance(m, str) and m for m in wma):
            return bad("class %r writer_models_allowed must be a non-empty list of non-empty strings" % cls)
    allowed = cdef.get("allowed_scope") or []

    # D2: model: <id> (optional) must be one of the class's writer_models_allowed, defaulting to
    # the single model start_next would pick anyway (class writer_model > top-level writer_model
    # > claude-sonnet-5) when the class declares no explicit allowlist.
    model = fm.get("model")
    if model is not None:
        if not isinstance(model, str) or not model.strip():
            return bad("model must be a non-empty string")
        default_model = cdef.get("writer_model") or routines.get("writer_model") or "claude-sonnet-5"
        models_allowed = cdef.get("writer_models_allowed") or [default_model]
        if model not in models_allowed:
            return bad("model %r is not in class %r's writer_models_allowed %r" % (model, cls, models_allowed))

    # trust.json: paused classes are not dispatchable (absent file = not paused). The dispatcher
    # points AP3_TRUST_PATH at the real state file when it lints inside a worktree (whose own
    # ap3/state is empty); the owner's standalone lint uses the repo's ap3/state/trust.json.
    trust_path = os.environ.get("AP3_TRUST_PATH", "ap3/state/trust.json")
    if os.path.exists(trust_path):
        try:
            with open(trust_path, encoding="utf-8") as fh:
                trust = json.load(fh)
            if trust.get(cls, {}).get("paused"):
                return bad("class %r is paused in ap3/state/trust.json" % cls)
        except (OSError, ValueError):
            pass  # a corrupt trust file is a dispatcher concern, not a task defect

    # scope entries: safe, and each genuinely CONTAINED by an allowed_scope glob (not just a
    # literal string match — `src/*` must not accept the broader `src/**`)
    for entry in scope:
        e = _norm(entry)
        if e.startswith("/") or ".." in e:
            return bad("scope entry %r must be a repo-relative path without '..'" % entry)
        if classify(scope, e) == "forbidden":
            return bad("scope entry %r touches .claude/ ap3/ .github/ or .env*" % entry)
        if not any(_contained(e, _norm(a)) for a in allowed):
            return bad("scope entry %r is not contained by any allowed_scope of class %r "
                       "(a wildcard scope must not widen the ceiling)" % (entry, cls))

    # verify must be plain '&&'/';'-joined runner commands — no shell composition that could mask a
    # red test (`npm test || true`), pipe, redirect, substitution, subshell or background.
    if re.search(r"[\n|`$><()]", verify) or "\\" in verify:
        return bad("verify must be plain '&&'/';'-joined commands (no | ` $ > < ( ) newline)")
    if "&" in verify.replace("&&", ""):
        return bad("verify may only use '&&' to join commands, not background '&'")
    for seg in re.split(r"&&|;", verify):
        toks = seg.split()
        if not toks:
            continue
        if toks[0] not in VERIFY_PREFIXES:
            return bad("verify segment %r must start with one of %s" % (seg.strip(), "/".join(VERIFY_PREFIXES)))
        if toks[0] == "bash" and (len(toks) < 2 or toks[1].startswith("/") or ".." in toks[1]):
            return bad("verify 'bash' must run a repo-relative script path")

    # body headings present and non-empty
    for h in ("Problem", "Acceptance", "Context"):
        sec = _section(body, h)
        if sec is None:
            return bad("missing '## %s' heading" % h)
        if not sec.strip():
            return bad("'## %s' section is empty" % h)

    # every repo path named in Context exists in the working tree
    for tok in _context_paths(_section(body, "Context")):
        if not os.path.exists(tok):
            return bad("Context names %r which does not exist in the working tree" % tok)

    # K27: a scope test file that binds a socket can only pass on the host -> verify_host is
    # required, and `verify` (always sandboxed) must not run that file by name.
    for path, call in socket_binding_tests(scope):
        if not verify_host:
            return bad("scope test file %r binds a socket (%s) which the writer sandbox refuses "
                       "(listen EPERM, K27) -- route that check through verify_host" % (path, call))
        if _verify_names_file(verify, path):
            return bad("verify %r names %r, which binds a socket (%s) and so cannot pass inside the "
                       "sandbox (K27) -- run it from verify_host only" % (verify, path, call))

    # D1: after: <slug> (optional, one slug or a list) -- shape + existence only here. Whether a
    # named predecessor has actually RUN and succeeded is a dispatch-time (run-state) concern,
    # checked by dispatch.sh's start_next, not this file (which only reads the working tree).
    after = fm.get("after")
    if after is not None:
        after_list = [after] if isinstance(after, str) else (after if isinstance(after, list) else None)
        if after_list is None:
            return bad("after must be a slug string or a list of slug strings")
        # review round-4 finding 4: `after:` present but blank parses to [] (parse_frontmatter's
        # "empty value opens a list block" that never gets any '- item' lines) -- indistinguishable
        # from a deliberate empty list, and near-certainly a templating/authoring mistake (the key
        # was declared but never filled in), NOT "no dependency" (that case never reaches here --
        # `after` stays None when the key is absent entirely). Reject it rather than silently
        # treating it the same as no `after:` at all.
        if not after_list:
            return bad("after is present but empty -- remove the key entirely for no dependency, or fill in at least one slug")
        for a in after_list:
            if not isinstance(a, str) or not re.match(r"^[a-z0-9][a-z0-9-]{2,60}$", a):
                return bad("after entry %r must match ^[a-z0-9][a-z0-9-]{2,60}$" % (a,))
            # review round-6 finding 1: a task referencing its own slug would wait on itself
            # forever -- detectable from this ONE file alone (unlike a genuine A<->B cycle across
            # separate files, which needs the whole queue graph -- that's dispatch.sh's job).
            if a == slug_from_name:
                return bad("after entry %r references its own slug -- a task cannot depend on itself" % (a,))
            if not (os.path.exists("ap3/queue/%s.md" % a) or os.path.exists("ap3/queue/done/%s.md" % a)):
                return bad("after entry %r has no ap3/queue/%s.md or ap3/queue/done/%s.md" % (a, a, a))

    # review round-6 finding 5: feature: (optional, copied into the record/evidence row and
    # filtered by report.sh --feature) was never type-checked -- a blank or list-valued feature:
    # passed lint and was serialized as the literal string "[]" downstream, breaking that filter.
    feature = fm.get("feature")
    if feature is not None and (not isinstance(feature, str) or not feature.strip()):
        return bad("feature must be a non-empty string")

    # I3: milestone: (marks the last slice of a plan milestone) and supervised: (a migration/
    # i18n/UI/off-lane slice a human runs by hand) are the plan-emitter's own optional keys.
    # The hand-rolled frontmatter parser has no bool type -- every scalar is a string -- so "true"
    # or "false" (the only shapes plan-emit or a human would write) is what "a real bool" means
    # here.
    for boolkey in ("milestone", "supervised"):
        v = fm.get(boolkey)
        if v is not None and v not in ("true", "false"):
            return bad("%s must be true or false" % boolkey)
    if fm.get("supervised") == "true":
        return bad("supervised: true task must not be queued at ap3/queue/<slug>.md -- "
                    "supervised slices are plan-only (a PLAN.md row), never auto-dispatched")

    return None


# ---------------------------------------------------------------- plan-emit (I3)
def _format_frontmatter(fm):
    lines = ["---"]
    for k, v in fm.items():
        if isinstance(v, list):
            lines.append("%s:" % k)
            lines.extend("  - %s" % item for item in v)
        else:
            lines.append("%s: %s" % (k, v))
    lines.append("---")
    return "\n".join(lines)


_PLAN_REQUIRED = ("class", "scope", "verify", "budget_usd", "problem", "acceptance", "context")
# Same shape lint()'s own slug_from_name / after: checks already require -- reused here so a
# slug can never place a file outside ap3/queue/ (review round 1, both code + security rounds:
# an unvalidated slug like "../../etc/evil" traversed straight out of the queue directory).
_PLAN_SLUG_RE = re.compile(r"^[a-z0-9][a-z0-9-]{2,60}$")


def _safe_scalar_str(v):
    """A string plan_emit() may safely write as a frontmatter scalar: no newline/CR, which the
    hand-rolled line-based parser would otherwise read back as one or more EXTRA keys (review
    round 2, code: `feature: "widget\\nmilestone: true"` silently injected a real milestone flag).
    """
    return isinstance(v, str) and v.strip() != "" and "\n" not in v and "\r" not in v


def _rollback(paths):
    """Remove every path, returning the ones that could NOT be removed. Review round 5
    (security): a caller must never claim "rolled back, nothing written" when a removal itself
    failed -- silently swallowing that would leave a file behind while reporting success.
    """
    leftover = []
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            leftover.append(p)
    return leftover


def plan_emit(plan_path):
    """Turn an already-decided ap3-plan slice list into ap3/queue/<slug>.md files (cwd = repo
    root, matching lint()'s own convention). Prints one line per slice:
      WROTE <slug>                       -- a queue file was written
      SKIPPED <slug> (supervised: ...)   -- never written; plan-only, human runs it by hand
      ERROR ...                          -- the plan (or one slice of it) is invalid
    Returns 0 iff the whole plan was clean and every dispatchable slice was WROTE, else 1.

    All-or-nothing (review round 1, both rounds independently): the WHOLE plan is validated --
    slug shape/uniqueness, field types, no embedded newline that could inject an extra
    frontmatter key, no pre-existing file (symlink included), and every supervised prerequisite
    actually landed -- before a single file is written. A later slice's problem must never leave
    earlier slices half-emitted on disk, indistinguishable from a clean prior run.

    `after:` chains to the previous DISPATCHABLE slice only -- a supervised slice is transparent
    to the chain (it has no queue file, so pointing `after:` at it would fail lint's own
    existence check). A supervised slice also GATES every slice after it: unless it carries
    `"landed": true` (the owner's own confirmation that it already merged), nothing later in the
    plan is emitted at all -- otherwise a dependent slice could dispatch and merge before the real
    prerequisite exists.

    `milestone: true` + an explicit `milestone_id` (e.g. "M1") go on the last dispatchable slice
    of each contiguous milestone-number run, so the dispatcher reads the real number instead of
    guessing it back out of the slug text -- but ONLY when every supervised slice sharing that
    milestone number has also landed (review round 2, both rounds: a TRAILING unlanded supervised
    slice has nothing dispatchable after it to trip the blocking gate above, so without this
    separate check the slice before it could still wrongly claim the milestone complete). A
    milestone with no dispatchable slice at all, or an unlanded supervised member, just gets no
    marker printed as a NOTE, rather than a false completion signal.
    """
    with open(plan_path, encoding="utf-8") as fh:
        plan = json.load(fh)
    if not isinstance(plan, dict):
        print("ERROR: plan.json must be a JSON object")
        return 1
    feature = plan.get("feature")
    slices = plan.get("slices")

    errors = []
    if not _safe_scalar_str(feature):
        errors.append("ERROR: plan.feature must be a non-empty single-line string")
    if not isinstance(slices, list) or not slices:
        errors.append("ERROR: plan.slices must be a non-empty list")
        slices = []
    elif not all(isinstance(s, dict) for s in slices):
        errors.append("ERROR: every entry in plan.slices must be a JSON object")
        slices = []

    # review round 4 (security): open(path, "x") only guards the FINAL path component against
    # being a symlink -- it still follows a symlinked ap3/queue DIRECTORY itself, redirecting
    # every write outside the intended tree. Checked once, up front: a fresh repo where
    # ap3/queue does not exist yet is fine (os.makedirs creates a real directory).
    if os.path.islink("ap3/queue"):
        errors.append("ERROR: ap3/queue is a symlink, refusing to write through it")

    # ---- pass 1 (data gathering, not itself the source of truth for errors below): milestone
    # contiguity, which milestone number each dispatchable slice's index belongs to, and which
    # milestone numbers have a supervised member that is not (yet) landed: true. A slice with a
    # malformed milestone/supervised/landed shape is simply skipped here -- pass 2 below reports
    # the real error for it; this pass only needs to not crash on bad input.
    #
    # review round 5 (both rounds): a milestone is atomic -- ONE unlanded supervised member
    # blocks EVERY dispatchable slice of that milestone, not just the ones textually after it.
    # The earlier design only blocked "everything after the first unlanded supervised slice in
    # LIST ORDER," which let a slice BEFORE it still be emitted (and, once merged, permanently
    # occupy its slug) -- exactly what made the "wait, then resubmit the whole milestone" recovery
    # this skill instructs unenforceable: those earlier slugs would already be taken. Tracked by
    # ordinal GROUP index (each milestone-number transition, not the number itself) so this holds
    # even if milestone numbers are not literally ascending integers.
    seen_closed = set()
    last_m, have_last = None, False
    last_dispatchable_idx = {}
    milestone_incomplete = set()
    group_idx = -1
    slice_group = {}
    group_blocker = {}   # ordinal group index -> slug of its unlanded supervised member
    for i, s in enumerate(slices):
        m = s.get("milestone")
        if m is None or isinstance(m, bool) or not isinstance(m, int) or m <= 0:
            continue
        if not have_last or m != last_m:
            if have_last and last_m not in seen_closed:
                seen_closed.add(last_m)
            last_m, have_last = m, True
            group_idx += 1
        slice_group[i] = group_idx
        sup = s.get("supervised")
        if sup is True:
            if s.get("landed") is not True:
                milestone_incomplete.add(m)
                group_blocker.setdefault(group_idx, s.get("slug", "?"))
        elif sup is False or sup is None:
            last_dispatchable_idx[m] = i
    block_from_group = min(group_blocker) if group_blocker else None
    blocking_slug = group_blocker.get(block_from_group) if block_from_group is not None else None

    # ---- pass 2: the real per-slice validation, gathering EVERY problem before writing anything.
    seen_slugs = set()
    last_m, have_last = None, False
    seen_closed = set()
    for i, s in enumerate(slices):
        slug = s.get("slug")
        if not isinstance(slug, str) or not _PLAN_SLUG_RE.match(slug):
            errors.append("ERROR at index %d: slug %r must match %s"
                          % (i, slug, _PLAN_SLUG_RE.pattern))
            continue
        if slug in seen_slugs:
            errors.append("ERROR %s: slug appears more than once in this plan" % slug)
            continue
        seen_slugs.add(slug)

        m = s.get("milestone")
        if m is None:
            errors.append("ERROR %s: missing milestone number" % slug)
            continue
        if isinstance(m, bool) or not isinstance(m, int) or m <= 0:
            errors.append("ERROR %s: milestone must be a positive integer, got %r" % (slug, m))
            continue
        if not have_last or m != last_m:
            if m in seen_closed:
                errors.append("ERROR %s: milestone %r is not contiguous in the slice list"
                              % (slug, m))
                continue
            if have_last:
                seen_closed.add(last_m)
            last_m, have_last = m, True

        sup = s.get("supervised")
        if sup is not None and not isinstance(sup, bool):
            errors.append("ERROR %s: supervised must be true or false (a real boolean), got %r"
                          % (slug, sup))
            continue
        landed = s.get("landed")
        if landed is not None and not isinstance(landed, bool):
            errors.append("ERROR %s: landed must be true or false (a real boolean), got %r"
                          % (slug, landed))
            continue
        # review round 4 (security): a bare `landed: true` is an unverifiable claim -- require a
        # companion landed_sha naming the commit the owner is asserting actually merged, so the
        # claim at least points at something checkable. plan_emit() has no git access (this
        # module's own boundary: git/network checks live outside aplib.py), so it cannot confirm
        # landed_sha is really on origin/main -- that verification is ap3-plan/SKILL.md's own
        # documented responsibility before it ever writes "landed": true into plan.json.
        if landed is True:
            landed_sha = s.get("landed_sha")
            if not isinstance(landed_sha, str) or not re.match(r"^[0-9a-f]{7,40}$", landed_sha):
                errors.append("ERROR %s: landed: true requires a companion landed_sha "
                              "(a 7-40 char hex commit id), got %r" % (slug, landed_sha))
                continue
        if sup is True:
            continue   # a supervised slice carries no other queue fields to validate
        # review round 5 (both rounds): block the WHOLE milestone group, not just slices textually
        # after the unlanded member -- see pass 1's comment for why "everything after, in list
        # order" was not enough.
        if block_from_group is not None and slice_group.get(i, -1) >= block_from_group:
            errors.append("ERROR %s: blocked -- supervised prerequisite %r is not marked "
                          "landed: true yet" % (slug, blocking_slug))
            continue

        missing = [k for k in _PLAN_REQUIRED if not s.get(k)]
        if missing:
            errors.append("ERROR %s: missing required field(s) %s" % (slug, ", ".join(missing)))
            continue
        if not _safe_scalar_str(s["class"]):
            errors.append("ERROR %s: class must be a non-empty single-line string" % slug)
            continue
        if not _safe_scalar_str(s["verify"]):
            errors.append("ERROR %s: verify must be a non-empty single-line string" % slug)
            continue
        vh = s.get("verify_host")
        if vh is not None and not _safe_scalar_str(vh):
            errors.append("ERROR %s: verify_host must be a non-empty single-line string" % slug)
            continue
        model = s.get("model")
        if model is not None and not _safe_scalar_str(model):
            errors.append("ERROR %s: model must be a non-empty single-line string" % slug)
            continue
        risk = s.get("risk", "P2")
        if not _safe_scalar_str(risk):
            errors.append("ERROR %s: risk must be a non-empty single-line string" % slug)
            continue
        scope = s["scope"]
        if not isinstance(scope, list) or not scope or not all(_safe_scalar_str(x) for x in scope):
            errors.append("ERROR %s: scope must be a non-empty list of single-line strings" % slug)
            continue
        # review round 5 (security): optional, but must be validated (matching lint()'s own rule)
        # rather than silently dropped -- the dispatcher's D3 parallel-admission gate depends on
        # a task's invariant_tokens being real when the plan actually declared some.
        inv_tokens = s.get("invariant_tokens")
        if inv_tokens is not None and (not isinstance(inv_tokens, list) or not inv_tokens
                                        or not all(_safe_scalar_str(t) for t in inv_tokens)):
            errors.append("ERROR %s: invariant_tokens must be a non-empty list of single-line "
                          "strings" % slug)
            continue
        budget = s["budget_usd"]
        if isinstance(budget, bool) or not isinstance(budget, (int, float)) or budget <= 0:
            errors.append("ERROR %s: budget_usd must be a positive number" % slug)
            continue
        rounds = s.get("max_review_rounds", 3)
        if isinstance(rounds, bool) or not isinstance(rounds, int):
            errors.append("ERROR %s: max_review_rounds must be an integer" % slug)
            continue
        bad_body = [k for k in ("problem", "acceptance", "context")
                    if not isinstance(s[k], str) or not s[k].strip()]
        if bad_body:
            errors.append("ERROR %s: %s must be non-empty string(s)" % (slug, ", ".join(bad_body)))
            continue

        path = "ap3/queue/%s.md" % slug
        # review round 2 (security): exists() follows symlinks and reads False for a DANGLING
        # one -- lexists() catches the path being occupied by ANY filesystem entry, symlink
        # included, so a planted dangling symlink is refused here instead of being silently
        # followed by open(path, "w") later. Also reserve a slug already merged (queue/done/).
        if os.path.lexists(path) or os.path.lexists("ap3/queue/done/%s.md" % slug):
            errors.append("REFUSED %s: a file already exists at or under ap3/queue/ for this slug"
                          % slug)

    if errors:
        for e in errors:
            print(e)
        return 1

    # every slice validated -- now write for real. A real filesystem problem (permissions, disk
    # full, or a genuine TOCTOU race against the lexists() checks above) can still fail a write
    # here, and a written file can still fail lint()'s fuller business rules (class enabled,
    # scope actually contained by allowed_scope, budget under the class cap, verify free of shell
    # composition, etc.) even though it passed this function's own shape checks (review round 3,
    # both rounds: a `verify: "npm test || true"` reproduction passed here and only lint()
    # rejected it). Either failure rolls back EVERY file this invocation wrote -- otherwise the
    # documented "fix plan.json and re-emit" flow could never succeed: the bad slug would
    # permanently occupy its path with content nobody will read again.
    prev_slug = None
    written_paths = []
    try:
        for i, s in enumerate(slices):
            slug = s["slug"]
            if s.get("supervised") is True:
                print("SKIPPED %s (supervised: %s)" % (slug, s.get("reason", "no reason given")))
                continue   # prev_slug intentionally unchanged: nothing for `after:` to point at
            fm = {"slug": slug, "class": s["class"], "risk": s.get("risk", "P2"),
                  "scope": s["scope"], "verify": s["verify"]}
            if s.get("verify_host"):
                fm["verify_host"] = s["verify_host"]
            if s.get("invariant_tokens"):
                fm["invariant_tokens"] = s["invariant_tokens"]
            fm["budget_usd"] = s["budget_usd"]
            fm["max_review_rounds"] = s.get("max_review_rounds", 3)
            if s.get("model"):
                fm["model"] = s["model"]
            fm["feature"] = feature
            if prev_slug:
                fm["after"] = prev_slug
            m = s["milestone"]
            if i == last_dispatchable_idx.get(m):
                if m in milestone_incomplete:
                    print("NOTE %s: milestone M%s NOT marked complete -- a supervised slice "
                          "sharing this milestone is not yet landed: true" % (slug, m))
                else:
                    fm["milestone"] = "true"
                    fm["milestone_id"] = "M%s" % m
            body = "## Problem\n%s\n## Acceptance\n%s\n## Context\n%s\n" % (
                s["problem"], s["acceptance"], s["context"])
            os.makedirs("ap3/queue", exist_ok=True)
            path = "ap3/queue/%s.md" % slug
            # review round 2 (security): "x" (O_CREAT|O_EXCL) -- POSIX guarantees this fails on
            # a symlink regardless of its target, so even a validate-then-write race cannot be
            # tricked into following one out of ap3/queue/.
            with open(path, "x", encoding="utf-8") as out:
                # review round 4 (code): track the path as soon as open() succeeds -- "x" mode
                # already creates the (empty) file on disk at this point, so if write() or the
                # implicit close() below raises, cleanup must still know to remove it. Appending
                # only after the `with` block exited cleanly missed exactly that case.
                written_paths.append(path)
                out.write(_format_frontmatter(fm) + "\n" + body)
            print("WROTE %s" % slug)
            prev_slug = slug
    except OSError as e:
        leftover = _rollback(written_paths)
        if leftover:
            print("ERROR: write failed (%s) -- rolled back, but could NOT remove: %s "
                  "(remove by hand before retrying)" % (e, ", ".join(leftover)))
        else:
            print("ERROR: write failed (%s) -- rolled back, nothing written" % e)
        return 1

    # review round 5 (security): lint() is designed to return an error STRING, never raise -- but
    # it is not this function's job to bet its own rollback guarantee on that always holding for
    # every routines.json shape lint() has ever been asked to parse. Treat an unexpected
    # exception from lint() itself as a lint failure too, so rollback ALWAYS runs.
    try:
        lint_errors = [err for err in (lint(p) for p in written_paths) if err]
    except Exception as e:
        lint_errors = ["lint() itself raised %r validating a generated file" % e]
    if lint_errors:
        leftover = _rollback(written_paths)
        if leftover:
            print("ERROR: generated queue file(s) failed lint -- rolled back, but could NOT "
                  "remove: %s (remove by hand before retrying):" % ", ".join(leftover))
        else:
            print("ERROR: generated queue file(s) failed lint -- rolled back, nothing written:")
        for e in lint_errors:
            print("  " + e)
        return 1
    return 0


# ---------------------------------------------------------------- extract_findings (I1)
# review.sh's own MARKER prompt quotes both verdict literals as instructions ("AP3_REVIEW_VERDICT:
# CLEAN (no actionable finding...)", "... FINDINGS (then a numbered list...)"), and codex commonly
# echoes that instruction text -- and a rubric-style '### Findings' (three '#') -- near the top of
# a long transcript while restating what it was asked to do. Neither is the real verdict: the
# actual block opens with a two-'#' '## Findings' heading further down, after tool calls and file
# dumps, and review.sh always appends its own canonicalized 'AP3_REVIEW_VERDICT: ...' line after
# printing the reviewer's raw output -- so the true verdict line is often repeated. A real pilot
# run buried two P1 findings at line 6465 of a 14,130-line concatenation of two raw transcripts
# while the fix writer found and fixed only the P2 sitting at line 14116 (see W5.2-BUILD-PROMPT.md
# I1) -- taking the LAST '## Findings' heading through the LAST verdict line skips every
# prompt-echo (always earlier in the transcript) and keeps the whole real tail, including a
# trailing 'ADVISORY (outside change set)' section and every repeated verdict line.
# review round 1 (code) finding 1: no leading whitespace allowed -- a real heading always starts
# at column 0; a 4-space-indented '## Findings' is Markdown CODE (a fenced/indented block quoting
# the convention, e.g. inside an example or a nested transcript), and matching it too would let a
# later, spurious quoted heading reset `start` and silently drop every real finding before it.
# security review round 4 finding 1: `\s` (and plain `.strip()` below) match/strip ANY Unicode
# whitespace (e.g. U+00A0 NBSP), but CommonMark permits only ASCII space/tab in these exact
# positions -- accepting more lets an attacker use an "invisible" Unicode space to smuggle a line
# past a strict reader's own idea of what closes a fence or what starts a heading, exactly the
# desync this module exists to refuse. `[ \t]` throughout, never `\s`.
_FINDINGS_HEADING_RE = re.compile(r"^##[ \t]+Findings\b")
_VERDICT_LINE_RE = re.compile(r"^AP3_REVIEW_VERDICT:")
# security review round 2 finding 1: a CommonMark fence is 3+ backticks OR 3+ tildes, allowed up to
# 3 leading spaces (4+ is a DIFFERENT construct, an indented code block, already excluded by the
# column-0 anchor above); a fence closes only on a line using the SAME character, AT LEAST as many
# repeats as the opener, and nothing but whitespace after them (round 1's simple toggle missed
# exactly these: an indented fence, a `~~~` fence, and a 4-backtick-opened fence wrongly "closed" by
# an inner 3-backtick example line).
_FENCE_RE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")


def _fence_marker(line):
    """-> (char, length, could_close, valid_open) if `line` matches a fence pattern, else None.
    could_close: nothing but ASCII space/tab after the delimiter (a closing fence allows no info
    string; CommonMark permits only space/tab here, NOT arbitrary Unicode whitespace -- security
    review round 4 finding 1). valid_open: CommonMark forbids a backtick anywhere in a BACKTICK
    fence's own info string (a tilde fence has no such restriction) -- a line that fails this is
    literal text, not a real fence marker, however much it may look like one.
    """
    m = _FENCE_RE.match(line)
    if not m:
        return None
    token, rest = m.group(1), m.group(2)
    char, length = token[0], len(token)
    could_close = rest.strip(" \t") == ""
    valid_open = could_close or char != "`" or "`" not in rest
    return char, length, could_close, valid_open


def _fenced_lines(lines):
    """-> a list of bools, one per line (True if that line is a fence delimiter itself or inside
    one), or None if a fence is left UNCLOSED by EOF. security review round 3 finding 1: an
    unbalanced fence means this function's own bookkeeping cannot be trusted -- adversarial text
    that opens a fence and never closes it can desynchronize which lines count as "real" for the
    rest of the document, letting an EARLIER, attacker-influenced heading/verdict pair be returned
    while the genuine LATER one is wrongly treated as fenced-out. Failing closed here (the caller
    treats None as "no heading found," triggering the existing full-transcript fallback) is safer
    than trusting a parse that might be hiding real content.
    """
    fenced = [False] * len(lines)
    fence = None  # None when not in a fence, else the (char, length) of the opening delimiter
    for i, ln in enumerate(lines):
        marker = _fence_marker(ln)
        if marker is not None:
            char, length, could_close, valid_open = marker
            if fence is None:
                if valid_open:
                    fenced[i] = True
                    fence = (char, length)
                # else: not a real fence marker (e.g. a backtick in a backtick fence's own info
                # string) -- literal text, fenced[i] stays False
            else:
                fenced[i] = True
                if could_close and char == fence[0] and length >= fence[1]:
                    fence = None
            continue
        fenced[i] = fence is not None
    if fence is not None:
        return None
    return fenced


def extract_findings(text):
    """-> the reviewer's real verdict block (str), or None if no '## Findings' heading exists
    (including when fence state cannot be trusted -- see _fenced_lines)."""
    # security review round 1 finding 2: column-0 indentation alone (round 1 (code) finding 1)
    # only catches an INDENTED quoted example -- a FENCED code block quoting the convention
    # renders its contents at column 0 too, so a later, spurious quoted heading INSIDE a fence
    # could still reset `start` and silently drop every real finding before it.
    lines = text.split("\n")
    fenced = _fenced_lines(lines)
    if fenced is None:
        return None
    start = None
    for i, ln in enumerate(lines):
        if not fenced[i] and _FINDINGS_HEADING_RE.match(ln):
            start = i
    if start is None:
        return None
    end = None
    for i in range(start, len(lines)):
        if not fenced[i] and _VERDICT_LINE_RE.match(lines[i]):
            end = i
    if end is None:
        return None
    return "\n".join(lines[start:end + 1])


# ---------------------------------------------------------------- budget headroom (I3/I4 shared)
# review round 5 (code) finding 1: three call sites (run_review's pre-flight fix-round check,
# finalize_ready's verify_host check, retry.sh's --extend-budget validation) all ask the exact
# same question -- "is there enough budget left to fund another round?" -- and had drifted into
# TWO different answers for the same inputs. Raw float subtraction can put an intended-exact $0.50
# fractionally on either side of the `> 0.5` boundary (1.1-0.6 == 0.5000000000000001 in IEEE 754);
# one call site rounded first, the others did not, so the SAME (budget, spent) pair could be
# "fundable" through one path and "not fundable" through another -- violating I4's own "gated on
# the SAME round/budget ceilings" contract. One canonical implementation, called from all three,
# closes the class instead of patching each site's copy individually.
# K26: two different questions, two different floors, one implementation. ROUND_MIN_BUDGET_USD is
# "is another review round worth attempting?"; WRITER_MIN_BUDGET_USD is "is there enough left for a
# fix writer to reach a commit?". A class may raise the writer floor via writer_min_budget_usd.
ROUND_MIN_BUDGET_USD = 0.5
WRITER_MIN_BUDGET_USD = 2.0


def budget_remaining(budget_usd, spent_usd):
    """-> the remaining budget, rounded to the same 4-decimal precision budget_usd/spent_usd are
    already stored at -- so '> 0.5' means what it says everywhere this is checked, not whatever
    raw float subtraction happens to produce."""
    return round(float(budget_usd) - float(spent_usd), 4)


# ---------------------------------------------------------------- CLI
def main(argv):
    if len(argv) < 2:
        sys.stderr.write("usage: aplib.py {frontmatter|classify|lint} ...\n")
        return 2
    cmd = argv[1]
    if cmd == "frontmatter":
        fm, _ = parse_frontmatter(argv[2])
        print(json.dumps(fm))
        return 0
    if cmd == "classify":
        fm, _ = parse_frontmatter(argv[2])
        print(classify(fm.get("scope") or [], argv[3]))
        return 0
    if cmd == "rubric":
        print(json.dumps(parse_rubric(argv[2])))
        return 0
    if cmd == "intake-score":
        print(json.dumps(intake_score(argv[2], argv[3])))
        return 0
    if cmd == "plan-emit":
        return plan_emit(argv[2])
    if cmd == "findings":
        with open(argv[2], encoding="utf-8") as fh:
            text = fh.read()
        block = extract_findings(text)
        if block is None:
            return 1
        print(block)
        return 0
    if cmd == "budget-remaining":
        remaining = budget_remaining(argv[2], argv[3])
        # K26: the floor is a parameter of this ONE canonical check, not a second copy of it. The
        # default stays $0.50 -- the "is another REVIEW round worth attempting?" threshold every
        # existing caller asks about. A caller deciding whether to relaunch a fix WRITER passes a
        # larger floor (WRITER_MIN_BUDGET_USD, or the class's writer_min_budget_usd), because a
        # writer session that cannot reach a commit produces nothing reviewable and leaves the run
        # in the one state retry.sh has no recovery mode for.
        floor = ROUND_MIN_BUDGET_USD
        if len(argv) > 4:
            try:
                floor = float(argv[4])
            except (TypeError, ValueError):
                sys.stderr.write("budget-remaining: floor %r is not a number\n" % (argv[4],))
                return 2
            # fail closed: a malformed floor must never silently fall back to the review default,
            # which would re-open exactly the gap this parameter exists to close.
            if not math.isfinite(floor) or floor < 0:
                sys.stderr.write(
                    "budget-remaining: floor %r must be a finite number >= 0\n" % (argv[4],))
                return 2
        print(remaining)
        return 0 if remaining > floor else 1
    if cmd == "lint":
        err = lint(argv[2])
        if err:
            print(err)
            return 1
        print("OK")
        return 0
    if cmd == "hook":
        return _hook(argv[2])
    if cmd == "scopecheck":
        # read a newline list of changed paths on stdin; print DRIFT <path> for any that
        # are outside scope (a scratch/in path is fine). Used by scope-check.sh on the diff.
        fm, _ = parse_frontmatter(argv[2])
        scope = fm.get("scope") or []
        drift = 0
        for line in sys.stdin:
            p = line.strip()
            if not p:
                continue
            v = classify(scope, p)
            if v != "in":   # a committed file must be in scope — scratch (.ap3-run) must be gitignored, never committed
                print("DRIFT %s (%s)" % (p, v))
                drift += 1
        return 1 if drift else 0
    if cmd == "scopes-overlap":
        # D3: dispatch.sh's parallel-scope gate. argv[2]/argv[3] are each a JSON array of globs.
        a = json.loads(argv[2]); b = json.loads(argv[3])
        print("OVERLAP" if scopes_overlap(a, b) else "DISJOINT")
        return 0
    if cmd == "tokens-overlap":
        # D3 review-2 finding 1: dispatch.sh's parallel invariant-token gate. argv[2]/argv[3] are
        # each a JSON array of strings.
        a = json.loads(argv[2]); b = json.loads(argv[3])
        print("OVERLAP" if tokens_overlap(a, b) else "DISJOINT")
        return 0
    sys.stderr.write("unknown subcommand %r\n" % cmd)
    return 2


def _hook(taskfile):
    """PreToolUse scope guard: read the tool JSON on stdin, deny an out-of-scope edit.

    Prints the documented deny decision and exits 0 (an ALLOW is silence — the edit
    then goes through the normal permission rules). Fail-open on a parse error so a
    malformed hook payload never wedges the writer; scope is still enforced by the
    dispatcher's independent diff scope-check before any PR is trusted.
    """
    try:
        payload = json.load(sys.stdin)
        fp = (payload.get("tool_input") or {}).get("file_path")
    except (ValueError, AttributeError):
        return 0
    if not fp:
        return 0
    rel = os.path.relpath(os.path.abspath(fp), os.getcwd())
    try:
        fm, _ = parse_frontmatter(taskfile)
    except (OSError, ValueError):
        return 0
    verdict = classify(fm.get("scope") or [], rel)
    if verdict in ("in", "scratch"):
        return 0
    if verdict == "forbidden":
        reason = "ap3: %s is config/kit (.claude, ap3, .github, .env) — a routine never edits it." % rel
    else:
        reason = ("ap3 SCOPE_DRIFT: %s is outside this task's scope %s. Stay in scope, or write "
                  ".ap3-run/HALT.md with reason SCOPE_DRIFT." % (rel, fm.get("scope") or []))
    print(json.dumps({"hookSpecificOutput": {
        "hookEventName": "PreToolUse",
        "permissionDecision": "deny",
        "permissionDecisionReason": reason,
    }}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
