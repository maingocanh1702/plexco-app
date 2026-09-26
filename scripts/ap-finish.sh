#!/usr/bin/env bash
# ap-finish.sh <feature-id> [--squash-verified <origin-commit>|--authorized-close --reason <text>] [--no-archive]
# Remove a Level 3 worktree/reservation only after landing or an explicit durable disposition.
set -euo pipefail

# Resolved before the cd "$ROOT" below: ap-evidence.sh ships beside this script (autopilot/parallel/ in the
# canonical kit, scripts/ in a consumer) and a relative $0 would stop resolving after the chdir.
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"

SLUG="${1:?usage: ap-finish.sh <feature-id> [--squash-verified <origin-commit>|--authorized-close --reason <text>] [--no-archive]}"
shift
MODE="ancestor"
MODE_FLAGS=0
PROOF_SHA=""
REASON=""
NO_ARCHIVE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --squash-verified)
      [ $# -ge 2 ] || { echo "HALT: --squash-verified needs the exact origin commit SHA" >&2; exit 2; }
      MODE="squash"
      MODE_FLAGS=$((MODE_FLAGS + 1))
      PROOF_SHA="$2"
      shift 2
      ;;
    --authorized-close)
      MODE="close"
      MODE_FLAGS=$((MODE_FLAGS + 1))
      shift
      ;;
    --reason)
      [ $# -ge 2 ] || { echo "HALT: --reason needs non-empty text" >&2; exit 2; }
      REASON="$2"
      shift 2
      ;;
    --no-archive)
      NO_ARCHIVE=1
      shift
      ;;
    *)
      echo "HALT: unknown argument: $1" >&2
      exit 2
      ;;
  esac
done

[ "$MODE_FLAGS" -le 1 ] || { echo "HALT: choose only one finish mode" >&2; exit 2; }
case "$SLUG" in
  ""|*[!a-z0-9._-]*) echo "HALT: invalid feature id: $SLUG" >&2; exit 2 ;;
esac
if [ "$MODE" = "close" ] && [ -z "$REASON" ]; then
  echo "HALT: --authorized-close requires --reason <durable disposition>" >&2
  exit 2
fi
if [ "$MODE" != "close" ] && [ -n "$REASON" ]; then
  echo "HALT: --reason is valid only with --authorized-close" >&2
  exit 2
fi

git rev-parse --git-dir >/dev/null 2>&1 || { echo "HALT: not inside a git repo" >&2; exit 1; }
ROOT="$(cd "$(git rev-parse --git-common-dir)" && cd .. && pwd)"
cd "$ROOT"
WORKTREES_DIR="$ROOT/.autopilot/worktrees"
WT="$WORKTREES_DIR/$SLUG"
BR="feat/$SLUG"
STATE="$WT/.autopilot/state/$SLUG"
INFLIGHT="$ROOT/.autopilot/INFLIGHT.md"
SCOPE_GATE="$ROOT/scripts/autopilot-scope-gate"

[ -x "$SCOPE_GATE" ] || { echo "HALT: cleanup gate is missing or not executable: $SCOPE_GATE" >&2; exit 1; }

registry_status() {
  [ -f "$INFLIGHT" ] || return 0
  # No reset on the header line: this accumulates ONE named feature and prints at END, so clearing on
  # every later header erases the answer unless me is the LAST block in the registry. With the reset,
  # `ap-finish.sh --squash-verified` refused every feature that was not last — the registry plainly read
  # `ready` while this function returned empty, so the failure claimed the status was wrong rather than
  # that the lookup was. Same defect fixed in autopilot-scope-gate at v20; it lived in four copies across
  # three files, and v20 only reached the two inside that one file.
  awk -v me="$SLUG" '
    /^## feature:/{cur=$3}
    /^status:/{if(cur==me)st=$2}
    END{print st}
  ' "$INFLIGHT"
}

# expected_worktree_path <root-physical> <slug>: the literal path a worktree for <slug> is expected
# to live at, given <root-physical>'s own physically-resolved location -- a plain string join, no
# resolution, no dependency on $WT at all. This is deliberately an INDEPENDENT construction, not a
# second resolution of $WT to compare against a first one.
#
# Rounds 5, 6 and 7 each compared two RESOLVED values instead (round 5: pwd -P against git's own
# rev-parse --show-toplevel; round 6: added a branch cross-check on that same resolved toplevel;
# round 7: found the branch cross-check still insufficient). All three were defeated by a symlink at
# or above $WT, because both sides of each comparison were derived BY RESOLVING $WT ITSELF -- they
# followed the same redirection and agreed with each other regardless of where it pointed. Confirmed
# by running autopilot-review-readiness.mjs's own REGION_THRASH parser against regions.log, not
# asserted: three consecutive P1s in this exact block. A check that shares a derivation with the
# thing it checks cannot detect a fault in that derivation -- comparing against a reference that
# never touches $WT at all is what closes that class, not another adjustment to how the two
# resolved sides are computed.
expected_worktree_path() {
  printf '%s/.autopilot/worktrees/%s\n' "$1" "$2"
}

