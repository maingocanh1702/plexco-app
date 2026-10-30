<!-- review-readiness: code-ready -->

# Step-0 readiness: L67 p5-deploy-workflows (session P5-S3a)

> Agent-facing. Step 0 by the step-0 readers R0, R1 and R2 (opus). RISK: P1 config with a security round. Base `2d91aea9c99dc5bc71ab932f208929f76de37436` = origin/main = worktree HEAD = the merge of PR #150 (measured by the lane orchestrator at T0 and by `git log --merges`, section 11); branch `feat/p5-deploy-workflows`; worktree `.autopilot/worktrees/p5-deploy-workflows`. STATUS: COMPLETE. B-1 closed by the conductor ruling RO-L67-2 of 2026-10-30 (section 4.3); B-2 and B-3 closed by R1 from the official pages (sections 4.4, 4.5); verdict CODE_READY (section 13).

Short forms: P50S / P50P = PR 50's `.github/workflows/deploy-staging.yml` / `deploy-production.yml` (line numbers of `git show origin/feat/mvp-m5-staging:<path>`, read only); CI = `.github/workflows/ci.yml`; RS = `infra/render-app-spec.sh`; WD = `infra/wait-for-deployment.sh`; SC = `infra/smoke-check.sh`; EP = `infra/entrypoint.sh`; PQ = `apps/bot/src/provision-queue.ts`; M0 = `packages/db/migrations/0000_roles_extensions.sql`; SS / SP = `infra/app.staging.yaml` / `infra/app.prod.yaml`; M = `docs/runbooks/env-manifest-staging-production.md`; ES = `docs/standards/environments-setup.md`; L66R = `docs/sessions/web-mvp-phase5-readiness-p5-app-specs.md`; PL = `docs/sessions/web-mvp-phase5-golive-plan.md`. Out-of-repo action commits are written as 12-hex abbreviations with their tag; the writer copies the full SHA byte for byte from the cited line.

## 1. Authority

- The owner's own decision: the written approval of 2026-10-28 (DD-154) of PL: row L67 (PL :79), run cap 6; Q1 default (agents write deploy FILES only; a deploy happens only when the owner presses `workflow_dispatch`); Q2 default (a fresh lane ports PR 50's still-valid parts); Q4 default (plexco.app); B2 (the owner brings the DigitalOcean deploy into scope).
- The owner's own decisions of 2026-10-30: 11:10 "continue with L66, L67, L69" once G1 passed; 16:40 the P12 rules of the REVIEW PLAN (section 6); 16:50 the conductor starts L67 after #150 merges, and the L67 PR stays an OWNER merge (the clerk's deploy guard matches `.github/workflows/*deploy*`).
- Every other choice in this file is "default applied, pending owner sign-off" or "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature".
- Scope (lane block FILE OWNERSHIP): `.github/workflows/deploy-staging.yml` and `.github/workflows/deploy-production.yml` (new); SS and SP: none (RO-L67-2 withdraws the spec-block ownership, section 4.3); this file; at most 3 new rows at the END of `docs/autopilot-backlog.md`. Nothing else: not EP, RS, WD, SC or CI.
- Negative scope (as-is): no `gh workflow run`, doctl, cloud CLI, console, login or deploy; never set or read a secret or variable value; no push, tag, schedule or workflow_run trigger; no runbook (L69); no Fly variant; PR 50 and its branch read only.

## 2. Measured at base

