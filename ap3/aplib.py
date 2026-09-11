#!/usr/bin/env python3
"""ap3 shared brain: frontmatter parse, glob match, scope classify, task lint.

Single source of truth so the hook (scope-guard), the reconcile scope-check and the
task lint cannot drift on glob semantics. Pure stdlib — no PyYAML — so it runs under
whatever python3 a launchd-started writer finds on PATH.

Subcommands (all read cwd = the repo being operated on):
  frontmatter <taskfile>       print the parsed frontmatter as JSON
  classify <taskfile> <path>   print one of: scratch | forbidden | in | out
  lint <taskfile>              print 'OK' or 'INVALID_TASK <slug>: <reason>' (exit 1)

The git/network-dependent lint checks (run record, origin branch) live in lint-task.sh;
this file only does what it can decide from files in the working tree.
"""
import json
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

    return None


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