if [ -d "$WT" ]; then
  # Round-8 shape (2026-09-03/04), replacing rounds 5-7's identity checks entirely -- see
  # expected_worktree_path's own comment for why this is a different construction, not a fourth
  # patch on the same one.
  #
  # This intentionally does NOT separately detect a stale, non-worktree directory (no .git, no
  # symlink involved -- the ORIGINAL Plexco incident, 2026-08-14, docs/autopilot-backlog.md task
  # ap-finish-untracked-counts-as-dirty: a worktree directory left with only an empty `infra/` tree,
  # no .git). Measured directly before writing this: `git worktree remove` already refuses that
  # exact case on its own, natively and safely (`fatal: '...' is not a working tree`, exit 128,
  # nothing touched) -- adding a second check for a condition git already checks would be exactly
  # the duplication this redesign removes, not preserves. The one thing native git does NOT catch on
  # its own, measured equally directly, is $WT resolving -- via a symlink at any path component, not
  # only the final one -- to a DIFFERENT, real worktree (native `git worktree remove` on such a path
  # simply follows it and removes the OTHER worktree, exit 0, no error). That is the one thing this
  # check exists for.
  root_physical="$(cd "$ROOT" && pwd -P)"
  wt_expected="$(expected_worktree_path "$root_physical" "$SLUG")"
  wt_physical="$(cd "$WT" 2>/dev/null && pwd -P)" || wt_physical=""
  if [ -z "$wt_physical" ] || [ "$wt_physical" != "$wt_expected" ]; then
    echo "HALT: '$WT' resolves to '${wt_physical:-nothing}', not its own expected location '$wt_expected' -- most likely a symlink (at $WT itself or an ancestor directory) redirecting it to a different worktree; refusing to inspect or remove it" >&2
    exit 1
  fi

  # Every subsequent operation on this worktree -- the diff gate immediately below, the archive
  # step, and the eventual removal call -- uses $wt_physical, the CONCRETE path just verified above,
  # and never dereferences $WT again. This is what fuses the check to the actions it backs, closing
  # the TOCTOU gap round 7 flagged rather than merely narrowing it: re-running this same comparison
  # again immediately before the removal call would still leave a (smaller) window between that
  # re-check and the action; using the already-verified concrete value for the action itself leaves
  # no window, because nothing downstream re-resolves $WT to find out where it currently points.
  # Verified directly: replacing $WT with a symlink to a different worktree AFTER capturing
  # $wt_physical does not redirect the later removal call -- it still targets the original,
  # verified directory (and git's own administrative back-link check independently refuses if that
  # exact directory no longer matches its registration, a second layer this script does not have to
  # implement itself).
  #
  # NAMED RESIDUAL, declared in advance rather than left for a reviewer to raise (owner ruling,
  # 2026-09-03): $wt_physical is a STRING. Nothing stops the filesystem OBJECT it names from being
  # replaced between this capture and the removal call below -- closing that would need fd-based
  # operations (e.g. opening a directory handle and operating relative to it) that `git worktree
  # remove` does not expose as an interface. This is OUT OF MODEL for this fix: replacing the
  # object at a specific, already-resolved physical path, at the exact moment this script is
  # running, requires an ACTIVE ACTOR racing this exact invocation -- not an accidental symlink, a
  # stale directory, or ordinary misconfiguration, which is the threat class rounds 5-8 addressed.
  # Do not spend a further round hardening this; the answer to a finding raising it is this
  # citation, not a fix.
  STATE="$wt_physical/.autopilot/state/$SLUG"

  # Tree-clean gate: TRACKED ONLY, matching this kit's own precedent (autopilot/ap-merge.sh:73,
  # added after ap-merge.sh's own 2026-07-22 incident with the identical root cause: `git status
  # --porcelain` counts untracked files, and this kit's consumers can permanently and deliberately
  # carry some -- Plexco: design.pen, fe.pen, DD-81 / FE PENDING -- so it reports a genuinely clean
  # worktree as dirty). Untracked files are not gated on at all here, by design: a lane's own
  # forgotten-to-`git add` file is still caught, but by `git worktree remove` itself (unforced,
  # below) -- WITH the `-c status.showUntrackedFiles=all` override that call carries (round-5 review
  # finding 2; without it, a `status.showUntrackedFiles=no` config makes that same removal silently
  # delete a genuinely untracked file -- measured, see that call site's comment).
  #
  # Guarded on `$wt_physical/.git` existing at all (round-9 review finding 2): expected_worktree_path
  # accepts a stale, .git-less directory (there is no symlink for it to disagree about -- see that
  # function's own comment on why staleness is intentionally not its job). Without this guard, `git
  # -C "$wt_physical" diff` on such a directory WALKS UPWARD to $ROOT the same way the ORIGINAL
  # Plexco incident's `status` call did, and a genuinely dirty $ROOT would print $ROOT's own tracked
  # diff under a message blaming the stale, nonexistent worktree -- measured directly before adding
  # this guard. `-e` (not `-d`): a worktree's `.git` is a FILE, not a directory.
  if [ -e "$wt_physical/.git" ] \
    && { ! git -C "$wt_physical" diff --quiet || ! git -C "$wt_physical" diff --cached --quiet; }; then
    echo "HALT WORKTREE_DIRTY: '$SLUG' has uncommitted TRACKED changes; nothing was removed." >&2
    git -C "$wt_physical" --no-pager diff --stat >&2
    git -C "$wt_physical" --no-pager diff --cached --stat >&2
    exit 1
  fi