- T0 (lane orchestrator, cited, not re-measured): the excerpt sources are unchanged at the base (`git diff --quiet` clean against 2688ce3 for SS/SP and be955cf for CI, RS, WD, SC, M); ES "Required CI order" is :429 (heading), :431-435 (items 1-5), :437-438 (rule) at the base. Reconcile baseline: `scripts/autopilot-backlog-reconcile --check` rc=0, close_by REFUSED=2, MALFORMED=0.
- Non-CI pins (T0, read-only `gh api` on 2026-10-30 17:11 +07: tag ref = commit for lightweight tags, `commits/<tag>`, `releases/tags/<tag>` non-draft and non-prerelease): digitalocean/action-doctl v2.5.2 = `3cb395315971` (P50S :69, P50P :91); docker/setup-buildx-action v4.4.1 = `f87e5991a6d7` (P50S :76); docker/build-push-action v7.4.0 = `c3c9e263c25d` (P50S :80). All match PR 50.
- CI pins to reuse byte for byte: actions/checkout v7.0.0 `9c091bb21b7c` (CI :47, :117 = P50S :49, P50P :67); pnpm/action-setup v6.0.9 `0ebf47130e48` (CI :58, :119); actions/setup-node v7.0.0 `820762786026` (CI :61, :121); actions/upload-artifact v7.0.0 `bbbca2ddaa5d` (CI :147 = P50S :145, P50P :144). CI pins `runs-on: ubuntu-24.04` (CI :26-27, :113-114: "ubuntu-latest moves to 26.04 from 2026-10-19").
- CI job ids are `verify` (CI :25) and `e2e-web` (CI :112) with no `name:` override: these are the check-run names P50S :62 matches.
- RS: usage `yq -o=json <spec> | IMAGE_DIGEST=... VPC_ID=... [APP_DOMAIN=...] RS <live-spec.json>` (:4-6); digest `^sha256:[0-9a-f]{64}$` (:32), VPC UUID (:33), APP_DOMAIN optional hostname (:30, :34-36), an unfilled placeholder fails (:18); empty stdin fails (:38-40); live `.name` must equal the committed `.name` (:19, :58); failures name keys, never values (:22-24). The DDL guard (:59-65) compares the count of `DATABASE_URL_MIGRATION` in the whole document with its count over ALL `PRE_DEPLOY` jobs: a second PRE_DEPLOY job carrying it renders.
- WD: `<app-id> <digest> [timeout=900]` (:3); "ours" = the `web` image digest (:4-5); "a failed migration ends the phase in ERROR (previous deployment keeps serving)" (:6-7, L65's comment, not an official fact). SC: `<https://origin>`, https only, a thin adapter of `scripts/smoke-predeploy.mjs` (:2-8).
- SS: `vpc.id: __VPC_ID__` (:29-30), `domains: - domain: __APP_DOMAIN__` (:34-35), jobs = `migrate` only, `kind: PRE_DEPLOY`, image `registry_type: DOCR`, `repository: plexco`, `digest: __IMAGE_DIGEST__`, envs `PROCESS_ROLE=migrate` and SECRET `DATABASE_URL_MIGRATION` (:69-85); services from :87; `APP_BASE_URL` = `https://__APP_DOMAIN__` (:124-127). SP: `__VPC_ID__` :31, `__APP_DOMAIN__` :34, `migrate` PRE_DEPLOY :57-58, `repository: plexco` :61, web :75, worker :175, `APP_BASE_URL` :111-114 and :200-203. Neither spec has a `provision` component (L66R :284, K6).
- M: names only (:77-95): secret `DIGITALOCEAN_ACCESS_TOKEN`; variables `DOCR_REGISTRY`, `DO_VPC_ID`, `DO_APP_ID`, `STAGING_BASE_URL`, `PRODUCTION_BASE_URL`, `APP_DOMAIN`; tooling `IMAGE_DIGEST`, `VPC_ID`, `SMOKE_BASE_URL`; no runtime secret in GitHub (:79); `STAGING_GOLDEN_PATH` is the owner's machine, step 8.6 (:92); provision's place "L63 and L67 decide" (:24); `DATABASE_URL_MIGRATION` only on migrate and provision (:71, :75).
- EP: role = `${1:-${FLY_PROCESS_GROUP:-${PROCESS_ROLE:-web}}}` (:10); `provision` (:68-77) builds the pg-boss schema and queues with the migration role, "One-shot" before the worker; `migrate` (:78-85) "step 2 of the required CI order ... (`provision` above is step 3)". PQ :8-16: "Idempotent - safe to run on every deploy"; it grants `app_worker` DML (:42-53) and reads only `DATABASE_URL_MIGRATION` (:63). M0 :25-26 creates `app_worker` IF NOT EXISTS, so on an empty database provision's grants need migration 0000 first.
- `ls packages/db/migrations | grep -i -E 'down|revert'` is empty: no down-migration exists.

## 3. Lead corrections

Three, all line ranges; none changes a decision:
1. Lane block E7 "staging :69-75 the migrate PRE_DEPLOY job": the job block is SS :69-85 (the credential is :83-85).
2. Lane block E7 "staging :127 APP_BASE_URL": the key is SS :124, the value :127.
3. Lane block E2 ":140 evidence": the evidence step is P50P :131-142 (:140 is its jq filter line).

## 4. Decisions

### 4.1 Q1 - staging (P50S)

| # | Step | P50S | Decision | Reason |
|---|---|---|---|---|
| 1 | header | :1-21 | change | keep the trigger policy, the one-job rationale and the migration path (:17-21); drop the Playwright sentence (:4-6) and every pointer to a runbook that is not on the base (`git ls-files docs/runbooks` decides; L69 writes runbooks) |
| 2 | trigger | :23-24 | change | `workflow_dispatch` only, plus two optional string inputs for the rollback job (4.4): `rollback_deployment_id`, `confirm` |
| 3 | permissions | :26-28 | change | top-level `permissions: {}`, per-job blocks (4.5) |
| 4 | defaults bash | :30-33 | port | pipefail |
| 5 | concurrency | :35-38 | port | `group: deploy-staging`, `cancel-in-progress: false`; it also serializes the rollback job |
| 6 | env IMAGE_REPOSITORY | :40-41 | port | `plexco` (= SS `repository`) |
| 7 | job header | :43-47 | change | `runs-on: ubuntu-24.04` (CI :27, :114); `if: inputs.rollback_deployment_id == ''`; `environment: staging`; timeout 75 kept |
| 8 | checkout | :49-51 | port | CI :47 pin, `persist-credentials: false` |
| 9 | resolve SHA | :53-54 | port | |
| 10 | require green `verify` and `e2e-web` on the SHA | :56-67 | port | `GH_TOKEN: ${{ github.token }}` on this step only; a missing run reads `null` and fails |
| 11 | action-doctl | :69-71 | port | v2.5.2 `3cb395315971`; `token: ${{ secrets.DIGITALOCEAN_ACCESS_TOKEN }}` |
| 12 | DOCR login | :73-74 | port | `--expiry-seconds 3600` |
| 13 | setup-buildx | :76 | port | v4.4.1 `f87e5991a6d7` |
| 14 | build and push once | :78-85 | port | v7.4.0 `c3c9e263c25d`; tag = SHA; the DIGEST (`steps.push.outputs.digest`) is what deploys |
| 15 | evidence JSON | :87-99 | port | fields `environment, git_sha, requested_ref, image_repository, image_tag, image_digest, built_at, run_url, triggered_by`: no secret, no spec content |
| 16 | render | :101-110 | change | add `APP_DOMAIN: ${{ vars.APP_DOMAIN }}` (SS :35, :127 need it; RS :18 fails without it); before RS, refuse a domain that is not `^staging[a-z0-9-]*\.plexco\.app$` (SS :32-33 "first label starts with staging"); keep "never print the rendered spec" and the names/digests jq projection (:109-110) |
| 17 | `doctl apps update` | :112-115 | port | |
| 18 | wait | :117-120 | port | WD, timeout 1500 |
| 19 | smoke | :122-125 | change | SC with `vars.STAGING_BASE_URL`, after a one-line check that its host equals `APP_DOMAIN` (a smoke of another origin would read green) |
| 20 | pnpm, node, install, Playwright install, whole-suite step 6 | :127-143 | drop | the deployed-origin e2e is lane L74's; the staging golden path is the owner's step 8.6 (M :92). SC stays. PR 50 ran SC on the runner's preinstalled node (:122-125 before :129); the writer greps `scripts/smoke-predeploy.mjs` imports read-only: a non-builtin import adds setup-node (CI :61 pin, node 22) and `pnpm install --frozen-lockfile` before SC |
| 21 | evidence artifact | :145-151 | port | `if: always()`, name `deployment-evidence-staging`, path exactly `deployment-evidence.json`, 90 days |
| 22 | Playwright report artifact | :153-161 | drop | no Playwright step |
| 23 | rollback job | none | add | 4.4 (PR 50 had none) |

### 4.2 Q1 - production (P50P)

| # | Step | P50P | Decision | Reason |
|---|---|---|---|---|
| 1 | header | :1-12 | change | keep "promotion only, no build", the DO NOT RUN gate text and the migration path; drop runbook pointers not on the base |
| 2 | inputs tag, digest, staging_run_id, confirm | :14-32 | change | same four names, `required: false` at the form, validated per job (an empty value fails the regex); add `rollback_deployment_id` |
| 3 | permissions | :34-36 | change | top-level `{}`, per job (4.5) |
| 4 | defaults, concurrency, env | :38-47 | port | `group: deploy-production`, `cancel-in-progress: false` |
| 5 | job header | :49-53 | change | `ubuntu-24.04`; `if: inputs.rollback_deployment_id == ''`; `environment: production`; timeout 45 |
| 6 | validate inputs | :55-65 | port | tag `^[0-9a-f]{40}$`; digest `^sha256:[0-9a-f]{64}$`; staging_run_id `^[0-9]+$`; typed confirmation: `confirm` must equal `tag` exactly |
| 7 | checkout `ref: inputs.tag` | :67-71 | port | spec and scripts from the built commit; `persist-credentials: false`; runs AFTER step 6 and no checked-out script runs before step 8 |
| 8 | staging-run check | :73-89 | port | the run is `.github/workflows/deploy-staging.yml`, `conclusion == success`, `head_sha == tag`; then `gh run download <id> -n deployment-evidence-staging` and `image_digest == digest and git_sha == tag`. A rollback run of the staging workflow uploads `rollback-evidence-staging` only, so it can never satisfy this step |
| 9 | action-doctl | :91-93 | port | after step 8 |
| 10 | DOCR digest and tag check | :95-102 | port | `doctl registry repository list-manifests plexco` |
| 11 | render | :104-113 | change | APP_DOMAIN already at :109; refuse a domain other than `^plexco\.app$` (Q4 default plexco.app) |
| 12 | update, wait, smoke | :115-129 | port + change | SC after the same host-equals-APP_DOMAIN check with `vars.PRODUCTION_BASE_URL` |
| 13 | evidence | :131-142 | port | `environment, git_sha, image_digest, promoted_from_staging_run, deployed_at, run_url, triggered_by` |
| 14 | artifact | :144-148 | port | `deployment-evidence-production`, 365 days |
| 15 | rollback job | none | add | 4.4 |

### 4.3 Q2 - where `provision` runs: ruled by RO-L67-2 (B-1 closed)

- Ruling RO-L67-2 (the conductor, 2026-10-30, Tier B, reversible; "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature"): option B of RQ-L67-1. Provision runs inside the existing `migrate` PRE_DEPLOY job, after the migrations, in the same shell: under `set -eu` a failed migration exits first, and a failed PRE_DEPLOY job blocks the deployment. Lane L82 `p5-migrate-job-provision` (session P5-S11a) makes the EP change, outside L67 and with no shared file. L67 edits neither SS nor SP. L82 merges before the first real `workflow_dispatch`; L69 starts after L67 and L82 merge.
- Required order (ES :431-435, T0): 1 validate the PostgreSQL version and roles; 2 migrations with `DATABASE_URL_MIGRATION`; 3 EP `provision` "using the same job-scoped credential"; 4 deploy; 5 health and smoke. Rule (:437-438): no runtime command that injects the DDL credential into all components. A runner cannot reach the private DB (P50S :17-21).
- Provision depends on migrations: its grants name `app_worker` (PQ :42-53), which M0 :25-26 creates; EP orders it after migrate and before the worker (EP :68-85). It is idempotent (PQ :15).
- Official reference (accessed 2026-10-30): the order of several jobs of one kind is NOT stated. https://docs.digitalocean.com/products/app-platform/reference/app-spec/ (#yaml-file-structure): `PRE_DEPLOY` "Indicates a job that runs before an app deployment."; `POST_DEPLOY` "Indicates a job that runs after an app deployment."; `jobs` is an array with no ordering text. https://docs.digitalocean.com/products/app-platform/how-to/manage-jobs/: no ordering text for jobs of the same kind. https://docs.digitalocean.com/products/app-platform/getting-started/migrate-from-heroku/ ("Add a Pre-Deploy Job (Release Phase)"): "This ensures the job runs before each deploy and blocks deployment if it fails".
- Consequence (before the ruling): a second PRE_DEPLOY job per spec depends on an order the reference does not state; RQ-L67-1 holds the options and the evidence. The two workflow files are identical under every option, because they only call `doctl apps update` and WD.
- Current behaviour pinned: no `provision` component in either spec (L66R :284); until L82 merges, the `migrate` PRE_DEPLOY job runs the migrations only.

### 4.4 Q3 - rollback (default applied, pending owner sign-off; B-2 closed)

- Official reference (accessed 2026-10-30), https://docs.digitalocean.com/products/app-platform/how-to/manage-deployments/: "#roll-back-to-a-previous-deployment": "Rolling back an app restores the app's code, configuration, and app spec, but does not affect database data."; "You can roll back to any of the ten most recent successful deployments."; the target must "use the same database resources and configuration". "#roll-back-a-deployment-using-the-control-panel": "The new deployment duplicates the old one, preserving both the code and configuration from the selected deployment." "#rollback-a-deployment-curl": "Send a POST request to `https://api.digitalocean.com/v2/apps/{app_id}/rollback`." with a JSON body key `deployment_id`. https://docs.digitalocean.com/reference/doctl/reference/apps/ lists 27 `doctl apps` subcommands and none for rollback; `doctl apps get-deployment` is "Get a deployment".
- Official, R1 (accessed 2026-10-30), DigitalOcean's SDK reference, whose links name the API anchors `#apps_create_rollback`, `#apps_validate_rollback`, `#apps_commit_rollback` and `#apps_revert_rollback`: https://docs.digitalocean.com/reference/pydo/reference/apps/create_rollback/ "A new deployment will be created to perform the rollback."; "The app will be pinned to the rollback deployment preventing any new deployments from being created,"; "To resume deployments, the rollback must be either committed or reverted."; body field `skip_pin` (boolean) "If true, the rollback will be immediately committed and the app will remain unpinned." `.../commit_rollback/` (`/v2/apps/{app_id}/rollback/commit`): "This action permanently applies the rollback and unpins the app to resume new deployments."; revert (`/rollback/revert`) and validate (`/rollback/validate`) sit under the same prefix.
- Not stated on a reachable official page: the HTTP method of validate, commit and revert (the SDK pages show paths only); the "Required scopes" of the rollback and deployment operations (their anchors lie past the end of the API reference text the fetch tool returns, which stops inside "Update an App"): K6; whether a rollback re-runs PRE_DEPLOY jobs (validate says only "if a component must be rebuilt as part of the rollback"): K5; a deployment id format (the reference's `active_deployment.id` example `b6bdf840-2854-4f87-a36c-5f231c617c84` and the manage-deployments curl example are UUID-shaped, and R1's regex follows them); the phase enum (the reachable reference shows only "Example: `ACTIVE`").
- R1 amendment (Tier B, reversible; default applied, pending owner sign-off): R5 sends `"skip_pin": true`, because the default pins the app and blocks every later deploy until a commit or revert whose HTTP method is not stated; validate, commit and revert stay unused. R4 tests no phase: eligibility ("ten most recent successful", same database) is the platform's rule, a refused POST fails `curl -f`, a rollback that never becomes active fails WD, and SC checks the origin.
- Design: ONE `rollback` job in each workflow, `if: inputs.rollback_deployment_id != ''`, the same `environment:` and concurrency group as the deploy job, `runs-on: ubuntu-24.04`. Steps: (R1) refuse unless `rollback_deployment_id` matches `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` and `confirm` equals it exactly (never "latest", never a default); (R2) checkout (CI :47 pin, `persist-credentials: false`); (R3) action-doctl; (R4) `doctl apps get-deployment "$APP_ID" "$DEPLOYMENT_ID" -o json`: exactly one deployment, whose id differs from the app's `active_deployment.id` (`doctl apps get "$APP_ID" -o json`), and its `web` image digest matches `^sha256:[0-9a-f]{64}$` (WD :4 defines identity by that digest); (R5) `curl -fsS -o /dev/null -X POST` the documented endpoint with `Authorization: Bearer` from `DIGITALOCEAN_ACCESS_TOKEN` in this step's env only and body `{"deployment_id": ..., "skip_pin": true}`; (R6) WD with the target's digest, 1500; (R7) SC as in the deploy job; (R8) `rollback-evidence.json` = `environment, action, target_deployment_id, image_digest, run_url, triggered_by, at`, artifact `rollback-evidence-<env>`, `if: always()`. Fallback: the owner's Control Panel rollback (Activity tab, quoted above).
- Writer check before R6 (read-only): WD's body must select the NEWEST deployment carrying the digest, because the rollback target carries the same digest. If WD cannot tell them apart, that is a ruling request (WD is not L67's).
- Migrations: no down-migration exists (section 2). A rollback is app-only: the schema stays at the newer version, so a rollback is safe only across expand-only migrations; database data comes back only from a Managed Databases backup (same page: "To roll back database data, restore it from a backup"), an owner action.

