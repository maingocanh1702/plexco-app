<!-- review-readiness: code-ready -->

# Step-0 readiness: L88 p5-first-creation-render-mode (session P5-S17a)

- **0 Status.** Agent-facing. This record is the branch's first commit, written before the owned edits, in the form of lane L85's record (`docs/sessions/web-mvp-phase5-readiness-p5-deps-osv-minimatch.md`). Its facts are the lane's step-0 measurements in this worktree at B: the renderer's checks and their lines (§2), the deploy workflows' render call (§2), the runbook lines the lane replaces (§6) and the backlog row (§6). The lane's goal, in the lane block's words: "`infra/render-app-spec.sh` gains a create mode that renders the committed spec for `doctl apps create` with NO live spec. It keeps every committed-spec check of the update path, and the update path's behaviour is unchanged."
- **1 Authority.** B = `9eee265be97ea37947a87a9ad38594c5771e0289`, origin/main at the lane start. Paths: R = `infra/render-app-spec.sh` (121 lines at B), RT = `infra/render-app-spec.test.mjs` (675 lines at B), RB = `docs/runbooks/staging-deploy.md`, BL = `docs/autopilot-backlog.md`. The authority is the owner's message of 2026-11-01 00:2x, item (B), verbatim:

> (B) Lane công cụ tạo app lần đầu (RQ-L69-1: renderer có chế độ create hoặc workflow có job create): chọn default có lý do, có security round, ghi default chờ owner ký.

The same message also says "PR không chạm guard thì clerk merge như thường. Không chờ owner giữa chừng". The backlog row is `p5-first-app-creation-path-in-tooling` (BL:8092-8107 at B; risk P1; merged_probe `infra/render-app-spec.sh :: render_app_spec_create_mode`). Every other lane choice (the interface, the mixed-mode rule, the key-root drop in create mode, the runbook wording, the row form, the acceptance, this record) is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature".

## §2 The renderer at B and the decision table

- **The live-spec dependence at B.** R:32 requires the live-spec argument; R:68 requires the live `.name` to equal the committed `.name`; R:101-102 require the live component to carry KMS_PROVIDER once, equal to KEY_ROOT; R:52-55 and R:104-116 (liveSecrets and fill) copy every SECRET from the live app; R:118-119 fail on any SECRET left without a value after the copy.
- **The committed-spec checks at B.** Input shapes R:33-43 (IMAGE_DIGEST `sha256:<64 hex>`, VPC_ID a UUID, KEY_ROOT exactly aws-kms or local with no default, APP_DOMAIN a hostname when set); empty stdin R:46-47; one JSON document with a non-blank `.name` R:66-67; the DDL guard (DATABASE_URL_MIGRATION only in a PRE_DEPLOY job) R:73-75; every env typed GENERAL or SECRET and no committed SECRET with a value R:78-82; the key-root drop R:85-86; placeholder substitution and the unresolved-placeholder check R:89-95; the rendered KMS_PROVIDER = KEY_ROOT half of R:99-101; the catch that withholds jq's own text R:121.
- **The workflows' render call at B (read only, never edited).** `.github/workflows/deploy-staging.yml:134` and `.github/workflows/deploy-production.yml:128` both run `infra/render-app-spec.sh live-spec.json` with one argument, so the update call keeps working unchanged.

The decision table. "run" = the check runs as at B; "SKIP" = skipped and named in R's contract comment; "-" = not reached.

| check (R line at B) | update, live arg | update, no arg | create (`--create` alone) | create with a live arg (either order) |
| --- | --- | --- | --- | --- |
| argument present (:32) | run | FAIL usage, unchanged | run | run |
| NEW mixed-mode check (`render_app_spec_create_mode`) | not reached | - | run, passes | FAIL `render: --create takes no live spec`, before any env check or file read |
| input shapes (:33-43) | run | - | run, same lines | - |
| empty stdin (:46-47) | run | - | run | - |
| one document and a name (:66-67) | run | - | run | - |
| live `.name` equality (:68) | run | - | SKIP | - |
| DDL guard (:73-75) | run | - | run | - |
| env types, committed SECRET without a value (:78-82) | run | - | run | - |
| key-root drop (:85-86) | run | - | run | - |
| substitution and unresolved placeholder (:89-95) | run | - | run | - |
| rendered KMS_PROVIDER = KEY_ROOT (:99-101) | run | - | run | - |
| live component KMS_PROVIDER (:101-102) | run | - | SKIP | - |
| liveSecrets and fill (:52-55, :104-116) | run | - | SKIP: every SECRET stays without a value | - |
| unfilled-SECRET guard (:118-119) | run | - | SURFACE half run (the one `unfilledGuard` definition): a SECRET outside the envs of a service, worker or job FAILS; FILL-DEPENDENT half SKIP: a SECRET in those envs stays valueless | - |
| NEW no SECRET with a value anywhere in the output | not run | - | run | - |
| catch withholding jq text (:121) | run | - | run | - |