elif [ -L "$WT" ] || [ -e "$WT" ]; then
  # Round-7 review finding 2 (P2): a dangling symlink, or a symlink/entry targeting a non-directory,
  # fails `-d` above -- without this branch, `--authorized-close` would treat it as an absent
  # worktree, write a disposition and report success while leaving it on disk, unaddressed and
  # uninspected.
  echo "HALT: '$WT' exists but is not usable as a directory (a dangling symlink, or an entry that is not a directory) -- refusing to treat this as an absent worktree" >&2
  exit 1
elif { [ -L "$WORKTREES_DIR" ] || [ -e "$WORKTREES_DIR" ]; } && [ ! -d "$WORKTREES_DIR" ]; then
  # Round-9 review finding 1 (P2): the check above only inspects $WT's own final component. If
  # $WORKTREES_DIR itself -- the one ancestor directory this script constructs and relies on --
  # is a dangling symlink or a non-directory entry, $WT (a path through it) is neither -L nor -e,
  # so it fell through as "simply absent" and --authorized-close would report a clean close while
  # this broken ancestor sits there unaddressed, affecting every slug under it, not just this one.
  echo "HALT: '$WORKTREES_DIR' exists but is not usable as a directory (a dangling symlink, or an entry that is not a directory) -- refusing to treat '$SLUG' as an absent worktree until this is resolved" >&2
  exit 1
else
  # docs/kit-design-debt.md §1, addendum 2026-09-08: this used to read
  # `elif [ "$MODE" != "close" ]`, exempting --authorized-close from the one HALT that catches a
  # worktree genuinely, plainly absent -- not stale, not a symlink, not a broken ancestor, just
  # never created (or living outside .autopilot/worktrees/ under a non-feat/<slug> branch, which
  # resolves to the same "absent at the guessed path" state here). That mode fell through this
  # entire if/elif with no halt, leaving `wt_physical` unset, and proceeded to print "worktree
  # already absent" and write a disposition record claiming a verified closure it never performed.
  # HALT applies to every mode now, including close -- there is no mode in which "the tool could
  # not find the worktree it was asked to close" is proof that closing it succeeded.
  echo "HALT: expected Level 3 worktree is absent: $WT" >&2
  exit 1
fi

