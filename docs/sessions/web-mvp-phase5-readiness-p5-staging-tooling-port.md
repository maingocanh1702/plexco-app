<!-- review-readiness: code-ready -->

# Step-0 readiness: L65 p5-staging-tooling-port (session P5-S1b)

> Agent-facing. Step 0 measured by the step-0 readiness reader S0 (opus); writers W1 and W2 (opus) one at a time; one reviewer role and one security round (opus, Claude subagents: the Web MVP program's named exception DD-122 D4). RISK: P2 code with a security round (secret-bearing tooling). Base `4345c284857f70d398d1421ef25db796b56ad319` (origin/main after `git fetch`, measured; contains #134 and #135); branch `feat/p5-staging-tooling-port`; worktree `.autopilot/worktrees/p5-staging-tooling-port`; HEAD = base at step 0. PR #50 source: ref `origin/feat/mvp-m5-staging` at `f3ceab77cf450c933bdb63b1ed940d604cdd7fb7`, merge base with main `818edf4f17127614d34c33350f673199bbaa372b`; read only with `git show origin/feat/mvp-m5-staging:<path>`. Every `path:line` below was measured at the base unless it names the PR 50 ref. The session notes live outside the repo, so this file restates every fact it relies on.

Short forms: P50 = `origin/feat/mvp-m5-staging` (PR #50, closed, owner-only); RS = `infra/render-app-spec.sh`, RT = `infra/render-app-spec.test.mjs`, SC = `infra/smoke-check.sh`, WD = `infra/wait-for-deployment.sh` (all four new, read on P50); EP = `infra/entrypoint.sh`, DF = `infra/Dockerfile`, MG = `packages/db/src/migrate.ts`, ES = `docs/standards/environments-setup.md`, CI = `.github/workflows/ci.yml`, SP = `scripts/smoke-predeploy.mjs` (lane L74's file, read-only), PL = `docs/sessions/web-mvp-phase5-golive-plan.md`, MS = `docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md`, BL = `docs/autopilot-backlog.md`.

## 1. Authority

- The owner's written approval of 2026-10-28 of PL: §3 row L65 (PL:77), the Q1 default (PL:123: agents write DigitalOcean config FILES and deploy tooling, never a console, `doctl`, a resource, a deploy or a secret value; secrets by NAME only), the Q2 default (PL:124: fresh lanes from main port the still-valid parts of PR #50; no lane checks out, rebases or pushes #50), and the raise of L65's run cap to 6 (PL:77 still shows 4). Recorded as D46 of the conductor's decision log. Every choice below is "default applied, pending owner sign-off" or "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature".
- The inventory MS §3 (MS:54): this lane ports rows 5-9 (MS:67-71), 17 (MS:79) and 25 (MS:87) only. Row 22 (MS:84, the ES hunk of #50) ports with the App Specs in L66, not here.
- Scope (the lane block's FILE OWNERSHIP, as-is): infra/render-app-spec.sh, infra/render-app-spec.test.mjs, infra/wait-for-deployment.sh, infra/smoke-check.sh (all new), infra/entrypoint.sh (the `migrate` role only), .gitignore (the one ignore line block), package.json (the `test:infra` script and its place in `test` only), the readiness file docs/sessions/web-mvp-phase5-readiness-p5-staging-tooling-port.md, and at most 3 new backlog rows (docs/autopilot-backlog.md END, the accepted overlap). Nothing else.
- Negative scope (the lane block's NEGATIVE SCOPE, as-is): no doctl, no `gh workflow run`, no cloud CLI, console, account, login or deploy; no App Spec (L66), no workflow (L67), no smoke-predeploy.mjs or Playwright change (L74), no log-context (L68), no runbook (L69, L70), no Dockerfile or fly.toml change; never print, store or commit a secret value (the tests use fake names and fake ciphertext only; names only everywhere); never touch PR #50 or its branch.
- G1 is HALT (lane L62 on main); this lane writes tooling, never an App Spec, so ES:108 ("Until the gate closes, do not create the App Spec") is not crossed.

## 2. Measured at base

### 2.1 Q1: per-file edit list

Unchanged on main since the merge base (measured: `git diff --stat 818edf4f17127614d34c33350f673199bbaa372b 4345c284857f70d398d1421ef25db796b56ad319 -- infra/entrypoint.sh infra/Dockerfile packages/db/src/migrate.ts .gitignore` is empty); changed since it: `package.json` (+14 -8) and `packages/db/package.json` (+6 -2). The writer copies each new file from P50 with `git show origin/feat/mvp-m5-staging:<path> > <path>`, then applies the hunks below.

**E1. RS (new; P50 mode 100755, 66 lines).** A bash + jq renderer: stdin = the committed App Spec as JSON (RS:4 `yq -o=json infra/app.staging.yaml`), `$1` = the live spec file from `doctl apps spec get <app-id> --format json` (RS:8); env `IMAGE_DIGEST` (required, RS:19, shape `^sha256:[0-9a-f]{64}$` RS:23), `VPC_ID` (required, RS:20, UUID shape RS:24), `APP_DOMAIN` (optional, RS:21, hostname shape RS:25-27); one `jq -e` program (RS:33-66). Depends on nothing in the repo at runtime (bash 3.2+ and jq, RS:15); its inputs (the App Specs) are L66's files and do not exist on main.
- keep RS:1-5, RS:7-38, RS:43-45, RS:53-55, RS:65-66 as they are.
- change RS:6 `> rendered.json` to `> spec.local.json`, so the documented local render lands in the one name E6 ignores (D2).
- change RS:39-40 `(§4, §13)` to `(docs/standards/environments-setup.md §4, §13)`: the comment names no document; on main §4 is "Database roles and connection variables" (ES:176) and §13 "Anti-patterns" (ES:547).
- change the order of the jq pipeline (D3): run the placeholder substitution and the unresolved-placeholder check (RS:59-65) BEFORE `liveSecrets as $ls | def fill ... .jobs |= ...` (RS:46-55) and the unfilled-SECRET check (RS:56-58). Today RS:59-64 run over every string AFTER the copy, so a copied value is passed through `gsub` and scanned for `__[A-Z_]+__`; after the reorder a copied value is never transformed, scanned or quoted. Same lines, new order; no new logic. The closed-set guard RS:39-45 stays first.
- keep the P50 mode 100755 (RS:4-6 invoke it as a command).
- (S0b) insert as the first term of the jq program, after `def liveSecrets` (RS:35-38) and before the guard (RS:39-45): `(if (.name? // "") == "" then error("committed spec has no name") else . end) |`. Stdin `null`, `{}`, an array or a string then fails non-zero with stdout empty (2.2 Gap; every committed App Spec carries `name`, 2.3 R1). The message names nothing.
- (S0b) compare the env type case-insensitively in the three SECRET predicates RS:37, RS:48 and RS:57: `((.type? // "") | ascii_upcase) == "SECRET"` in place of `.type == "SECRET"` and `.type? == "SECRET"`. The app-spec reference's own example writes `type: secret` (2.3 R2); today such an entry, left valueless, is neither filled (RS:48) nor caught (RS:57) and reaches DigitalOcean without a value.
- (S0b) in `fill`, accept a live value only in DigitalOcean's ciphertext form: between RS:50 and RS:51 add `elif ($v | (startswith("EV[") and endswith("]")) | not) then error("live secret is not an EV ciphertext: \($kind)/\($c.name)/\(.key)")`. A masked or plain value would be submitted as a NEW value and replace the secret (2.3 R3, R4). The message names the key, never the value.

**E2. RT (new; P50 mode 100644, 121 lines, `node:test`, 7 tests at RT:45, :56, :63, :83, :91, :104, :112).** Depends on RS beside it (RT:11), `bash` and `jq` on PATH (RT:1, RT:41 passes only `PATH`, `IMAGE_DIGEST`, `VPC_ID`). Wired by E7.
- keep RT:1-4, RT:6-33 and the 7 test bodies.
- (S0b) in test 5 (RT:91-102), after the empty-stdin asserts, spawn once more with `input: "null"` (same env, `TMPDIR: dir`): assert non-zero, stderr matches `/committed spec has no name/`, stdout `""`. It fails if E1's name check is removed.
- (S0b) in test 4 (RT:83-89), render once more with `functions = [{ name: "f", envs: [{ key: "TOKEN", type: "secret" }] }]`: non-zero, "unfilled SECRET", stdout `""` (fails without the case-insensitive RS:57).
- (S0b) in test 2 (RT:56-61), render once more with the live `worker` value `"********"` (a fake mask): non-zero, stderr matches `/live secret is not an EV ciphertext: workers\/worker\/DATABASE_URL/`, `assert.doesNotMatch(r.stderr, /\*{8}/)`, stdout `""`. Still 7 tests (2, 4 and 5 gain one case each).
- change RT:5 to also import `rmSync`; change `render()` (RT:34-43) and the inline spawn of test 5 (RT:92-99) to (a) pass `TMPDIR: dir` in the spawn env and (b) remove `dir` in a `finally` (`rmSync(dir, { recursive: true, force: true })`). Today every call leaves a `render-*` dir with `live.json` behind (RT:35-37, RT:92-94; 15 dirs per run: 1+1+6+1+1+1+4 calls) and the spawned bash has no `TMPDIR`, so bash before 5.1 (local `/bin/bash` 3.2.57, measured) writes its here-string temp file for RS:66 under `/tmp`, outside the test's dir and outside the agent sandbox's writable set (derived, not run by S0; W1 measures it).
- change the fixture value at RT:30 `"EV[1:web]"` to `"EV[1:__WEB__]"` (fake) and RT:51 to expect it: test 1 then fails if a copied value is ever substituted or scanned again (proves E1's reorder).
- change test 4 (RT:83-89): add `assert.equal(r.stdout, "")`; test 6 (RT:104-110): add `assert.notEqual(r.status, 0)` and `assert.equal(r.stdout, "")`. Tests 2 and 3 already assert both (RT:58, :60, :77, :79).
- prettier skips `infra/` (`.prettierignore:11`); eslint lints it (`eslint.config.mjs:15` `"*.mjs"` matches only the repo root, as `eslint.config.mjs:54-55` explains): RT imports `process` and `URL` explicitly (RT:8-9), so `no-undef` has nothing to report; W1 runs `pnpm lint`.

**E3. SC (new; P50 mode 100755, 19 lines).** `https://` only (SC:8); `curl -fsS --max-time 15 --retry 6 --retry-delay 10 --retry-all-errors` (SC:9); `/healthz` must have `.ok == true` (SC:11-12; main answers `Response.json({ ok: true })`, `apps/web/app/healthz/route.ts:6`); `/` content type `text/html*` (SC:15-16); `/manifest.webmanifest` fetched (SC:18; main serves it from `apps/web/app/manifest.ts`).
- keep SC:1-14.
- change SC:15-19: `curl -f` without `-L` fails only on HTTP 400 or above, so a 3xx passes both checks. Add `%{http_code}` to the `-w` format of SC:15 and require `2*` beside `text/html*`, and give SC:18 its own `-w '%{http_code}'` with the same `2*` rule and a named failure message (D4). `apps/web/app/page.tsx` and `apps/web/middleware.ts` contain no `redirect(` (grep at base), so a signed-out `/` is expected to answer 2xx.

**E4. WD (new; P50 mode 100755, 48 lines).** `<app-id> <digest> [timeout=900]` (WD:11-13); loop (WD:18-44): `doctl apps list-deployments "$app" -o json 2>/dev/null` (WD:22), jq picks the first deployment whose spec has a service `web` with `.image.digest == $digest` (WD:23), reads `.id` and `.phase` (WD:32-33); `ACTIVE` breaks (WD:36), `ERROR|CANCELED|SUPERSEDED` exit 1 (WD:37); 5 consecutive doctl or jq failures exit 1 (WD:28); the deadline exits 1 (WD:42); poll every 15 s (WD:43); then `doctl apps get "$app" -o json | jq -r '.[0].active_deployment.id // empty'` must equal that id (WD:46-47). Depends on nothing in the repo; on the App Spec naming the service `web` (L66).
- keep WD:1-12, WD:15-22, WD:24-31, WD:34-48.
- change WD:13: refuse a non-digit timeout before WD:14 (`[[ "$timeout" =~ ^[0-9]+$ ]] || { echo "wait: timeout must be whole seconds" >&2; exit 1; }`): WD:14 evaluates the string in bash arithmetic, which also evaluates an array subscript such as `a[$(cmd)]` (D5).
- change WD:23 and WD:32-33: feed jq through a pipe (`printf '%s' "$raw" | jq ...`) instead of a here-string; `$raw` holds every listed deployment's spec, and a here-string goes to a temp file on bash before 5.1 and, on later bash, when it exceeds the pipe size (D6).

**E5. EP (edit: the `migrate` role only; base mode 100644, 82 lines).** P50's hunk (`@@ -75,8 +75,18 @@`) inserts a `migrate)` arm after the `provision` arm and adds `|migrate` to the invalid-role message. The migration command that exists in the image at base is exactly `pnpm --filter @plexco/bot exec tsx ../../packages/db/src/migrate.ts`:
  - `pnpm --filter @plexco/db migrate` (`packages/db/package.json:22` `"migrate": "tsx src/migrate.ts"`) cannot run in the image: `tsx` is a devDependency of `@plexco/db` (`packages/db/package.json:29`, `:33`); the image installs `--prod` (DF:40), copies the pruned root `node_modules` (DF:55), strips the build stage's per-workspace `node_modules` (DF:60) and overlays the pruned ones (DF:61-62); the root package has no `dependencies` block (`package.json:32` is `devDependencies`).
  - `tsx` is a production dependency of `@plexco/bot` (`apps/bot/package.json:12`, `:17`), so `pnpm --filter @plexco/bot exec tsx` exists in the image; MG is in the image (DF:56 copies `/app/packages` from the build stage, which ran `pnpm -w build` at DF:35); MG imports only node built-ins and `pg` (MG:1-5), and `pg` is a dependency of `@plexco/db` (`packages/db/package.json:27`).
  - MG reads only `DATABASE_URL_MIGRATION` (MG:415), refuses an empty value (MG:171-175: "migrate: DATABASE_URL_MIGRATION is required (DDL-owner role)") and its CLI path prints only a safe summary (MG:399-403, MG:408-410) and exits 1 (MG:420-422), or 0 after `[migrate] applied=<n> skipped=<n>` (MG:417-418).
  - Not measured in a built image (docker is outside S0's bounds); the image build in CI (`pnpm -w build`) does not run the role either.
- insert the arm between EP:77 (`;;` of `provision`) and EP:78 (`*)`), with an English comment and ONE command: `exec pnpm --filter @plexco/bot exec tsx ../../packages/db/src/migrate.ts`.
- drop P50's `exec pnpm --filter @plexco/bot provision:queue` from the arm: ES keeps them as two steps, "2. Run migrations with `DATABASE_URL_MIGRATION`." (ES:428) and "3. Run `infra/entrypoint.sh provision` using the same job-scoped credential." (ES:429), and step 3 is the existing `provision` arm (EP:68-77, EP:76). Nothing else can run through the role: the arm reads no argument (`$1` only selects the role, EP:10; there is no `"$@"`), its command and path are literals, `exec` replaces the shell so nothing runs after it, and EP:5 is `set -eu`.
- drop P50's guard `: "${DATABASE_URL_MIGRATION:?...}"` (D7): MG:171-175 already refuses the empty value with a named message and exit 1, so the guard is a second definition of the same rule.
- keep P50's `|migrate` added to the role list of the invalid-role message (EP:79); change nothing else on that line.
- drop P50's mode change 100644 -> 100755: the image copies the script and runs `chmod +x` itself (DF:63-64), so the git mode is unused.
- EP:23-37 already give `migrate` no DB-role expectation (the `*)` arm EP:34-36), so EP:45-50 do not apply to it; no change.

**E6. `.gitignore` (edit: one block; base 82 lines, unchanged since the merge base).** P50 appends after line 82 (`apps/web/public/sw.js`): a blank line, a comment, `spec.local.json`.
- keep the blank line and `spec.local.json` (it matches at any depth).
- change the comment to cover both uses (D2), for example `# App Spec carrying secret material (renderer output or a spec assembled locally); never commit`.

**E7. `package.json` (edit: two lines).** P50 (+2 -1 against its merge base): adds `"test:infra": "node --test infra/render-app-spec.test.mjs"` and inserts `pnpm run test:infra` into `test`. Main's `test` is now `package.json:11`: `"test": "pnpm run kit:check && pnpm run guard:dev-login && pnpm run test:review-readiness && pnpm -r run test",`.
- change `package.json:11` to `"test": "pnpm run kit:check && pnpm run guard:dev-login && pnpm run test:review-readiness && pnpm run test:infra && pnpm -r run test",` (after the no-DB node tests, before the DB-backed workspace suites).
- insert after `package.json:11` (as the new line 12, where P50 put it): `"test:infra": "node --test infra/render-app-spec.test.mjs",`. No `test:infra` exists at base.
- drop every other P50 difference in `package.json` (the direct base-to-P50 numstat is +9 -14 only because main moved since the merge base).

### 2.2 Q2: the renderer contract

Read on P50 (RS, RT). Exit paths marked "measured" were run by S0b on P50's RS copied to a temp dir, fake data only (no doctl, no network; `/bin/bash` 3.2.57, jq 1.8.2).

- Inputs: stdin = the committed App Spec as JSON (RS:30); `$1` = the live spec file (RS:18, required); env `IMAGE_DIGEST`, `VPC_ID` (required, RS:19-20), `APP_DOMAIN` (optional, RS:21), shape-checked at RS:23-27 with fixed messages that never echo the value. Unset `IMAGE_DIGEST`: exit 1, stderr `...: line 19: IMAGE_DIGEST: IMAGE_DIGEST is required`, stdout empty (measured).
- Output: stdout = the rendered spec, one JSON document (RS:33-66), exit 0, stderr empty (measured). String values get `__IMAGE_DIGEST__`, `__VPC_ID__` and, when set, `__APP_DOMAIN__` substituted (RS:59-62); any `__[A-Z_]+__` left fails (RS:63-64). By design stdout carries the copied ciphertext: a data channel for a file, never a log (§8).
- Which secrets are copied (a rule, not a list of names): in `services[]`, `workers[]` and `jobs[]` of the committed spec, every env entry with `type == "SECRET"` and no or an empty `value` (RS:47-48) takes the value of the live entry with the same component kind, component `name` and `key` (lookup key `<kind>/<name>/<KEY>`, RS:36-38); only live entries with `type == "SECRET"` and a non-empty value are candidates (RS:37), so a live GENERAL entry is never copied. RT's fake names: `jobs/migrate/DATABASE_URL_MIGRATION`, `services/web/DATABASE_URL`, `workers/worker/DATABASE_URL` (RT:18, :23, :26); the real names come with L66's App Specs (not on main). A committed SECRET that already has a value is kept unchanged (RS:48, RS:52; §8 S3).
- Missing secret: jq `error()` at RS:50; exit 5; stderr `jq: error (at <stdin>:1): missing secret in live app: services/web/DATABASE_URL - set it in DO first`; stdout 0 bytes (measured; the `jq: error (at ...)` prefix is jq's and may differ by version, RT:59 matches the message only). RS writes no file; a caller's `> spec.local.json` is truncated by the caller's shell before RS starts, so after a failure that file exists and is empty: the caller must stop on the exit status (L67).
- Other fail paths, all non-zero with stdout empty: `DATABASE_URL_MIGRATION` outside a PRE_DEPLOY job (RS:43-45, a closed set by counting); a valueless SECRET on a surface `fill` does not cover (RS:56-58); an unresolved placeholder, naming the token only (RS:63-64); a missing or non-JSON live file (jq stops before any output); stdin that is an array or a string (exit 5, measured).
- Gap (found by S0b, measured): stdin `null` (what an empty YAML document can give through `yq -o=json`) or `{}` renders `{"services":[],"workers":[],"jobs":[]}` with exit 0, so the intent of RS:29-31 ("Empty stdin (a failed upstream `yq`) must fail HERE") holds only for 0 bytes. New hunks E1 (S0b) and E2 (S0b).
- No value printed or written: no `set -x` (RS:16 is `set -euo pipefail`); every `echo` is fixed text (RS:23, :24, :26, :31); the `:?` messages name the variable only; the jq `error()` texts carry a kind, component name, key or placeholder token only (RS:45, :50, :58, :64). The live file, the one secret-bearing input, is read by jq through `--slurpfile` (RS:33) and never enters a shell variable, an argument or the here-string; the here-string carries only the committed spec (RS:66), which by contract has no secret value (RS:11). Residue: jq's runtime-error text quotes its operand (measured: `Cannot index array with string ("jobs")`); a live spec of the documented shape raises none (§8 S4).
- The 7 tests (each spawns `bash RS <live.json>` with env `PATH`, `IMAGE_DIGEST`, `VPC_ID` only, RT:38-42):
  - RT:45 copies each secret from the SAME component (key `DATABASE_URL` has a different fake value in `web` and `worker`) and fills `__VPC_ID__` and `__IMAGE_DIGEST__`; exit 0.
  - RT:56 the live `worker` lacks the secret: non-zero, the message names `workers/worker/DATABASE_URL`, stdout empty. The TESTS mutation target: a mutated RS:50 still fails the render through RS:56-58, so RT:59's message match is what catches it.
  - RT:63 `DATABASE_URL_MIGRATION` on 6 other surfaces (services, workers, functions, static_sites, top-level envs, a POST_DEPLOY job), each valued so the guard, not the missing-secret check, rejects it: non-zero, the guard's message, stdout empty.
  - RT:83 a valueless SECRET on `functions`: non-zero, "unfilled SECRET outside services/workers/jobs".
  - RT:91 empty stdin: non-zero, "empty spec on stdin".
  - RT:104 the unresolved-placeholder message names the token only, never the string around it.
  - RT:112 rejects `IMAGE_DIGEST=latest`, `VPC_ID=abc`, and `__APP_DOMAIN__` with `APP_DOMAIN` unset; substitutes `APP_DOMAIN` when set.
- jq on CI: the runner image readme for `ubuntu-24.04` (https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md, accessed 2026-10-28): "Image Version: 20261023.334.3", "OS Version: 24.04.5 LTS", Tools list "jq 1.7", "Bash 5.2.21(1)-release". CI installs no jq (2.4), so RT relies on that preinstalled jq. Locally: `command -v jq` = `/opt/homebrew/bin/jq`, `jq --version` = `jq-1.8.2`; `bash` on PATH = `/bin/bash` 3.2.57 (RT spawns `bash` from PATH); shellcheck not installed (TESTS: `bash -n` only, say so).

### 2.3 Q3: output shapes and fail-closed parsing

Reference facts, accessed 2026-10-28, quoted as returned by the fetch (no doctl was run):
- R1. App spec reference (https://docs.digitalocean.com/products/app-platform/reference/app-spec/), field `name`: "String. The name of the app. Must be unique across all apps in the same account." (2 to 32 characters and a pattern; the page does not say "required").
- R2. Same page, `services > envs > type`: "String. The type"; values `GENERAL` "A plain-text environment variable" and `SECRET` "A secret encrypted environment variable"; its File Structure Example writes `type: secret` in lower case. The same `key`/`value`/`type` fields exist under `workers`, `jobs`, `functions`, `static_sites` and top-level `envs`.
- R3. Same page, `services > envs > value`: "String. The value. If the type is `SECRET`, the value will be encrypted on first submission." and "On following submissions, the encrypted value should be used."; the example value has the form `EV[1:...]`.
- R4. doctl `apps spec get` (https://docs.digitalocean.com/reference/doctl/reference/apps/spec/get/): usage "`doctl apps spec get <app id> [flags]`"; "Use this command to retrieve the latest spec of an app."; `--format` "the format to output the spec in; either “yaml” or “json”", default `yaml`; nothing about secret values; the global `--show` flag: "Reveal masked values, such as secrets, instead of hiding them. Values are unmasked automatically in CI".
- R5. App spec page, `services > image > digest`: "String. The image digest. Cannot be specified if tag is provided." (also under `workers`, `jobs`); `jobs > kind`: `UNSPECIFIED` "Default job type, will auto-complete to POST_DEPLOY kind.", `PRE_DEPLOY` "Indicates a job that runs before an app deployment.", `POST_DEPLOY`, `FAILED_DEPLOY`, `SCHEDULED`.
- R6. doctl `apps list-deployments` (https://docs.digitalocean.com/reference/doctl/reference/apps/list-deployments/): usage "`doctl apps list-deployments <app id> [flags]`"; "List all deployments for an app."; "For complete app details including the app specs, use the JSON format."; `--output`, `-o` "Desired output format [text|json]", default `text`; text columns `ID`, `Cause`, `Progress`, `Phase`, `Created`, `Updated`. No phase values and no order are given.
- Not re-checked (absent from these pages; the 4-fetch cap was used): `doctl apps get -o json` and `.[0].active_deployment.id`; the deployment's `.id` and `.phase`; the phase values; the order of the list; what `--show` changes in `apps spec get`. The writer keeps the fail-closed limits below: a known risk (K1), not a blocker.

| Script:line | Reads | Unknown or missing shape | Result |
|---|---|---|---|
| RS:36-38 | live `services/workers/jobs[]`, `.name`, `.envs[].type/.key/.value` | empty live file, or another object (for example `apps get` output) | no candidates: each committed SECRET fails "missing secret" (exit 5) |
| RS:36 | same | the live file is an array | jq type error, exit 5 |
| RS:37, :48, :57 | `.type` | lower-case `secret` (R2) | today passes valueless (open): E1 (S0b) case-insensitive predicate |
| RS:49-51 | the copied `.value` | a masked or plain value (R4) | today copied, then submitted as a new secret (R3; open): E1 (S0b) EV form check |
| RS:30-31 | stdin | `null` or `{}` | today exit 0, empty spec (measured; open): E1 (S0b) name check |
| RS:44 | `.jobs[].kind` | lower case or missing (`UNSPECIFIED` becomes POST_DEPLOY, R5) | the PRE_DEPLOY count drops, the guard fails (closed) |
| WD:22 | `list-deployments -o json` | doctl non-zero | counted; the 5th consecutive failure exits 1 (WD:28) |
| WD:23 | `.[]`, `.spec.services[]?`, `.name`, `.image.digest` | not an array (for example an envelope object) | jq type error, counted (WD:28) |
| WD:23 | same | empty output, `[]`, no `spec`, no `digest`, no service `web` | "no deployment ... yet" until the deadline, exit 1 (WD:42) |
| WD:32-33 | `.id`, `.phase` | missing (jq prints `null`) or an unknown phase | no `case` arm: polls until WD:42; `ACTIVE` with id `null` fails WD:47 |
| WD:46 | `apps get -o json`, `.[0].active_deployment.id // empty` | doctl fails or not an array | `set -euo pipefail` (WD:9) stops non-zero |
| WD:46-47 | same | the field is missing | empty string, not equal: exit 1 |

No WD path loops past WD:42 (checked on every iteration, the failure branch included), and none exits 0 except `ACTIVE` plus WD:47's id match.

- Gap (semantic, found by S0b): WD knows "its" deployment only by the `web` digest and takes the first listed match (WD:4-5, WD:23; the order is not re-checked, R6). If an earlier deployment of the same digest is taken (ours not listed yet, or an oldest-first order), SUPERSEDED, ERROR or CANCELED exits 1 (closed, a false failure) but ACTIVE passes WD:36 and WD:47 at once: a false success for a same-digest redeploy, such as a config-only change. WD cannot close it without a new input (the deployment id from the caller), which is L67's interface: no hunk here; K2 (section 9) and backlog row 1 (W2).

### 2.4 Q4: the test chain and the smoke overlap

- CI: job `verify` (CI:25), `runs-on: ubuntu-24.04` (CI:27), `timeout-minutes: 20` (CI:29), `actions/setup-node` with `node-version: 22` (CI:61-63), step `Test` with `run: pnpm -w test` (CI:105-106). CI has no step that installs jq (no `jq` in CI): RT relies on the runner image's preinstalled jq (2.2).
- `pnpm -w test` runs the root `test` chain (`package.json:11`); with E7 the chain is `kit:check && guard:dev-login && test:review-readiness && test:infra && pnpm -r run test`. `&&` makes a red RT stop the chain before the DB suites and fails the `Test` step; RT needs no database, port or secret. The Playwright job (CI:114-149) does not run the root `test`.
- Overlap of SC with SP, recorded for L74 (PL:114: L74 runs after L65; SP is not touched here): both check `/healthz` `.ok === true`; SP is stricter on it (exact 200 at SP:39-40, `redirect: "error"` at SP:35, body check SP:48-49) and accepts `http://` (SP:22), while SC requires `https://` (SC:8) and also checks `/` (SC:15-16) and the manifest (SC:18). One smoke or two is L74's decision (MS:69).

## 3. Lead corrections

Each: the lead, the line that differs at base, what the lane follows.

- C1. The lane block's lead (4) cites `environments-setup.md:81` for "do not create the App Spec". At base ES:81 is the Meta Messenger row of the channel table; the sentence is ES:108 ("Until the gate closes, do not create the App Spec and do not disable the private DB path silently."). The lane follows ES:108 (as §1 does); the rule is unchanged.
- C2. PL:77 (the plan's §3 row L65) still shows the run cap `4` in its last column. The owner raised it to 6 on 2026-10-28 (D46 of the conductor's decision log). The lane follows 6; PL is not this lane's file and is not edited here.
- C3. The lane block's lead (1), row 7, says SC checks "`/manifest.webmanifest` 2xx". P50's SC:18 runs `curl -fsS` with no `-L` and no status check, so a 3xx passes. The lane follows E3 (D4): 2xx is enforced on `/` and on the manifest.

## 4. Decisions (each "default applied, pending owner sign-off")

- D1. Writer split, one writer at a time: W1 = RS + RT + `package.json` + `.gitignore` (E1, E2, E6, E7), acceptance A-1 to A-5, A-8, A-9; then W2 = WD + SC + the EP `migrate` role + the backlog rows (E3, E4, E5, section 11), acceptance A-6, A-7, A-9, A-12, A-13. The orchestrator runs A-10 and A-11 after W2. Both use the lane block's TESTS commands.
- D2. The local render lands in `spec.local.json`, the one ignored name, and the ignore comment covers both uses (E1 RS:6, E6): one name for secret-bearing spec files.
- D3. The renderer substitutes placeholders and checks unresolved ones before it copies secrets (E1): a copied value is never transformed, scanned or quoted.
- D4. SC requires a 2xx on `/` and on the manifest (E3): `curl -f` without `-L` lets a 3xx pass.
- D5. WD refuses a non-digit timeout before the arithmetic (E4): bash arithmetic evaluates an array subscript such as `a[$(cmd)]`.
- D6. WD feeds jq through a pipe, not a here-string (E4): the here-string goes to a temp file on bash before 5.1, or above the pipe size, and `$raw` carries every listed deployment's spec.
- D7. EP's `migrate` arm has no `DATABASE_URL_MIGRATION` guard (E5): MG:171-175 already refuses the empty value with a named message and exit 1; one definition of the rule.
- D8. The renderer fails closed on the three shapes found at step 0 (E1, E2 S0b: a nameless document, a lower-case type, a non-EV live value); WD's same-digest gap is left to L67's interface with a backlog row (2.3 Gap): no new WD input in a port.

## 5. Acceptance matrix (A-1..A-13; expected results)

| # | Command (writer) | Expected |
|---|---|---|
| A-1 | `node --test infra/render-app-spec.test.mjs` (W1) | 7 pass, 0 fail |
| A-2 | after the fix commit: mutate RS:50's `$v == null` to `false`, rerun A-1, restore with `git checkout --` (W1) | RT:56 fails; A-1 green again |
| A-3 | remove each S0b check in turn (name check, RS:57 case, EV `elif`), rerun A-1, restore (W1) | test 5, 4, 2 fail in turn |
| A-4 | `git ls-files -s infra/` (W1, W2) | RS, WD, SC 100755; RT and EP 100644 |
| A-5 | `bash -n` on RS, WD, SC; `command -v shellcheck` (W1, W2) | exit 0; shellcheck "not installed" recorded |
| A-6 | `PATH=/usr/bin:/bin bash infra/wait-for-deployment.sh app sha256:x 1x` (W2) | exit 1, "wait: timeout must be whole seconds", before any doctl lookup |
| A-7 | `grep -c '<<<' infra/wait-for-deployment.sh` (W2) | 0 |
| A-8 | `git check-ignore -v spec.local.json infra/spec.local.json` (W1) | both matched by the E6 line |
| A-9 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` (each writer) | green |
| A-10 | `pnpm -w test` through the DB/e2e lock wrapper (orchestrator) | `test:infra` runs after `test:review-readiness`, before `pnpm -r run test`; all green |
| A-11 | `pnpm review:check:changed` before each commit; `pnpm review:check`; final-checks.sh; GitNexus detect_changes (orchestrator) | green; the declared files only |
| A-12 | `grep -n 'migrate' infra/entrypoint.sh` (W2) | one new arm with exactly the E5 command, `migrate` added to the role list; no `provision:queue`, no `:?` guard in the arm |
| A-13 | `grep -c 'http_code' infra/smoke-check.sh` (W2) | 2 |

## 6. Verification and review

The lane block's TESTS and REVIEW PLAN as-is: one opus reviewer role, at most 3 rounds counting pre-push rounds, plus one opus security round on section 8; CI green on one push.

## 7. Budget (B3) and files

Estimate (lane block): about 270 changed lines in 7 files, about 150 non-test and about 121 test, 0 migrations. P50 numstat against the base: `.gitignore` 3/0, `infra/entrypoint.sh` 11/1, RS 66/0, RT 121/0, SC 19/0, WD 48/0, `package.json` 9/14 (against the merge base 2/1, the part E7 takes): 151 non-test plus 121 test = 272. The step-0 hunks add an expected 30 to 40 test lines (E2) and under 10 non-test lines (E1, E3, E4; E5 drops lines): an expected overrun of about 15 percent with that design reason, logged, not a stop.

## 8. Security notes for the security round

- S1. stdout: RS's stdout carries the copied ciphertext by design; its only sinks are a file (`spec.local.json`, ignored at any depth by E6) or a runner temp file (L67), never a log or `tee`. RT keeps stdout in memory (spawnSync).
- S2. stderr: names, keys and placeholder tokens only (2.2); the S0b messages name the key only; WD prints ids, phases and the digest; WD:22 discards doctl's stderr.
- S3. A committed SECRET that already carries a value passes through unchanged (RS:48, RS:52): RS does not enforce RS:11's "carries NO value". Pinned current behavior; L66's review owns its App Specs (backlog row 2); the security round may rule otherwise.
- S4. jq's runtime-error text quotes its operand (2.2); a live spec of the documented shape raises none; a malformed one could quote part of a ciphertext. Residual, low.
- S5. xtrace: no `set -x` in RS, WD or SC. Under `bash -x`, RS would trace only the committed spec and the digest, VPC id and domain; WD would trace `raw=...`, every deployment spec with its ciphertexts: L67 must not trace WD (backlog row 1).
- S6. Temp files: RS's here-string holds only the committed spec; WD keeps no here-string after E4; RT writes fake data only, in a per-call dir with `TMPDIR` pointed at it and removed in `finally` (E2).
- S7. The EP `migrate` role takes no argument, runs one literal command with `exec` under `set -eu`, and MG reads only `DATABASE_URL_MIGRATION` (E5, MG:415).

## 9. Known risk

- K1. Doctl output shapes not re-checked (2.3): the deployment's `.id` and `.phase`, the phase values, the list order and `.[0].active_deployment.id`. Every unknown or missing shape stops non-zero (the 2.3 table); a changed shape fails a deploy, it never passes one.
- K2. WD's same-digest false success (2.3 Gap): L67 must deploy a new digest each time or await the deployment by id (backlog row 1).
- K3. RS and WD are DigitalOcean-specific (doctl, the App Spec, EV ciphertext). The plan's Q7 fallback (Fly) is not covered and no Fly variant is built; Q7 triggered during the lane = a ruling request (lane STOP).
- K4. Doctl masks secret values outside CI unless `--show` (R4); a local render may receive masked values, which E1's EV check rejects, naming the key. Whether `--show` unmasks `apps spec get` was not re-checked.

## 10. Open

`OPEN_QUESTIONS_IN_SCOPE: 0`. Out of scope with current behavior pinned: K2 (L67), K3 (Q7), S3 (L66 and the security round).

## 11. Hard dependencies and backlog rows

- #134 merged: `git merge-base --is-ancestor dced86d4237416822d98795f8c2a3a970c41444c 4345c284857f70d398d1421ef25db796b56ad319` is true; dced86d is "Merge pull request #134 from maingocanh1702/docs/p5-golive-plan". Q1 and Q2 answered with their defaults (D46). Nothing else is needed for W1.
- W2 appends at most 3 rows at the END of BL: row 1 (L67: await the deployment by id, keep RS stdout out of logs, never trace WD; K2, S1, S5); row 2 (L66: committed App Specs carry no SECRET value and use `type: SECRET`; S3).

## 12. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base (measured); every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | the owner's approval of PL row L65, Q1, Q2 (D46); D1-D8 as defaults pending owner sign-off (section 4) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane block's FILE OWNERSHIP and NEGATIVE SCOPE (section 1); D1's writer split | PASS |
| 4 | Dependencies classified | #134 merged (section 11); runs beside L79 (no shared file); L66, L67, L74 downstream | PASS |
| 5 | Live schema and code match | section 2 measured at the base and on P50; no schema, no migration | PASS |
| 6 | Data, API, state, auth contract | the renderer contract (2.2), the output shapes (2.3), the EP role (E5) | PASS |
| 7 | Fail-closed, idempotency, order | the 2.3 table; D3; E1 (S0b); WD:28 and WD:42 bound every loop | PASS |
| 8 | Open questions in scope = 0 | section 10 | PASS |
| 9 | Acceptance matrix with expected results | section 5 (A-1..A-13) | PASS |
| 10 | Migration, security, rollback | no migration; one security round on section 8; rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged (section 11) | PASS |
| 12 | Implementation handoff ready | section 2.1 (E1-E7), sections 4 and 5; W1 has every input | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-28
AUTHORITY_SHA: 4345c284857f70d398d1421ef25db796b56ad319
BASE_BRANCH: main
TARGET_FILES:
  - infra/entrypoint.sh (edited: the migrate role only, E5)
  - .gitignore (edited: one ignore block, E6)
  - package.json (edited: the test:infra script and its place in test, E7)
  - docs/autopilot-backlog.md (edited: new rows at the end only, cap 3)
  - infra/Dockerfile (read-only: the image facts of E5)
  - packages/db/src/migrate.ts (read-only: the migration command and its refusal, E5)
  - packages/db/package.json (read-only: tsx is a devDependency)
  - apps/bot/package.json (read-only: tsx is a production dependency)
  - .github/workflows/ci.yml (read-only: the verify job and its Test step)
  - docs/standards/environments-setup.md (read-only: ES:108 and the two migration steps)
  - scripts/smoke-predeploy.mjs (read-only: lane L74's file, the overlap)
SLICE: p5-staging-tooling-port
IN_SCOPE: four new files ported from PR 50 with the section 2.1 hunks (infra/render-app-spec.sh, infra/render-app-spec.test.mjs, infra/wait-for-deployment.sh, infra/smoke-check.sh); the migrate role of infra/entrypoint.sh; the spec.local.json ignore block; the test:infra script and its place in the root test chain; at most 3 backlog rows; this readiness file
OUT_OF_SCOPE: doctl, gh workflow run, any cloud CLI, console, account, login or deploy; the App Specs (L66); the deploy workflows (L67); scripts/smoke-predeploy.mjs and the Playwright config (L74); log-context (L68); the runbooks (L69, L70); infra/Dockerfile and infra/fly.toml; any secret value; PR 50 and its branch; a Fly variant (Q7)
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: #134 merged (dced86d4237416822d98795f8c2a3a970c41444c is an ancestor of the base, measured)
PRIOR_SLICES: #134 (merged: the Phase 5 go-live plan); #135 (merged, in the base)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 8; rollback = revert the PR
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - copy RS and RT from origin/feat/mvp-m5-staging with git show, apply E1 (S0 and S0b hunks), E2, E6 and E7, run A-1 to A-5, A-8 and A-9, commit in the worktree
REMAINING_BLOCKERS: none
```