## §3 The default, the rejected alternative and the interface

- **The default (Tier B, default applied, pending owner sign-off): a CREATE MODE in R, run by the owner on the owner's machine.** Four reasons: (1) no CI path gains the power to create a cloud resource, while a create job would add a new cloud mutation behind workflow_dispatch; (2) it touches no deploy-guard file, so the clerk can merge it now, and the workflows stay untouched while lane L87 holds deploy-staging.yml; (3) it removes exactly the cost RQ-L69-1 named, the hand fill of the placeholders each staging window (48-96 h), with ONE filler for both paths; (4) it is reversible: a later workflow job can call the same mode.
- **Rejected: a create job in the deploy workflows.** It adds a cloud mutation behind workflow_dispatch and edits deploy-guard files, which this lane may not touch.
- **The interface (Tier B).** `--create` as the ONLY argument, in place of `<live-spec.json>`, with the same environment inputs: `yq -o=json infra/app.staging.yaml | IMAGE_DIGEST=... VPC_ID=... KEY_ROOT=... APP_DOMAIN=... infra/render-app-spec.sh --create > spec.local.json`. One jq program serves both modes: a script literal `create` (true or false, never from input, passed by `--argjson`) gates exactly the four live checks (of the fourth, the unfilled-SECRET guard, only its FILL-DEPENDENT half: a SECRET in the envs of a service, worker or job stays valueless in create mode; its SURFACE half, a SECRET anywhere else, FAILS in both modes from the one `unfilledGuard` definition), so every committed-spec check is the same line in both modes (one source of truth, not a copy). In create mode the live file is `/dev/null`, which binds the live spec to an empty list: a live guard missed by mistake fails closed instead of reading anything. Rejected: a mode environment variable (an inherited export silently changes which checks run, the mode is invisible in the command line, and it needs a precedence rule against a live argument), and a second script (it copies the committed checks).
- **Mixed mode, both orders (Tier B).** `--create` together with any other argument, before or after it, fails with `render: --create takes no live spec`. A live file literally named `--create` is passed as `./--create`. The update call shape (one argument that is not `--create`) is unaffected.
- **The key-root drop applies in create mode (Tier B).** The app is created with the chosen root's SECRET names only; the hand fill kept both sets. Reason: the update path drops the other set on every deploy anyway (R:85-86), so a created app holding both sets would lose the other set at the first normal run; RB §2.5 step (5) ("SECRET của tập kia để trống") stays true, and re-choosing a root in a temporary staging window adds the other set by step (5)'s `Add environment variable` route.
- **The output guard is strict (Tier B).** In create mode a SECRET object anywhere in the rendered spec that carries a value fails, `false` and `0` included (the committed check R:78-82 reads `false` as absent; the update path keeps that reading, unchanged).

## §4 Threat model (a mistake, and a hostile or malformed input file) and the line that defends each threat

- **Create mode emits a SECRET with a value, or a placeholder unfilled.** The committed check R:78-82 (before the drop, so a valued SECRET in the dropped set fails too); the new create-mode output guard, which scans every object as R:118 does; fill never runs in create mode; the unresolved-placeholder check R:93-95.
- **Create mode drops a committed check (the DDL guard, the env types, the key-root drop, KMS_PROVIDER = KEY_ROOT).** One program: only the four live spots are gated by `create`; the tests in §7 run each committed check in create mode (the env types and KMS_PROVIDER = KEY_ROOT by the two cases added after review round 1), and one test pins that create mode renders exactly what update mode renders minus the copied SECRET values.
- **Create mode silently accepts a live spec (mixed mode).** The argument check in `render_app_spec_create_mode`, before any env check or file read; backstop: the empty live spec.
- **The update path changes behaviour.** The 24 existing cases pass unchanged; every message string of R at B stays; `create` is false, and the locale is the caller's, for every argument list without `--create`.
- **An input value reaches a shell or jq context unquoted (IMAGE_DIGEST, VPC_ID, APP_DOMAIN, KEY_ROOT).** The shape checks R:38-43 precede any use (in create mode under `LC_ALL=C`, pinned in `render_app_spec_create_mode`, so a non-ASCII byte fails them on the owner's UTF-8 shell; the update path's stay locale-dependent as at B, owed to a later lane in the backlog row); the values reach jq only by `--arg` (R:49); the program is one single-quoted string; the new mode compare is quoted and `create` is a script literal.
- **jq error text quotes input bytes.** The catch at R:121; every new message is a fixed string.
- **The runbook tells the owner to commit the creation copy, to put a secret value in it, or to pass it to `doctl apps update`.** RB §2.5 staging step (3) and production step (3) say never commit the copy, never put a secret value in it, and use it only for `doctl apps create`, never for `doctl apps update`; the first creation stays [Owner].
- Create mode never calls doctl or any network (R has no such call) and never reads or writes a secret value (no live spec is read).