HEAD_SHA=""
BASE_SHA=""
DIFF_BASE_SHA=""
DIFF_SHA256=""
if [ "$MODE" != "close" ]; then
  [ "$(registry_status)" = "ready" ] \
    || { echo "HALT: registry status must be ready before landing cleanup" >&2; exit 1; }
  [ -s "$STATE/READY.txt" ] \
    || { echo "HALT: READY signal is missing: $STATE/READY.txt" >&2; exit 1; }
  [ -s "$STATE/gate-result.json" ] \
    || { echo "HALT: machine gate result is missing: $STATE/gate-result.json" >&2; exit 1; }
  if find "$STATE" -maxdepth 1 -type f \( -name 'HALT-*' -o -name 'AWAIT-FOUNDER-*' \) | grep -q .; then
    echo "HALT: an AWAIT/HALT signal is still active under $STATE" >&2
    exit 1
  fi
  [ ! -e "$STATE/pending-review-finding.json" ] \
    || { echo "HALT: unresolved review finding is still active under $STATE" >&2; exit 1; }
  command -v node >/dev/null 2>&1 || { echo "HALT: node is required to verify gate-result.json" >&2; exit 1; }
  # kit v34, founder review of item 1 (2026-08-31): gate-result.json's scope_expanded fields are
  # gitignored and never appear in a PR diff -- printed here to STDERR (never captured by the
  # $(...) below, so it always reaches whoever is running this interactively) as a second,
  # landing-time surface alongside `ready`'s own terminal banner. Absent on a gate-result.json from
  # before this field existed -- Array.isArray guards that as "nothing to report", not an error.
  gate_values="$(node - "$STATE/gate-result.json" "$SLUG" <<'NODE'
const fs = require("fs");
const [file, feature] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(file, "utf8"));
const commitShaPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const isRealCommitSha = (candidate) =>
  commitShaPattern.test(candidate || "") && !/^0+$/.test(candidate);