### 4.5 Q4 - token and permission scope (B-3 closed)

- `permissions: {}` at the top of both files; per job: staging deploy `contents: read`, `checks: read` (P50S :26-28, check-runs API); production deploy `contents: read`, `actions: read` (P50P :34-36, run API and artifact download); both rollback jobs `contents: read`.
- `GH_TOKEN: ${{ github.token }}` only on the two `gh` steps (P50S :60, P50P :75). Every checkout `persist-credentials: false`.
- `environment: staging` / `environment: production` on every job (deploy and rollback). The owner sets `DO_APP_ID`, `DO_VPC_ID`, `APP_DOMAIN` and the base URL as ENVIRONMENT variables and `DIGITALOCEAN_ACCESS_TOKEN` as an environment secret, per environment (owner steps 8.5, 8.6). A cross-environment mix-up fails closed twice: RS refuses a live app whose `.name` differs (RS :58) and the domain guards (4.1 #16, 4.2 #11) refuse the other domain; the rollback job's R4 refuses a live app whose spec name differs from the committed spec's (review fix RV1-1).
- Concurrency: one group per workflow, `cancel-in-progress: false` (CI's `cancel-in-progress: true`, CI :20-22, is for CI only).
- No secret in logs: no `set -x`; no `echo` of a secret; never print or upload `live-spec.json` or `rendered-spec.json` (P50S :109); RS prints names only (RS :22-24); curl output goes to `/dev/null`.
- DigitalOcean token (the owner creates it), official (accessed 2026-10-30), https://docs.digitalocean.com/reference/api/reference/apps/: "Each endpoint below specifies which scope is required to access it when using custom scopes."; Retrieve an Existing App "Required scopes: app:read"; Update an App "Required scopes: app:update". R1, https://docs.digitalocean.com/reference/api/reference/container-registry/: "GET Get Docker Credentials for Container Registry" "Required scopes: registry:read registry:update"; "GET List All Container Registry Repository Manifests" "Required scopes: registry:read". Minimum, one custom-scoped token per environment: staging `app:read`, `app:update`, `registry:read`, `registry:update` (login, push); production `app:read`, `app:update`, `registry:read` (list-manifests). Deployment and rollback scopes: not stated on a reachable page (K6).
- GitHub, R1 (accessed 2026-10-30), https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax: `permissions` "If you specify the access for any of these permissions, all of those that are not specified are set to `none`."; `jobs.<job_id>.permissions` "For a specific job, you can use `jobs.<job_id>.permissions` to modify the default permissions granted to the `GITHUB_TOKEN`"; `concurrency` "By default, any existing `pending` job or workflow in the same concurrency group will be canceled" and "To also cancel any currently running job or workflow in the same concurrency group, specify `cancel-in-progress: true`." (so `false` never cancels a running deploy; a newer dispatch replaces a pending one); `on.workflow_dispatch.inputs` "This must be one of: `boolean`, `choice`, `number`, `environment` or `string`."; `jobs.<job_id>.environment` "All deployment protection rules must pass before a job referencing the environment is sent to a runner."
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps: `Repository permissions for "Actions"` lists the run, run-artifacts and artifact-download GETs as "read"; `Repository permissions for "Checks"` lists `GET /repos/{owner}/{repo}/commits/{ref}/check-runs` as "read". https://docs.github.com/en/actions/concepts/security/github_token: "The `GITHUB_TOKEN` secret is a GitHub App installation access token." So `checks: read` (staging) and `actions: read` (production) suffice.
- https://docs.github.com/en/actions/reference/workflows-and-actions/variables ("Configuration variable precedence"): "If a variable with the same name exists at multiple levels, the variable at the lowest level takes precedence." https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments: "Secrets stored in an environment are only available to workflow jobs that reference the environment."; "a job cannot access environment secrets until one of the required reviewers approves it."; "Variables stored in an environment are only available to workflow jobs that reference the environment." The domain guards fail closed whichever `APP_DOMAIN` wins.
- https://docs.github.com/en/actions/reference/security/secure-use ("Use an intermediate environment variable"): the value "is stored in memory and used as a variable" and "doesn't interact with the script generation process."; "You should therefore make sure that the `GITHUB_TOKEN` is granted the minimum required permissions." Writer rule: an `inputs`, `vars` or step-output value reaches a script only through `env:` as a double-quoted shell variable; no `${{` inside `run:` (A-2).
- https://github.com/actions/checkout/blob/v7.0.0/README.md (tag v7.0.0): `persist-credentials` "# Whether to configure the token or SSH key with the local git config", "# Default: true"; "Set `persist-credentials: false` to opt-out."

## 5. Acceptance matrix

| ID | Check | Expected |
|---|---|---|
| A-1 | `actionlint` on both files (installed binary, or its official Docker image pinned by version; record which) | 0 findings |
| A-2 | lane check script from a file: no `on.push`, `schedule` or `workflow_run`; `workflow_dispatch` only; every job `runs-on: ubuntu-24.04`; every `uses:` at a 40-hex SHA; `secrets.*` only `DIGITALOCEAN_ACCESS_TOKEN`; no `echo` of a secret; no `${{` inside a `run:` (4.5) | all PASS |
| A-3 | `pnpm format:check` | PASS |
| A-4 | `pnpm review:check:changed` before every commit; `pnpm review:check` at the end | PASS |
| A-5 | `pnpm run test:infra`, only if a spec changes | PASS |
| A-6 | the lane's final-checks.sh: B3, attribution 0, closing keywords 0, porcelain, file list = ownership | PASS |
| A-7 | file-list scope proof (`git diff --name-only <base>..HEAD` within ownership), in place of detect_changes (RO-L66-4 item 3) | PASS |
| A-8 | read check: deploy and rollback `if:` are exact complements; every validation regex of 4.2 #6 and 4.4 R1 present; no step uses the DO token before the input checks | PASS |

## 6. Verification and review

ONE review round (code-reviewer, sonnet); it is the final round (L44 policy): a P3 or lower fix is labelled "fix applied after the final round, not re-reviewed". Then ONE security round (code-reviewer, opus, the lane's one opus unit under P12) on the fixed head; log the reason "deploy surface: token scopes, environment protection, image identity". A P1 or P2, or a workflow-logic change after the security round, is a new RQ and RESULT: AWAIT. CI green on one push; the OWNER merges (deploy guard).

## 7. B3 and files

Plan estimate about 330 changed lines in the 2 workflow files. Expected about 410 (staging about 195, production about 215): an overrun of about 80 lines whose design reason is the rollback job in each file, which PR 50 lacked and the lane GOAL requires. 0 migrations. No spec block: RO-L67-2 withdraws it, so the change is the two workflow files only.

B3 exception (RO-L67-3 ruling 3; accepted as a signal, not a gate; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): the two workflow files pass the 330-line estimate. The design reason is the rollback job of each workflow (PR 50 had none), the staging-run check of production, and `APP_DOMAIN` per environment. The measured numbers are in the PR body.

## 8. Security notes for the security round

1. Image identity: staging deploys the digest build-push returned; production binds the digest to a successful staging run's evidence artifact AND to the DOCR tag (P50P :73-102), because the SHA tag is mutable (P50P :83-86).
2. Order in production: validate inputs, checkout the tag, staging-run check (gh and jq only), and only then the DO token; no checked-out script runs before the check.
3. Token reach: DO token as an environment secret, never in a repository-level secret; `GITHUB_TOKEN` minimal per job; `persist-credentials: false`.
4. Logs and artifacts: only the evidence JSON files are uploaded; no spec file, no token, no `set -x`.
5. Triggers: `workflow_dispatch` only; the environments carry the owner's required reviewers (owner step 8.5).
6. Rollback input: explicit id plus typed confirmation; refused if it is the active deployment; the body carries `skip_pin: true` (4.4), so a rollback never leaves the app pinned.

## 9. Known risk

- K1. Rollback is app-only (no down-migration); a release with a contracting migration cannot be rolled back safely.
- K2. The CI-gate check matches the job names `verify` and `e2e-web` (CI :25, :112) over at most 100 check runs; a renamed job blocks staging (fails closed).
- K3. Runner tools (`yq`, `jq`, `gh`, `curl`, node) on ubuntu-24.04 are not re-checked; a missing `yq` fails at RS :38-40, and any other missing tool exits 127 under the ported bash defaults with pipefail (4.1 row 4) and fails its step (fails closed).
- K4. P50P :81 compares the run's `path` with `.github/workflows/deploy-staging.yml`; its format is not re-checked and a mismatch fails closed.
- K5. Whether a rollback re-runs the target's PRE_DEPLOY jobs is not stated (4.4). If it does, the target image's runner is a no-op on the newer ledger: it walks only its on-disk files (`packages/db/src/migrate.ts` :220, :286), skips each one already in `schema_migrations` with the same sha256 (:241, :296-298, :347-348) and never reads ledger rows for files it lacks (the order guard skips applied files, :93-94); a changed applied file throws (:338) and blocks the rollback (fails closed). Either way the schema stays at the newer version (K1).
- K6. The DO scopes of the deployment and rollback operations are not on a reachable official page (4.4, 4.5). A missing scope fails closed (`doctl` or `curl -f` error), on staging first; only a rollback exercises the rollback path, so L69's runbook should give the owner one staging rollback drill before production use (fallback: the Control Panel rollback, 4.4).
- K7. After a rollback the target and the rollback deployment carry the same digest; the shared wait (WD) takes the first in list order, which no official page states. A wrong pick FAILS CLOSED (a false failure after DigitalOcean accepted the rollback, never a false pass); the operator then checks the app's active deployment; lane L69's runbook carries that check. Ruled option A of RQ-L67-2 (RO-L67-3; Tier B, reversible; decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature): one wait definition, no second wait in a workflow; option C (WD selecting by deployment id or `created_at`) is one backlog row (section 11).

## 10. Open

`OPEN_QUESTIONS_IN_SCOPE: 0`:
- B-1 closed by RO-L67-2 (4.3).
- B-2 closed by R1: every 4.4 item is quoted or marked not stated (K5, K6); the design takes `skip_pin: true` and no phase test (4.4).
- B-3 closed by R1: every 4.5 item is quoted; the deployment and rollback scopes are K6.

## 11. Hard dependencies and backlog rows

- Measured with local git (`git log --merges --grep`): #137 merge `4230c752ec0ddb2a14e2a07714a901c6022e862c` and #150 merge `2d91aea9c99dc5bc71ab932f208929f76de37436` (= the base) are on the base.
- Enablement-only (not a coding dependency): lane L82 `p5-migrate-job-provision` (RO-L67-2) merges before the first real `workflow_dispatch`; L69 starts after L67 and L82 merge. Current behaviour pinned: the two workflows only call `doctl apps update` and WD, so they are correct under option A and option B.
- Backlog: one row at the END of `docs/autopilot-backlog.md` for option C of RQ-L67-2 (`infra/wait-for-deployment.sh` selecting the deployment by id or `created_at`), per RO-L67-3. The provision placement is lane L82 (RO-L67-2), so it needs no row.

## 12. Closure matrix

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | the base; TARGET_FILES exist at the base | PASS |
| 2 | Decisions in scope final | Q1, Q3, Q4 defaults; Q2 ruled by RO-L67-2 (4.3) | PASS |
| 3 | Scope IN/OUT and owner clear | section 1; spec blocks withdrawn by RO-L67-2 | PASS |
| 4 | Dependencies classified | section 11 | PASS |
| 5 | Live schema and code match | section 2 | PASS |
| 6 | Data, API, state, auth contract | names (M :77-95); token and permission facts quoted (4.5) | PASS |
| 7 | Fail-closed, idempotency, order | provision inside the migrate job (RO-L67-2; L82 enablement-only); 4.4 R1-R8 fail closed | PASS |
| 8 | Open questions in scope = 0 | 0 (section 10) | PASS |
| 9 | Acceptance matrix with expected results | section 5 | PASS |
| 10 | Migration, security, rollback | no migration; section 8; rollback facts quoted (4.4); K1, K5, K6 | PASS |
| 11 | First slice hard dependencies merged | section 11 | PASS |
| 12 | Implementation handoff ready | sections 4 to 8 | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-30
AUTHORITY_SHA: 2d91aea9c99dc5bc71ab932f208929f76de37436
BASE_BRANCH: main
TARGET_FILES:
  - infra/app.staging.yaml (read-only)
  - infra/app.prod.yaml (read-only)
  - packages/db/src/migrate.ts (read-only)
  - docs/autopilot-backlog.md (edited only if needed: at most 3 rows at the end)
  - .github/workflows/ci.yml (read-only)
  - infra/render-app-spec.sh (read-only)
  - infra/wait-for-deployment.sh (read-only)
  - infra/smoke-check.sh (read-only)
  - infra/entrypoint.sh (read-only)
  - apps/bot/src/provision-queue.ts (read-only)
  - packages/db/migrations/0000_roles_extensions.sql (read-only)
  - docs/runbooks/env-manifest-staging-production.md (read-only)
  - docs/standards/environments-setup.md (read-only)
  - docs/sessions/web-mvp-phase5-readiness-p5-app-specs.md (read-only)
  - docs/sessions/web-mvp-phase5-golive-plan.md (read-only)
SCOPE: .github/workflows/deploy-staging.yml (new); .github/workflows/deploy-production.yml (new)
SLICE: p5-deploy-workflows
IN_SCOPE: the two new workflow files; at most 3 backlog rows at the end; this readiness file
OUT_OF_SCOPE: gh workflow run, doctl, any cloud CLI, console, login or deploy; any secret or variable value; push, tag, schedule or workflow_run triggers; the renderer, wait and smoke scripts, the entrypoint, the Dockerfile and ci.yml; the two app specs (RO-L67-2); runbooks (L69); a Fly variant; PR 50 and its branch
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:owner steps 8.5 and 8.6 (environments, protection rules, secret and variable values, the first run); L82 merged before the first real workflow_dispatch
HARD_DEPENDENCIES: #137 and #150 merged (measured on the base)
PRIOR_SLICES: #137 (L65, the renderer, wait and smoke scripts); #150 (L66, the two specs)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: owner steps 8.5 and 8.6; L82 p5-migrate-job-provision (RO-L67-2) merged before the first real workflow_dispatch
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; rollback and token facts quoted (4.4, 4.5); K5, K6; one security round (opus) on section 8
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - write .github/workflows/deploy-staging.yml and .github/workflows/deploy-production.yml from 4.1 to 4.5, run A-1 to A-8, commit in the worktree
REMAINING_BLOCKERS: none
```