## §5 Enablement-only point and known limits

- **Q2(a), unmeasured: does `doctl apps create` accept a SECRET entry without a value.** Out of this slice's scope by design (no doctl). Today's fail-closed behaviour, pinned: RB §2.5 step (4) stops if the command refuses one (no app exists yet, no value is put in the copy, and the conductor raises the decision to the owner).
- **Tools.** yq and shellcheck are not installed in this worktree's machine; the lane's real-spec run uses the test file's YAML reader instead of yq, and `bash -n` stands in for shellcheck (said so in the lane report).
- **jq versions.** Exit codes and stderr framing were measured on jq 1.8.2 only; the new tests assert a non-zero exit and the message text, as the existing tests do.

## §6 Ownership and negative scope (the lane block)

- **Owned.** R (the create mode, function `render_app_spec_create_mode`, and its contract comment); RT (additions only); RB §2.5: staging step (3) (RB:54 at B) and production step (3) (RB:72 at B), plus the two §2.5 lines that would contradict them, RB:46 (R needs a live app) and RB:48 (KMS_PROVIDER agreement); BL: the row `p5-first-app-creation-path-in-tooling`, closed in place in lane L72's closed-by-hand form (BL:7261-7263 at B), and one END row, `p5-render-update-path-locale-pin` (added after S1 round 1); this file.
- **Negative scope.** No `.github/**`, no `infra/app.*.yaml`, no `infra/Dockerfile`, no `infra/entrypoint.sh`, no `docs/standards/environments-setup.md`, no env manifest, no `docs/standards/decisions.md`; no change to the update path's behaviour or messages; no doctl, no DigitalOcean API, no `gh workflow run`, no GitHub variable; no secret value read or printed; RB steps (1), (2), (4)-(7) and points (i)-(iii) stay as written.

## §7 Acceptance (the lane TESTS)

- `pnpm test:infra`: the 24 existing cases pass unchanged; new create-mode cases, each named for its real-world case: every placeholder filled for both committed specs; malformed digest, VPC, domain and KEY_ROOT each refused naming the key, never the value; a valued committed SECRET refused (in an envs list, in the non-chosen set, outside every envs list, and `false`); every SECRET stays valueless (counts pinned); the DDL guard fails outside PRE_DEPLOY; the other key-root set dropped; an unresolved placeholder fails printing the token only; a live-spec argument with `--create` fails in both orders; empty stdin fails; create mode renders what update mode renders minus the copied values; update mode with no argument still fails with the usage text; added after review round 1: an env whose type is missing or misspelled refused by key in either key-root set, a literal KMS_PROVIDER that differs from KEY_ROOT refused naming the component only, and a non-ASCII letter in the digest, VPC or domain refused under a UTF-8 locale; added after S1 round 1: a SECRET in the app-level envs and a SECRET in a static site's envs, each refused in create mode as every update refuses it. The update path's locale is the backlog row `p5-render-update-path-locale-pin`, not built here.
- Two mutations on copies, never in the worktree: M1 removes the create-mode SECRET-value guard (a test must fail); M2 skips one placeholder in create mode (a test must fail).
- `bash -n infra/render-app-spec.sh`; shellcheck if installed, else said so.
- The real committed specs through create mode with fake inputs: valid JSON, no `__X__` left, no SECRET value; output saved outside the repository, holding no secret.
- `pnpm lint`, `pnpm typecheck`, `pnpm format:check`; `pnpm review:check:changed` before every commit and `pnpm review:check` at the end; the backlog reconcile: no new refusal.
- B3 estimate: about 330 owned-diff lines (R about 60, RT about 140, RB about 20, BL about 6, this file about 100); 0 migrations.