if (
  value.gate_schema_version !== "level3-readiness-v2"
  || value.result !== "pass"
  || value.feature !== feature
  || !isRealCommitSha(value.base_sha)
  || !isRealCommitSha(value.diff_base_sha)
  || !isRealCommitSha(value.head_sha)
  || !/^[0-9a-f]{64}$/i.test(value.diff_sha256 || "")
  || !Number.isInteger(value.attempt)
  || value.attempt < 1
) process.exit(1);
if (Array.isArray(value.scope_expanded_files) && value.scope_expanded_files.length) {
  process.stderr.write(
    [
      "",
      "################################################################################",
      "# LANDING A FEATURE WHOSE DIFF EXPANDED BEYOND ITS DECLARED SCOPE             #",
      "################################################################################",
      `also touched, never declared (${value.scope_expanded_files.length}): ${value.scope_expanded_files.join(", ")}`,
      "Confirm this was reviewed before finishing the merge/close.",
      "################################################################################",
      "",
    ].join("\n"),
  );
}
process.stdout.write(
  [value.base_sha, value.diff_base_sha, value.head_sha, value.diff_sha256, value.attempt].join("\n"),
);
NODE
)" || { echo "HALT: gate-result.json is invalid or stale-schema" >&2; exit 1; }
  BASE_SHA="$(printf '%s\n' "$gate_values" | sed -n '1p')"
  DIFF_BASE_SHA="$(printf '%s\n' "$gate_values" | sed -n '2p')"
  HEAD_SHA="$(printf '%s\n' "$gate_values" | sed -n '3p')"
  DIFF_SHA256="$(printf '%s\n' "$gate_values" | sed -n '4p')"
  GATE_ATTEMPT="$(printf '%s\n' "$gate_values" | sed -n '5p')"
  [ -s "$STATE/gate-attempt-count.txt" ] \
    || { echo "HALT: gate attempt counter is missing" >&2; exit 1; }
  [ "$(tr -d '[:space:]' < "$STATE/gate-attempt-count.txt")" = "$GATE_ATTEMPT" ] \
    || { echo "HALT: gate result is not from the latest readiness attempt" >&2; exit 1; }
  [ "$(git -C "$ROOT" rev-parse "$BR^{commit}")" = "$HEAD_SHA" ] \
    || { echo "HALT: branch tip advanced after READY; rerun the readiness gate" >&2; exit 1; }
  # base_sha is the pinned LEGITIMACY base, not the diff window — it is right that it is still an
  # ancestor of HEAD, but the window this diff is measured from is diff_base_sha, the live base_ref
  # tip the gate actually used (autopilot-review-readiness.mjs liveDiffState()). Recomputing from
  # base_sha instead reproduces the exact bug this field exists to fix: once anything lands on
  # base_ref, base_sha...HEAD spans commits the gate never reviewed. No fallback to base_sha — a
  # fallback is a second source of truth, which is the defect.
  live_diff_hash="$(git -C "$ROOT" diff --binary "$DIFF_BASE_SHA...$HEAD_SHA" | shasum -a 256 | awk '{print $1}')"
  [ "$live_diff_hash" = "$DIFF_SHA256" ] \
    || { echo "HALT: feature diff no longer matches the gate result" >&2; exit 1; }

  git -C "$ROOT" remote get-url origin >/dev/null 2>&1 \
    || { echo "HALT: origin remote is required to prove landing" >&2; exit 1; }
  # The SAME order as ap-dispatch.sh, ap-spin.sh and ap-evidence.sh: environment override,
  # origin/HEAD, exactly one conventional name, else halt. This path used to ignore the override,
  # not know about trunk, and prefer main when both main and master existed -- so a run could start
  # against one authority branch and have its landing validated against another (code round 4, P2).
  DEFAULT_BRANCH="${AUTOPILOT_DEFAULT_BRANCH:-}"
  if [ -z "$DEFAULT_BRANCH" ]; then
    DEFAULT_BRANCH="$(git -C "$ROOT" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null \
      | sed 's#^origin/##' || true)"
  fi
  if [ -z "$DEFAULT_BRANCH" ]; then
    _found=""
    for _cand in main master trunk; do
      git -C "$ROOT" show-ref --verify --quiet "refs/remotes/origin/$_cand" && _found="$_found $_cand"
    done
    set -- $_found
    [ $# -eq 1 ] && DEFAULT_BRANCH="$1"
  fi
  if [ -z "$DEFAULT_BRANCH" ]; then
    echo "HALT: cannot resolve origin default branch unambiguously (set AUTOPILOT_DEFAULT_BRANCH)" >&2
    exit 1
  fi
  git -C "$ROOT" fetch --quiet origin "$DEFAULT_BRANCH"
  ORIGIN_REF="origin/$DEFAULT_BRANCH"

  if [ "$MODE" = "ancestor" ]; then
    git -C "$ROOT" merge-base --is-ancestor "$HEAD_SHA" "$ORIGIN_REF" \
      || {
        echo "HALT NOT_LANDED: $BR is not an ancestor of $ORIGIN_REF." >&2
        echo "  → for an exact squash, use --squash-verified <origin-commit>." >&2
        echo "  → to abandon explicitly, use --authorized-close --reason <text>." >&2
        exit 1
      }
    PROOF_SHA="$HEAD_SHA"
  else
    git -C "$ROOT" rev-parse --verify --quiet "$PROOF_SHA^{commit}" >/dev/null \
      || { echo "HALT: squash proof commit not found: $PROOF_SHA" >&2; exit 1; }
    git -C "$ROOT" merge-base --is-ancestor "$PROOF_SHA" "$ORIGIN_REF" \
      || { echo "HALT: squash proof $PROOF_SHA is not on $ORIGIN_REF" >&2; exit 1; }
    parent_line="$(git -C "$ROOT" rev-list --parents -n 1 "$PROOF_SHA")"
    parent_count="$(printf '%s\n' "$parent_line" | awk '{print NF-1}')"
    [ "$parent_count" = "1" ] \
      || { echo "HALT: squash proof must be a one-parent commit" >&2; exit 1; }
    PROOF_PARENT="$(printf '%s\n' "$parent_line" | awk '{print $2}')"
    # Three-dot, from DIFF_BASE_SHA — same window the gate computed diff_files from, and the same
    # reasoning as the live_diff_hash recompute above: BASE_SHA is the pinned legitimacy base, not the
    # diff window.
    feature_files="$(git -C "$ROOT" diff --name-only --no-renames "$DIFF_BASE_SHA...$HEAD_SHA" | sort)"
    proof_files="$(git -C "$ROOT" diff --name-only --no-renames "$PROOF_PARENT" "$PROOF_SHA" | sort)"
    [ -n "$feature_files" ] && [ "$feature_files" = "$proof_files" ] \
      || { echo "HALT: squash proof file set does not equal the READY feature file set" >&2; exit 1; }
    proof_diff_hash="$(git -C "$ROOT" diff --binary "$PROOF_PARENT" "$PROOF_SHA" | shasum -a 256 | awk '{print $1}')"
    [ "$proof_diff_hash" = "$DIFF_SHA256" ] \
      || { echo "HALT: squash proof binary diff does not exactly equal the READY diff" >&2; exit 1; }
  fi
else
  HEAD_SHA="$(git -C "$ROOT" rev-parse --verify "$BR^{commit}" 2>/dev/null || true)"
  echo "AUTHORIZED_CLOSE: no merge claim; branch history will be retained."
fi

if [ -n "${wt_physical:-}" ]; then
  # Gated on $wt_physical (set only when the block above verified $WT), not a fresh `-d "$WT"` --
  # this is the same fusion described at that verification: everything from here on operates on the
  # concrete, already-verified path, never by dereferencing $WT again. $wt_physical is unset here
  # only when $WT was genuinely absent from the start (MODE=close, nothing ever to remove).
  #
  # STATE lives nested inside the worktree (.autopilot/worktrees/<slug>/.autopilot/state/<slug>/),
  # gitignored, uncommitted -- design-probe.md, HALT/AWAIT history, every gate-attempt/codex-review
  # artifact. `git worktree remove` deletes it unconditionally along with everything else. Archive it
  # OUTSIDE the worktree first, by default, so the design reasoning and review evidence survive
  # disposal the same way the code already does via git. See docs/autopilot-LESSONS.md L67 for the
  # same byte/mtime-identical quality bar applied to the narrower single-HALT-file case this generalizes.
  if [ "$NO_ARCHIVE" -eq 1 ]; then
    echo "SKIPPED archive: --no-archive requested for $SLUG."
  elif [ -d "$STATE" ]; then
    archive_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
    archive_dir="$ROOT/.autopilot/state-archive/${SLUG}-${archive_timestamp}"
    if [ -e "$archive_dir" ]; then
      echo "HALT: archive destination already exists: $archive_dir" >&2
      exit 1
    fi
    mkdir -p "$archive_dir"
    cp -Rp "$STATE" "$archive_dir/state"
    echo "archived: $STATE -> $archive_dir/state"
  else
    echo "no state directory to archive for $SLUG (nothing under $STATE)."
  fi
  # `git worktree remove` (unforced) is the sole authority over whether this tree is safe to
  # destroy -- it performs its own live, untracked-inclusive dirty check at the actual moment of
  # removal, which is the earliest point such a check can be both accurate and final. No separate
  # re-check runs here (owner decision, 2026-09-03/04: "safety moves to the ACTION" -- a check only
  # backs the action it is fused to; git's own check is fused to its own action by construction,
  # unlike any re-check this script could run moments earlier and keep in sync). Measured: a worktree
  # containing a genuine untracked file (the tracked-only gate above does not look at it) is still
  # refused here, safely -- but as a bare, uncaught `fatal:` under `set -e`, without the archive
  # record or scope-gate cleanup that follow.
  #
  # `-c status.showUntrackedFiles=all` (round-5 review finding 2, 2026-09-03): git's own live check
  # is implemented as a `git status --porcelain` internally, which HONORS THE CALLER'S CONFIG -- with
  # `status.showUntrackedFiles=no` set anywhere in the resolved config (repo, global, or system), a
  # genuine untracked file is invisible to that internal status call and the removal SILENTLY
  # SUCCEEDS, deleting it with no error at all. Measured empirically before this fix: under that one
  # config value, an unforced `git worktree remove` on a worktree with a real, never-committed file
  # exits 0 and the file is gone -- precisely the class of silent loss this entire feature branch
  # exists to prevent, on a config knob this script does not otherwise touch. `-c` on the invocation
  # itself is not a second check; it is the one config value the actual removal's own internal check
  # depends on, forced to the value that makes that check see everything, regardless of whatever this
  # repo or the caller's environment has configured.
  git -c status.showUntrackedFiles=all -C "$ROOT" worktree remove "$wt_physical" || {
    ec=$?
    # Round-5 review finding 3: git's failure path is not required to be atomic -- administrative
    # worktree metadata can be pruned even when the filesystem removal itself errors, so "nothing was
    # removed" is not a claim this script can make. The message is deliberately neutral: it names
    # what happened (removal failed) without asserting what state resulted, since a locked worktree,
    # a validation failure, a permission error and a genuine dirty check all reach this same branch.
    echo "HALT WORKTREE_REMOVE_FAILED: '$SLUG' could not be removed cleanly -- see git's message above. State may be partially changed; inspect $wt_physical and \`git worktree list\` before retrying." >&2
    exit "$ec"
  }
  echo "worktree removed: $SLUG"
else
  echo "worktree already absent: $SLUG"
fi

# Written here -- after the worktree branch above has either removed the worktree or found it
# already absent, but before scope-gate cleanup -- not earlier, which is where this block used to
# sit (round-2 review finding 4), and not later: `autopilot-scope-gate cleanup` itself REQUIRES this
# exact record to already exist as proof it is being invoked through this script and not as a raw
# reservation wipe (REJECT CLEANUP_PROOF_MISSING otherwise), so it cannot move past the next line. A
# landed/authorized_close record is an attestation that the closeout finished; writing it before the
# archive/removal work let a late HALT leave that attestation on disk anyway, with the dirty
# worktree, the reservation and the branch all still there to contradict it -- a tool that only
# reads this record as proof of completion would trust a closeout that never happened.
#
# Round-3 review finding 3 noted that `date`/`mkdir`/node-availability/the record write below can
# still fail AFTER `git worktree remove` above has already succeeded, leaving no record and no
# scope-gate cleanup -- not fixed further, for the same reason the round 1-4 ambient-comparison
# mechanism was retired rather than patched again (owner decision, 2026-09-03): both questions are
# bound to the destructive-removal step. Since removal above is plain and unforced -- git's own live
# check, not this script, decides whether it is safe -- by the time this line is reached the removal
# was uncontroversially safe; a failure in this short, non-destructive record-write sequence leaves a
# stale reservation to clean up by hand, not a compounded "destroyed the wrong thing AND lost the
# record of it" risk.
record_root="$ROOT/.autopilot"
timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
operator="${USER:-unknown}"
if [ "$MODE" = "close" ]; then
  record_dir="$record_root/dispositions"
  record_file="$record_dir/$SLUG.json"
  record_status="authorized_close"
else
  record_dir="$record_root/landings"
  record_file="$record_dir/$SLUG.json"
  record_status="landed"
fi
mkdir -p "$record_dir"
command -v node >/dev/null 2>&1 || { echo "HALT: node is required to write the durable record" >&2; exit 1; }
# A landing also records the diff window and binary hash this script just proved, so a consumer that
# must decide whether the landing is real (ap-dispatch.sh released()) can re-check the squash proof
# instead of taking the mode's word for it (review round 6, code 1 / security 2, P1). A close proves
# no diff and records neither.
record_diff_base=""; record_diff_hash=""
if [ "$MODE" != "close" ]; then
  record_diff_base="${DIFF_BASE_SHA:-}"; record_diff_hash="${DIFF_SHA256:-}"
fi
node - "$record_file" "$SLUG" "$record_status" "$MODE" "$REASON" "$BASE_SHA" "$HEAD_SHA" "$PROOF_SHA" "$timestamp" "$operator" "$record_diff_base" "$record_diff_hash" <<'NODE'
const fs = require("fs");
const [
  file, feature, status, mode, reason, baseSha, headSha, proofSha, timestamp, operator,
  diffBaseSha, diffSha256,
] = process.argv.slice(2);
fs.writeFileSync(file, `${JSON.stringify({
  schema_version: "level3-disposition-v1",
  feature,
  status,
  mode,
  reason: reason || null,
  base_sha: baseSha || null,
  head_sha: headSha || null,
  origin_proof_sha: proofSha || null,
  diff_base_sha: diffBaseSha || null,
  diff_sha256: diffSha256 || null,
  recorded_at: timestamp,
  recorded_by: operator,
}, null, 2)}\n`);
NODE

"$SCOPE_GATE" cleanup --feature "$SLUG"

if [ "$MODE" = "ancestor" ] && git -C "$ROOT" rev-parse --verify --quiet "$BR" >/dev/null 2>&1; then
  if git -C "$ROOT" branch -D "$BR" >/dev/null 2>&1; then
    echo "origin-verified branch deleted: $BR"
  else
    echo "WARN: landing/reservation cleanup succeeded, but local branch remains: $BR" >&2
  fi
elif git -C "$ROOT" rev-parse --verify --quiet "$BR" >/dev/null 2>&1; then
  echo "branch retained for forensic/manual deletion: $BR"
fi

# kit v36 (level3-upgrade wave 0, slice B): file one routine-evidence row and bump the auto-merge
# maturity counter from the artifacts this script just archived, through ap-evidence.sh (ships in the
# pack beside this file). Landed records only -- an --authorized-close is not evidence, so the close
# path skips it entirely. The tool never commits, never pushes and never touches a ledger `status`
# (promotion stays owner authority: autopilot/.autopilot/maturity-ledger.md, 2026-09-08 comment).
# Non-fatal on purpose: by this line the landing is real (worktree removed, record written, reservation
# released) and bookkeeping must never turn that completed closeout into a non-zero exit -- the same
# reasoning the archive block records under round-3 finding 3. A failure is a printed WARN, not a HALT.
if [ "$MODE" != "close" ]; then
  _evidence_tool="$SELF_DIR/ap-evidence.sh"
  if [ -x "$_evidence_tool" ]; then
    echo "── routine evidence (level3-routine-evidence-ledger.md + maturity-ledger.md; never committed by ap-finish) ──"
    if [ -n "${archive_dir:-}" ] && [ -d "${archive_dir:-}/state" ]; then
      "$_evidence_tool" "$SLUG" --landing "$record_file" --archive "$archive_dir/state" \
        || echo "WARN: ap-evidence.sh exited $? for $SLUG -- file the routine-evidence row by hand from $archive_dir/state" >&2
    else
      "$_evidence_tool" "$SLUG" --landing "$record_file" \
        || echo "WARN: ap-evidence.sh exited $? for $SLUG -- no archived state dir was available (--no-archive?)" >&2
    fi
  else
    echo "WARN: $_evidence_tool not found or not executable -- routine evidence NOT filed for $SLUG (scripts/ap-evidence.sh ships with KIT_VERSION >= 36; sync the kit)" >&2
  fi
fi

# kit v35: this used to be a static reminder to go run reconcile yourself. --audit never runs --fix,
# never edits docs/autopilot-backlog.md and never commits or pushes -- that contract is unchanged, and
# is what the rest of this comment means by "report-only" -- so actually running it costs nothing and
# gives fast feedback for the common case right at the moment a normal-lifecycle slice finishes.
# NOT claiming strictly read-only in the broader sense, per Codex review round 1 on this branch: --audit
# unconditionally runs `git fetch origin` (has since v1, unrelated to this change), which does write
# remote-tracking refs/objects/FETCH_HEAD -- real local git state, just never the backlog file, a
# commit, or a push. This complements, and does not replace, the scheduled audit in
# templates/autopilot-backlog-audit.yml: THIS hook only fires for work that goes through ap-finish.sh,
# so it structurally cannot see a squash-merged mega-commit or a founder-approved direct push, which is
# exactly the class that produced the drift this pass measured (see
# docs/backlog-reconcile-drift-measurement.md). `|| true` because a stale-status finding must never
# turn a finish non-zero -- that would fail a build over a false-`planned` field, the safe drift
# direction this kit deliberately never blocks on.
#
# Round 4 review found a snapshot mismatch this hook did not previously surface: --audit reads the
# LOCAL working tree's docs/autopilot-backlog.md but probes merged status against a freshly FETCHED
# origin -- if $ROOT itself has not been pulled recently (measured live during this pass: both
# consumer repos' local checkouts were several commits behind their own origin/main at points during
# this session), the two halves of the audit are quietly looking at different points in time. Not
# restructured into a bigger fix (e.g. forcing a merge/rebase here is out of scope for a narrow
# convenience hook and risky to do unprompted) -- just made visible, so a stale local checkout is a
# printed caveat instead of a silent assumption.
if [ -x "$ROOT/scripts/autopilot-backlog-reconcile" ] && [ -f "$ROOT/docs/autopilot-backlog.md" ]; then
  git -C "$ROOT" fetch origin --quiet 2>/dev/null || true
  _post_finish_upstream="$(git -C "$ROOT" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)"
  if [ -n "$_post_finish_upstream" ]; then
    _post_finish_behind="$(git -C "$ROOT" rev-list --count "HEAD..$_post_finish_upstream" 2>/dev/null || true)"
    case "$_post_finish_behind" in
      ''|0) ;;
      *)
        echo "NOTE: $ROOT is $_post_finish_behind commit(s) behind $_post_finish_upstream -- the audit"
        echo "      below reads THIS LOCAL docs/autopilot-backlog.md, not whatever is on"
        echo "      $_post_finish_upstream now. Pull first for a fully current picture."
        ;;
    esac
  fi
  echo "── post-finish backlog audit (report-only; never affects finish's result) ──"
  "$ROOT/scripts/autopilot-backlog-reconcile" --audit || true
  echo "backlog reconciliation is not committed or pushed by ap-finish -- review, then commit"
  echo "any status flip yourself through the project-authorized reconcile/commit flow."
fi

case "$MODE" in
  ancestor) echo "DONE: origin merge and READY-bound feature tip verified; cleanup recorded." ;;
  squash) echo "DONE: origin squash patch equals the READY feature diff; cleanup recorded." ;;
  close) echo "DONE: explicit unmerged disposition saved at $record_file; branch retained." ;;
esac