## §8 Owed

- **Commit 2, the owned edits.** R: create mode per §3, with the four skips named in the contract comment; RT: the §7 cases at the end of the file; RB: staging step (3) and production step (3) use create mode, RB:46 and RB:48 re-pointed, renderer line cites inside the owned lines replaced by check names; BL: the row closed in place (status merged, a merged line, a note_merged line; merged_probe unchanged).
- **Renderer line cites outside the owned lines (not edited here; they shift with R).** RB:40 (§2.4) and RB:56 (§2.5 step (5)); `docs/runbooks/env-manifest-staging-production.md` :28, :48, :67, :71, :103, :128 (lane L87's file); BL:7892 (another row, already off at B). Named as owed in the row's note_merged.

## §9 Verdict

Closure matrix (12 rows): 1 authority pinned by SHA PASS (B; TARGET_FILES = the five owned files, each on disk at this commit); 2 decisions in scope final PASS (the owner's item (B) asks for a reasoned default; the default and the other choices are labelled, §1, §3); 3 scope and owner clear PASS (the lane block's ownership and negative scope, §6); 4 dependencies classified PASS (none; lane L87 runs in parallel on disjoint files, the backlog being the accepted overlap, one row in place); 5 live repo matches the claims PASS (R, the workflows' render call, RB and BL measured at B, §2, §6); 6 data, API, state and auth contract PASS (a new argument value of one script; the update call and its messages unchanged; no schema, API or status change); 7 fail-closed PASS (mixed mode fails, an empty live spec backs every skipped live check, a valued SECRET fails, Q2(a) stops at RB step (4)); 8 open questions in scope = 0 PASS (Q2(a) is enablement-only, §5); 9 acceptance matrix PASS (§7); 10 migration, security, rollback PASS (no migration; threat model §4; the security round is the lane's S1 review; rollback = revert the commit, the update path being unchanged); 11 hard dependency merged PASS (none; B is origin/main); 12 handoff ready PASS (§8 gives commit 2's content).

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-11-01
AUTHORITY_SHA: 9eee265be97ea37947a87a9ad38594c5771e0289
BASE_BRANCH: main
TARGET_FILES:
  - infra/render-app-spec.sh
  - infra/render-app-spec.test.mjs
  - docs/runbooks/staging-deploy.md
  - docs/autopilot-backlog.md
  - docs/sessions/web-mvp-phase5-readiness-p5-first-creation-render-mode.md
SLICE: p5-first-creation-render-mode
IN_SCOPE: lane L88: a create mode in infra/render-app-spec.sh (--create as the only argument, function render_app_spec_create_mode) that renders the committed spec for doctl apps create with no live spec, keeping every committed-spec check and skipping only the four named live checks; its tests appended to infra/render-app-spec.test.mjs; docs/runbooks/staging-deploy.md section 2.5 staging step (3), production step (3) and the two lines that would contradict them; the backlog row p5-first-app-creation-path-in-tooling closed in place and the END row p5-render-update-path-locale-pin added (the update path's locale, owed to a later lane); this readiness file
OUT_OF_SCOPE: .github/**; infra/app.*.yaml; infra/Dockerfile; infra/entrypoint.sh; docs/standards/environments-setup.md; the env manifest; docs/standards/decisions.md; any change to the update path's behaviour or messages; runbook steps (1), (2), (4)-(7) and points (i)-(iii); any other backlog row; doctl, the DigitalOcean API, gh workflow run, any GitHub variable; any secret value
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none (root slice on origin/main at AUTHORITY_SHA)
PRIOR_SLICES: L69 runbook section 2.5 hand fill and the backlog row from RQ-L69-1 (read only, replaced by this slice in the owned lines)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; create mode reads and writes no secret value and calls no network; the threat model is section 4 and the lane runs a security review round
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: commit 2 adds the create mode to infra/render-app-spec.sh, its tests at the end of infra/render-app-spec.test.mjs, the runbook step (3) edits and the backlog row close per section 8, then the mutations and the real-spec render per section 7
REMAINING_BLOCKERS: none
NEXT_REVIEW_TRIGGER: re-issue this verdict if the owner rejects the default of section 3, if a target file changes on main before the L88 PR merges, or if the deploy workflows change their render call shape
```
