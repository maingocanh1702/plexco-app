<!-- review-readiness: code-ready -->

# Step-0 readiness: L66 p5-app-specs (session P5-S2a)

> Agent-facing. Step 0 measured by the step-0 readiness reader R0b (opus); Q4 by unit R0a (notes outside the repo, cited by fact id F1-F43; R0a's own status is PARTIAL). RISK: P1 config with a security round. Base `be955cf68dd51f6da6024d270585d180d758956d` = origin/main = worktree HEAD (measured); branch `feat/p5-app-specs`; worktree `.autopilot/worktrees/p5-app-specs`. PR #50 source: ref `origin/feat/mvp-m5-staging` at `f3ceab77cf450c933bdb63b1ed940d604cdd7fb7` (measured), merge base with main `818edf4f17127614d34c33350f673199bbaa372b` (measured); read only with `git show`. STATUS: COMPLETE (R0c closed B-8, the last open item). History: R0b stopped reading on the lane orchestrator's context notice; the unread inputs are blockers B-1 to B-7 (section 10) and the numbered list in the session notes `step0-R0b-handoff.md`. Unit R0b-2 (opus) closed B-1 to B-3; unit R0b-3 (opus) read B-4 in part and stopped on the lane orchestrator's stop notice; unit R0b-4 (opus) closed the B-4 residual and B-5 to B-7 and opened B-8, two App Platform facts for a Q4 unit (section 10). Unit R0c (opus) closed B-8 from the official reference (2.4 F44-F47, D13, T-N8).

Short forms: P50S / P50P = PR 50's `infra/app.staging.yaml` / `infra/app.prod.yaml` (line numbers of `git show`); M = `docs/runbooks/env-manifest-staging-production.md`; ES = `docs/standards/environments-setup.md`; RS = `infra/render-app-spec.sh`; RT = `infra/render-app-spec.test.mjs`; EP = `infra/entrypoint.sh`; DF = `infra/Dockerfile`; RP = `apps/web/lib/request-policy.ts`; DRS = `apps/web/lib/discovery-route-support.ts`; DC = `apps/web/lib/discovery-cursor.ts`; MS = `docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md`; PL = `docs/sessions/web-mvp-phase5-golive-plan.md`; L65R = `docs/sessions/web-mvp-phase5-readiness-p5-staging-tooling-port.md`. Every `path:line` was measured at the base unless it says "per M" (L64's measurement at its own base, quoted in M) or "per L65R".

## 1. Authority

- The lane block of L66 (session notes, outside the repo): owner approval of 2026-10-28 of PL (DD-154): PL row L66, Q1 default (config FILES only, never a console, `doctl`, a resource, a deploy or a secret value), Q2 default (fresh lane ports PR 50's valid parts), Q3 override (production shape 3, no HA), Q4 default (plexco.app), Q7 default; the owner's decision of 2026-10-30 11:10 (DD-156): "continue with L66, L67, L69" once G1 passes. Every other choice is "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" or "default applied, pending owner sign-off". R0b-3 quoted the DD-154 (decisions.md:122, :1846-1894), DD-155 (:121) and DD-156 (:120, :1787-1807) bodies at the base (B-4).
- G1 passed on the base: ES:74 holds the marker `<!-- DD04_EGRESS_EVIDENCE_CLOSED -->`; ES:85 "Gate status (first launch, 2026-10-30): `Overall result: DO_VPC_COMPATIBLE`". ES:89-91 adds that the result "does not by itself authorize the infra slice or any provisioning": the authorization of this lane is the owner's DD-156 decision above. ES:112 "Until the gate closes, do not create the App Spec and do not disable the private DB path silently." is satisfied for the first clause; the second binds the content (section 8).
- Scope (lane block FILE OWNERSHIP, as-is): `infra/app.staging.yaml` and `infra/app.prod.yaml` (new); RT (new cases only, existing cases unchanged); ES (the row-22 hunk only, never §1.1's rows or status); this file; at most 3 new rows at the END of `docs/autopilot-backlog.md`. Nothing else.
- Negative scope (as-is): no doctl (including `doctl apps spec validate`), no `gh workflow run`, no cloud CLI, console, account, login or deploy; no workflow (L67), no runbook (L69, L70), no Dockerfile, entrypoint or fly.toml change, no RS change, no §1.1 edit; never a secret value; never disable or bypass the private DB path; no Fly variant; never touch PR 50 or its branch.

## 2. Measured at base

### 2.1 Q1: per component, port / change / drop

PR 50 holds no secret value: every SECRET entry in P50S and P50P is a key with `type: SECRET` and no `value` (masked read; zero VALUE_PRESENT hits).

| Part of P50S/P50P | Ports as-is | Changes to fit main | Goes |
|---|---|---|---|
| App level | `name` (plexco-staging / plexco-prod, P50S:19, P50P diff), `region: sgp` (P50S:20; F1, F23), `vpc.id: __VPC_ID__` (P50S:22-23; F2), app alerts DEPLOYMENT_FAILED and DOMAIN_FAILED (P50S:40-42; F4), ingress `/` to web (P50S:34-38; F6) | staging gains `domains:` with the domain placeholder (lead (5): staging host = a subdomain of plexco.app whose first label starts with "staging", guard `apps/web/e2e/support/staging-golden-path-guard.ts:9-12`); ingress comment rewritten (C6) | none |
| Header | none | rewritten with the current gate list (2.5) | SePay/ApiPay gate names (C14); pointers to unmerged runbooks (C13) |
| `migrate` job | `kind: PRE_DEPLOY` (P50S:52; F18: UNSPECIFIED would auto-complete to POST_DEPLOY), `instance_count: 1`, `instance_size_slug: apps-s-1vcpu-1gb` (P50S:57; F35), image DOCR + `repository: plexco` + `digest` placeholder (P50S:53-56; F9: registry empty for DOCR, digest XOR tag), `PROCESS_ROLE: migrate`, `DATABASE_URL_MIGRATION` SECRET (P50S:60-65; M:75; EP:78-85) | YAML anchor `&image` expanded (D4); comment corrected (C7, C8) | the claim "pg-boss/queue provisioning" (C7) |
| `web` service | `http_port: 3000` (P50S:70; EP:56 comment "port 3000", DF:73 `EXPOSE 3000`, DF:82 fallback `process.env.PORT \|\| 3000`), size `apps-s-1vcpu-1gb`, `health_check` `/healthz` 20/10/3/6 (P50S:73-78; within F15 ranges; `apps/web/app/healthz/route.ts:5-7` answers 200 with no DB), alerts CPU/MEM/RESTART_COUNT (P50S:80-82; F5); env PROCESS_ROLE, TRUSTED_INGRESS_PROVIDER, CSP_SCRIPT_NONCE_ENABLED "false", DB_EXPECTED_ROLE app, DATABASE_URL, GOOGLE_OAUTH_CLIENT_ID/SECRET, KMS_PROVIDER, KMS_KEY_ID, AWS_REGION, AWS_ACCESS_KEY_ID/SECRET, KMS_ENCRYPTED_AUTH_PEPPER, LINK_CODE_LOOKUP_HMAC_KEY | count: staging 1 -> 2, production 2 -> 1 (2.2); APP_BASE_URL: staging `${APP_URL}` (P50S:92, a bindable R0a did not verify) -> `https://__APP_DOMAIN__` like P50P (D14); DATABASE_URL comment "pooled (transaction-mode)" (P50S:96) -> session-mode pool per R1 (M:134; C9); adds DISCOVERY_DATABASE_URL (M:39), DISCOVERY_CURSOR_KEY (M:38), KMS_ENCRYPTED_CONNECTOR_PEPPER (M:46; D7), GENDER_COLLECTION_ENABLED "false" (M:42, M:103) | NODE_ENV (M:51: set by the image, DF:44, "do not override"), LOG_LEVEL (M:50 owner-decided; absent = "info", `apps/web/lib/log.ts:28`; D6), alert `REQUEST_DURATION_P95_MS` (P50S:83; not in the component rule list F5; D11) |
| `discovery` service (staging only) | http_port, size, health_check, alerts CPU/MEM/RESTART_COUNT (P50S:113-127); PROCESS_ROLE discovery, TRUSTED_INGRESS_PROVIDER, DB_EXPECTED_ROLE readonly (P50S:129-133) | count 1 -> 2 (2.2); adds DISCOVERY_DATABASE_URL (readonly) and DISCOVERY_CURSOR_KEY (M:38-39), CSP_SCRIPT_NONCE_ENABLED "false" (M:34, component W, D) | DATABASE_URL (P50S:135; M:35 and D-2 at M:126: discovery does not read it; D12), NODE_ENV, LOG_LEVEL; in production the whole component goes (shape 3) |
| `worker` | `workers` kind, size `apps-s-1vcpu-1gb-fixed`, count 1 (P50S:137-141; F35, F39: fixed = one instance only), alerts CPU/MEM/RESTART_COUNT, PROCESS_ROLE worker, OUTBOX_DISPATCH_SCHEDULE_ENABLED "false", DATABASE_URL_DIRECT (app_worker) (P50S:142-153; M:36) | OUTBOX comment rewritten (it predates DD-141 and migration 0056; M:52: only "true" enables, enabling is the owner's P0 step, `docs/runbooks/outbox-dispatch-enable-rollback.md`); adds APP_BASE_URL (M:32), KMS_PROVIDER (M:48), AWS_REGION (M:33), KMS_KEY_ID (M:47; D8), KMS_ENCRYPTED_CONNECTOR_PEPPER (M:46; D7), AWS_ACCESS_KEY_ID/SECRET (M:67, R2) | NODE_ENV (M:51 "K does not read"), LOG_LEVEL (M:50: components W, D only) |

The inventory's missing names (MS:65): DISCOVERY_DATABASE_URL, DISCOVERY_CURSOR_KEY, KMS_ENCRYPTED_CONNECTOR_PEPPER and GENDER_COLLECTION_ENABLED are added; ZALO_BOT_API_BASE is NOT added (C1).

### 2.2 Q2: topology per environment

Measured on main:
- RP:41-44 `parseProcessRole`: any value other than `discovery` or `worker` is `"web"`. RP:47-48 `pathAllowedForRole`: `if (role !== "discovery") return true;`. RP:57-63 `requestAllowedForRole`: the same early return at RP:62. So a process with PROCESS_ROLE=web serves every path, including the discovery allowlist RP:32-39 (`/healthz`, `/discover(/|$)`, `/api/discover`, `/api/discover/<x>`, `/api/discover/share/<x>`, `/session/<x>`).
- It then needs DISCOVERY_DATABASE_URL: DRS:47 reads it; DRS:48 throws "DISCOVERY_DATABASE_URL is not set: refusing to serve discovery"; DRS:62-64 refuses unless `current_user` and `session_user` are both `readonly`; DRS:36-40: a missing URL poisons the handle and the route answers 500 (fail closed). DRS:50: a separate pool, `max: 5`.
- And DISCOVERY_CURSOR_KEY: DC:24 reads it; DC:26-27 refuses a short value; DC:31-32 throws "DISCOVERY_CURSOR_KEY is required in production" when unset and `NODE_ENV === "production"`, which the image sets (DF:44).

User effect of production shape 3 (DD-154 (a) calls it unmeasured). Measured mechanism, not measured magnitude (no load test is in scope):
1. One `web` container (1 shared vCPU, 1 GiB, F35) serves the app, the API, SSE and the discovery surface; a discovery burst competes for the same CPU and memory.
2. Discovery keeps its own `readonly` pool (DRS:46-50, max 5) and its role assert (DRS:62-64): the DB role isolation of discovery stays; the separate process and failure domain of the discovery component does not exist in production, and RP's edge gate (GET/HEAD on the allowlist only, RP:52-63) does not apply because the role is web.
3. One instance: a deploy or restart of `web` interrupts both surfaces (§7.6 item 5, two instances and rolling deploy, is deferred with sign-off 8.9 per the lane block, DD-154 (e), PL:265; not re-read, B-4).
4. Both pools reach one single-node PostgreSQL (PL:140 per R0a Q4.3).

Staging shape-4 window: web x2, discovery x2, worker x1; production: web x1, worker x1, no discovery. Measured in M:20-22 (E2), which cites PL:138-141 and DD-154; PL:138, :139 and :141 re-read at the base by R0b-4, and RUN:124 selects shape 4 for G2 and G3 (C21, D1). instance_count 2 needs a size with Manual Scaling "Yes": `apps-s-1vcpu-1gb` is the smallest (F35, R0a Q4.4).

### 2.3 Q3: the renderer contract on main (read at the base, B-1 closed)

RS is 99 lines, RT 242 lines at the base (`wc -l`).
- Input formats: RS:2 "Render a committed App Spec (JSON form)"; RS:4-6 usage `yq -o=json infra/app.staging.yaml | IMAGE_DIGEST=... VPC_ID=... [APP_DOMAIN=...] infra/render-app-spec.sh <live-spec.json>`. The committed spec reaches RS as exactly one JSON document on stdin (RS:19, :56); the live spec is a JSON file argument, "`doctl apps spec get <app-id> --format json`" (RS:8, :27). RS reads no YAML: the YAML files are the committed source and the conversion is the caller's (the owner: `yq`, RS:4; the new tests: 2.7, B-2).
- Placeholders: exactly `__IMAGE_DIGEST__`, `__VPC_ID__`, `__APP_DOMAIN__` (RS:9, :76-77). `IMAGE_DIGEST` required, `^sha256:[0-9a-f]{64}$` (RS:28, :32); `VPC_ID` required, lower-case UUID (RS:29, :33); `APP_DOMAIN` optional, hostname form (RS:30, :34-35). An empty APP_DOMAIN leaves `__APP_DOMAIN__` unsubstituted (RS:77) and any token left matching `__[A-Z_]+__` fails "render: unresolved placeholder" (RS:79-80). Both specs carry `__APP_DOMAIN__` (domains, APP_BASE_URL), so APP_DOMAIN is in effect required for both: fail closed (D14).
- Types: every env on every surface is GENERAL or SECRET in any case, else "render: env type must be GENERAL or SECRET" (RS:68-70); an explicit `type: GENERAL` passes. A committed SECRET with a value fails "render: committed SECRET carries a value: <key>" (RS:71): RS enforces "no committed value" itself (correction C16).
- Secret names RS copies: none hard-coded. Every committed SECRET on services, workers and jobs takes its value from the live spec's same `<kind>/<component>/<key>` (RS:45-48, :84-89); a live SECRET the committed spec does not name is left out (RS:16-17). The one named key is the guard: `DATABASE_URL_MIGRATION` anywhere but a PRE_DEPLOY job's envs fails (RS:59-65).
- How it fails (stderr names a key or field, never a value; jq's own text is withheld, RS:22-23, :99): IMAGE_DIGEST or VPC_ID unset (RS:28-29) or malformed, APP_DOMAIN not a hostname (RS:32-35); empty stdin (RS:39-40); not exactly one document (RS:56); no name (RS:57); live `.name` differs (RS:58); a list field not an array (RS:52); the migration guard (RS:63-65); type and committed-value checks (RS:70-71); unresolved placeholder (RS:79-80); "render: missing secret in live app: <kind>/<name>/<key> - set it in DO first" (RS:86); a live value not `EV[...]` (RS:87-88); a GENERAL over a live SECRET (RS:90); an unfilled SECRET on another surface (RS:96-97). RS has no port logic.
- Tooling: "Needs: bash 3.2+, jq" (RS:24); RT:1 "needs bash + jq, both on CI runners". CI runs RT: ci.yml:106 `pnpm -w test` -> package.json:11 `test` (contains `pnpm run test:infra`) -> package.json:12 `node --test infra/render-app-spec.test.mjs`; node 22 (ci.yml:61-63).
- RT at the base: 7 cases (RT:67, :89, :121, :141, :161, :193, :231). Helpers: `render(spec, liveSpec, env = {})` (RT:38-51: spawnSync `bash RS <live.json>` with `input: JSON.stringify(spec)`, a per-call TMPDIR removed afterwards, env PATH + `IMAGE_DIGEST: DIGEST` + `VPC_ID: VPC`, overridable by `env`); `variant(base, change)` (RT:54-58, deep copy plus one change); `assertRefused(r, message, label)` (RT:61-65: non-zero exit, stderr matches, stdout ""). Fake data: `DIGEST` = `sha256:` + 64 `a` (RT:12); `VPC` = `11111111-2222-4333-8444-555555555555` (RT:13); fake ciphertext `EV[1:<label>]` (RT:30-33). RT's fixtures are JS objects (RT:15-34); RT holds no YAML and no converter.

### 2.4 Q4: the official reference (R0a)

Used: F1 region; F2 `vpc.id` only; F3 domains PRIMARY; F4 app alerts; F5 component alerts CPU_UTILIZATION, MEM_UTILIZATION, RESTART_COUNT only; F6 ingress prefix rules; F9 image digest; F10 and F36 (default slug `basic-xxs` is legacy: set slugs explicitly); F11 instance_count; F12 http_port; F14, F15 readiness health check; F17 workers have no `health_check`, `http_port` or `internal_ports`; F18 job kinds; F21, F22 env scope/type, SECRET encrypted on first submission; F25 trusted sources need the app's VPC egress private IP; F35, F39 slugs and prices; F37 jobs billed when run. Shape 3 against PL:140 (R0a Q4.3): web `apps-s-1vcpu-1gb` 12.00 + worker `apps-s-1vcpu-1gb-fixed` 10.00 + PG single node 2 GiB 30.45 = 52.45 USD per month, equal to the plan. Worker health on App Platform: no readiness check exists for workers (F17); a liveness check needs a listening port (F33); the worker has no HTTP listener (EP:4), so the worker spec carries no health-check key (D10).

R0c (B-8; official pages fetched raw and grepped, no search summary used; quotes verbatim, HTML `<code>` shown as backticks; accessed 2026-10-30):
- F44. https://docs.digitalocean.com/products/app-platform/reference/app-spec/ , section "YAML File Structure" (#yaml-file-structure), field `ingress` > `rules` > `component` > `preserve_path_prefix`: "Boolean. An optional flag to preserve the path that is forwarded to the backend service. By default, the HTTP request path will be trimmed from the left when forwarded to the component. For example, a component with `path=/api` will have requests to `/api/list` trimmed to `/list`. If this value is `true`, the path will remain `/api/list`. Note: this is not applicable for Functions Components and is mutually exclusive with `rewrite`." The sibling field `component` > `rewrite` ends: "Note: this is mutually exclusive with `preserve_path_prefix`." The legacy `services` > `routes` > `preserve_path_prefix` reads "Boolean. (Deprecated) An optional flag to preserve the path that is forwarded to the backend service." with the same default sentence. Reading: an `ingress.rules[]` rule trims its matched prefix by default; the key that keeps the full path is that rule's `component.preserve_path_prefix: true`; the page prints no `Default:` value for the key, only the default behavior.
- F45. Same page, section "Example App Spec" (#example-app-spec): the official working example's second rule is `component` with `name: website` and `match` > `path` with `prefix: /`, and no `preserve_path_prefix` key. The page does not say how a `/` prefix is trimmed.
- F46. Same page, section "YAML File Structure", field `services` > `http_port`: "Integer. The internal port on which this service’s run command will listen. Default: 8080 If there is not an environment variable with the name `PORT`, one will be automatically added with its value set to the value of this field." Field `services` > `health_check` > `port`: "If not set, the health check will be performed on the component’s http_port."
- F47. https://docs.digitalocean.com/products/app-platform/how-to/manage-services/ , section "Configure Component Settings" (#configure-component-settings): "Full HTTP request path preservation for services is not available in the Control Panel. Instead, set the `preserve_path_prefix` annotation in the App Spec to `true`." and "The service must bind to and expose the HTTP port on the network interface `0.0.0.0`, rather than on the localhost (`localhost`) or loopback interface (`127.0.0.1`)."
- Also opened, no fact used: https://docs.digitalocean.com/products/app-platform/how-to/url-rewrites/ . Not re-checked by R0c: the manage-internal-routing page (not needed, row below).

R0a's PARTIAL items, carried:

| R0a item | In-scope-blocking? | Reason (does it change what the two spec files contain?) |
|---|---|---|
| Open 1: does a failed PRE_DEPLOY job block the deploy | no | `kind: PRE_DEPLOY` is written either way; only P50S:44-46's comment claim changes: not ported as fact (C8) |
| Open 2: default `scope` and `type` of an env entry | no | every entry writes both explicitly (D15); RS's acceptance of an explicit `type: GENERAL` is confirmed by B-1 |
| Open 3: `EV[...]` form; SECRET submitted with no value | no | the committed specs carry no value by design; first creation is the owner's step (8.5, L69); the fake EV form for tests comes from RT (B-1) |
| Open 4: which component kinds get VPC egress | no | the only VPC field is app-level `vpc.id` (F2); content identical; runtime risk K3 |
| Open 5: PG slugs, storage, PGD vs PGW price | no | no spec field carries a PG size; cost belongs to step 8.1 |
| Open 6: is legacy `basic-xxs` still accepted | no | every component sets an explicit current slug |
| Open 7: does a readiness failure roll back | no | `health_check` is written either way; risk K2 |
| Not re-checked: manage-internal-routing page | no | staging discovery stays a public service routed by ingress prefix (D13); no internal-only service |
| Not re-checked: heroku-migration and health-check-failure pages | no | same as Open 1 and Open 7 (comment wording only) |
| Not re-checked: manage-databases page | no (B-3 closed, S3) | the specs carry no `databases:` component: one `db_user` per component (F19) and no pool bindable (F20, F27) cannot express four roles and R1's session pool, so the URLs stay component SECRET envs (S3) |
| Not re-checked: raw strings of F23-F43 | no | the two slugs used appear in F35 and also in P50S:57, :140 (two sources agree); the owner's `doctl apps spec validate` catches a wrong slug |

### 2.5 Q5: GENDER_COLLECTION_ENABLED, header gate list, row-22 port

- GENDER_COLLECTION_ENABLED (component web only, M:42): production the literal `"false"` (lane block lead (5): PL:60; M:103 E6: production, the first real-user environment, absent or "false"; enabling a real environment only after the legal answer, step 8.10). Absent means off: `apps/web/app/api/me/profile/route.ts:32` `process.env.GENDER_COLLECTION_ENABLED === "true"`. Staging (M:42 column S: owner decides): `"false"` (D2).
- Header gate list for both specs (each line names its source):
  1. §1.1 fixed outbound-IP gate: CLOSED, `DO_VPC_COMPATIBLE` (ES:85), by owner exceptions DD-155 (Google OAuth token exchange, Google OIDC JWKS, AWS KMS Decrypt) and DD-156 (Zalo Bot API) (ES:85-88). A written Zalo Bot Platform answer that a fixed or registered source IP is required turns the result `FIXED_EGRESS_REQUIRED` and the Q7 fallback (Fly + DO) applies before production (ES:91-94). SePay, ApiPay and Meta Messenger are not first-launch dependencies (ES:80, :81, :83).
  2. DB TLS CA verification: OPEN (backlog `db-tls-ca-verification-do-managed-pg`, heading at :5881; lane L78 conditional). Row body (:5882-:5896, R0b-4): status `idea`, P1, `_readiness` NOT_CODE_READY, to be done before production once a DO Managed PG exists to measure the real CA; the code sets no `ssl` and the image carries no DO CA bundle, so today only `sslmode=require`. L66 changes no code or image (negative scope): the gate stays OPEN in both headers.
  3. Owner steps not done: accounts and resources per the Q3 tier (8.1, PL:197); DNS for staging and production per this lane's App Specs, HTTPS checked (8.2, PL:198); DB users for the four roles, per-component connection URLs and secrets entered by NAME (8.5, PL:201); the one pre-pilot sign-off of every applied default (8.9, PL:205); `doctl apps spec validate` (needs DigitalOcean auth).
  4. Defaults pending owner sign-off: R1 (web DATABASE_URL = DigitalOcean pool in session mode, role `app`, M:134), R2 (AWS access keys as component env, M:135), DD-129 (1) (`DATABASE_URL_MIGRATION` on the PRE_DEPLOY job, ratification at 8.9, M:71).
  5. Flags that stay "false" until an owner step: GENDER_COLLECTION_ENABLED (8.10), OUTBOX_DISPATCH_SCHEDULE_ENABLED (P0 runbook, M:52), CSP_SCRIPT_NONCE_ENABLED (after a real `next start` shows 0 CSP violations, M:34).
  6. Production only: shape 3 without HA and without a discovery component (DD-154 (a), decisions.md:1883; DD-04 supplement :248); §7.6 item 5 deferred with sign-off 8.9 (DD-154 (e), :1887; PL:265).
  7. Discovery exposure (Q10, PL:132, DRS line numbers at the plan's baseline): the in-process limiter of `/api/discover*` keeps every process serving it (web and discovery) from being exposed beyond local until O-6's DB limiter replaces it; default (i) = L73's migration, merged before the first staging deploy (8.6) (DD-154 (g), decisions.md:1889). Measured by R0b-4: L73 is on the base (merge #139 `723d967cd5b086b1b8a5c4dd13966daeb3d92aeb` in HEAD's history; the migration tail is `0075_discovery_rate_limit_definer.sql`; DRS:184-185 "The durable limiter `discovery_rate_limit_hit` (0075) counts the key per clock-aligned 60 s window in one table for every process and replica"), so (i) holds before the first staging deploy.
  8. Staging TTL teardown: deferred (PL:268, item 11; backlog `staging-ttl-teardown-automation`, heading :5898, waits for staging's first run); until then the owner deletes staging at the end of the staging window (Q3), sign-off 8.9. ES:176's TTL control per R0b-2 (not re-read). Row body (:5899-:5913, R0b-4): status `idea`, P2, `_readiness` NOT_CODE_READY until staging's first run; teardown is manual, described in `docs/runbooks/staging-deploy.md` (a PR 50 path, C13); :5912 adds that the worker has no liveness probe.
  9. DB trusted sources: the app only, holding the app's VPC egress private IP (F25); an owner step in DigitalOcean, checked by L70 (PL:264, G3).
- Row-22 port: section 2.8.

### 2.6 Spec content tables

Component table. Both environments: `region: sgp`, app-level `vpc: { id: __VPC_ID__ }`, `domains: [{ domain: __APP_DOMAIN__, type: PRIMARY }]`, app alerts DEPLOYMENT_FAILED and DOMAIN_FAILED; image on every component = `registry_type: DOCR`, `repository: plexco`, `digest: __IMAGE_DIGEST__` (no `registry`, no `tag`, no anchor). Placeholder tokens are provisional until B-1 confirms RS's exact tokens.

| Env | Component | Kind | instance_count | instance_size_slug | http_port | health_check | Ingress | VPC |
|---|---|---|---|---|---|---|---|---|
| staging (`plexco-staging`) | migrate | `jobs`, `kind: PRE_DEPLOY` | 1 | `apps-s-1vcpu-1gb` (F35) | none (F18) | none | none | app-level |
| staging | web | `services` | 2 | `apps-s-1vcpu-1gb` (F35, manual scaling yes) | 3000 | `/healthz`, 20/10/3/6 | prefix `/` | app-level |
| staging | discovery | `services` | 2 | `apps-s-1vcpu-1gb` (F35) | 3000 | `/healthz`, 20/10/3/6 (RP:33 allowlists it) | prefix `/discover` (D13) | app-level |
| staging | worker | `workers` | 1 | `apps-s-1vcpu-1gb-fixed` (F35, F39) | none (F17) | none (F17, D10) | none | app-level |
| production (`plexco-prod`) | migrate | `jobs`, `kind: PRE_DEPLOY` | 1 | `apps-s-1vcpu-1gb` (F35) | none | none | none | app-level |
| production | web | `services` | 1 | `apps-s-1vcpu-1gb` (F35; 12.00) | 3000 | `/healthz`, 20/10/3/6 | prefix `/` | app-level |
| production | worker | `workers` | 1 | `apps-s-1vcpu-1gb-fixed` (F35, F39; 10.00) | none | none | none | app-level |

Component alerts: web, discovery and worker each carry CPU_UTILIZATION > 80, MEM_UTILIZATION > 85, RESTART_COUNT > 2, operator GREATER_THAN, window FIVE_MINUTES (P50S:80-82; F5).

Env keys. Every entry writes `scope: RUN_TIME` and an explicit `type` (D15); every SECRET has no `value` key. M = the manifest line; readers "per M" were measured by L64.

web (staging and production identical; 8 GENERAL + 11 SECRET = 19):

| Key | Type | Value (GENERAL only) | Source |
|---|---|---|---|
| PROCESS_ROLE | GENERAL | `web` | M:55; EP:10, :17; RP:41-44 |
| TRUSTED_INGRESS_PROVIDER | GENERAL | `digitalocean` | M:56; `apps/web/lib/session-cookies.ts:380` per M |
| APP_BASE_URL | GENERAL | `https://__APP_DOMAIN__` (D14) | M:32; `apps/web/app/api/auth/google/callback/route.ts:89` per M |
| CSP_SCRIPT_NONCE_ENABLED | GENERAL | `"false"` (D6) | M:34; RP:67-68 |
| DB_EXPECTED_ROLE | GENERAL | `app` | M:37; EP:25, :45-49 |
| GENDER_COLLECTION_ENABLED | GENERAL | `"false"` (production by PL:60; staging D2) | M:42, M:103; `apps/web/app/api/me/profile/route.ts:32` |
| KMS_PROVIDER | GENERAL | `aws-kms` | M:48; `packages/db/src/secret-key-root.ts:26` per M |
| AWS_REGION | GENERAL | `ap-southeast-1` (D9) | M:33; `packages/db/src/secret-key-root.ts:66` per M |
| DATABASE_URL | SECRET | none (role `app`, session-mode pool, R1) | M:35, M:134; `apps/web/lib/session-cookies.ts:57` per M |
| DISCOVERY_DATABASE_URL | SECRET | none (role `readonly`) | M:39; DRS:47-48, :62-64 |
| DISCOVERY_CURSOR_KEY | SECRET | none (one value for every process serving discovery) | M:38; DC:24, :31-32 |
| GOOGLE_OAUTH_CLIENT_ID | SECRET (D5) | none | M:43; callback route :87 per M |
| GOOGLE_OAUTH_CLIENT_SECRET | SECRET | none | M:44; callback route :88 per M |
| KMS_KEY_ID | SECRET (D5, D8) | none (same value as worker) | M:47; `packages/db/src/secret-key-root.ts:76` per M |
| AWS_ACCESS_KEY_ID | SECRET | none | M:67 (R2, M:135; read by the AWS SDK, no repo reader) |
| AWS_SECRET_ACCESS_KEY | SECRET | none | M:67 (R2) |
| KMS_ENCRYPTED_AUTH_PEPPER | SECRET | none | M:45; `packages/db/src/secret-key-root.ts:60` per M |
| KMS_ENCRYPTED_CONNECTOR_PEPPER | SECRET (D7) | none (same value as worker) | M:46; `packages/db/src/connector-crypto.ts:38` per M |
| LINK_CODE_LOOKUP_HMAC_KEY | SECRET | none | M:49; `apps/web/lib/link-code-keys.ts:12` per M |

discovery (staging only; 4 GENERAL + 2 SECRET = 6): PROCESS_ROLE GENERAL `discovery` (M:55; EP:29-32); TRUSTED_INGRESS_PROVIDER GENERAL `digitalocean` (M:56); CSP_SCRIPT_NONCE_ENABLED GENERAL `"false"` (M:34); DB_EXPECTED_ROLE GENERAL `readonly` (M:37; EP:30, :45-49); DISCOVERY_DATABASE_URL SECRET, role `readonly` (M:39; DRS:47-48, :62-64); DISCOVERY_CURSOR_KEY SECRET, the same value as web (M:38; DC:24).

worker (staging and production identical; 5 GENERAL + 5 SECRET = 10): PROCESS_ROLE GENERAL `worker` (M:55; EP:64-67); APP_BASE_URL GENERAL `https://__APP_DOMAIN__` (M:32; `apps/bot/src/projectors/zalo-dm.ts:71` per M); KMS_PROVIDER GENERAL `aws-kms` (M:48); AWS_REGION GENERAL `ap-southeast-1` (M:33; D9); OUTBOX_DISPATCH_SCHEDULE_ENABLED GENERAL `"false"` (M:52; `apps/bot/src/worker.ts:137` per M); DATABASE_URL_DIRECT SECRET, role `app_worker` (M:36; `apps/bot/src/worker.ts:116` per M); KMS_KEY_ID SECRET (M:47; D8); KMS_ENCRYPTED_CONNECTOR_PEPPER SECRET (M:46; D7; with it set the worker needs no KMS_ENCRYPTED_AUTH_PEPPER, M:45); AWS_ACCESS_KEY_ID SECRET and AWS_SECRET_ACCESS_KEY SECRET (M:67, R2).

migrate job (both; 1 GENERAL + 1 SECRET = 2): PROCESS_ROLE GENERAL `migrate` (EP:78-85); DATABASE_URL_MIGRATION SECRET, role `migration` (M:75; `packages/db/src/migrate.ts:415` per M; only on this job, M:71, M:102).

Totals: staging 37 entries (web 19, discovery 6, worker 10, migrate 2); production 31 (web 19, worker 10, migrate 2).

Not entered, with the reason: NODE_ENV (M:51; DF:44 sets it), LOG_LEVEL (M:50; default "info", `apps/web/lib/log.ts:28`), PORT (M:54 owner-decided; http_port 3000 matches EP:56, DF:73, DF:82; the `next start -p` fallback in `apps/web/package.json:8-9` is B-7), ZALO_BOT_API_BASE, WORKER_HEARTBEAT_FILE, WORKER_ID (M:58-60, E7 at M:111), ENCRYPTION_KEY (M:40), DATABASE_URL_LISTEN (M:110), the four Fly-shaped names (M:62-65), the never-set names (M:101-106: PLEXCO_DEV_LOGIN, FLY_PROCESS_GROUP, TURBOPACK, `__NEXT_PRIVATE_ORIGIN`, DATABASE_URL_MIGRATION outside the job).

"Every env key main reads per component": the tables follow M (measured by L64 at its base, re-measured by L64 at a later main). B-5 (R0b-4, names only, non-test files of `apps/web`, `apps/bot/src`, `packages/core/src`, `packages/db/src`): 32 names in `process.env.X` form. Outside M: none at runtime (`CI` only in `apps/web/playwright.config.ts:29`; `X` is comment text at `apps/web/lib/dev-login/gate.ts:43`; `__NEXT_PRIVATE_ORIGIN` is M's never-set row, missed by the token extraction). In M outside E3: DATABASE_URL_MIGRATION (E4, the job) and the test names DATABASE_URL_TEST, E2E_PG_PORT, E2E_PORT, E2E_SKIP_BUILD. E3 names with no `process.env.X` read: KMS_ENCRYPTED_AUTH_PEPPER (by name, `apps/web/lib/auth-secrets.ts:7`), WORKER_HEARTBEAT_FILE and WORKER_ID (an env object, `apps/bot/src/heartbeat.ts:41-48`), the four Fly-shaped names (EP:21; M:62-65), FLY_PROCESS_GROUP, TURBOPACK, NEXT_PRIVATE_ORIGIN; 8 object-pass reads (e.g. `apps/bot/src/worker.ts:38`, `apps/web/next.config.mjs:17`) are outside this grep. No finding changes the tables or T-N3's counts. (The R0b-3 helper cut M's E3 at `-f2`, the `#` column, and found 0 names; R0b-4 used `-f3`: 34.)

### 2.7 Test plan (B-1 and B-2 closed by R0b-2)

New cases in RT, existing cases unchanged:
- T-N1 "renders infra/app.staging.yaml with fake secrets": exit 0; every SECRET of the content table carries its fake EV value; no placeholder token left; DATABASE_URL_MIGRATION only under the migrate job.
- T-N2 "renders infra/app.prod.yaml with fake secrets": the same for production.
- T-N3 "staging spec carries exactly the content-table keys per component": web 19, discovery 6, worker 10, migrate 2; types as in 2.6. The planted mutation of TESTS (drop one SECRET from a spec) fails this case.
- T-N4 "production spec is shape 3": services = [web] with instance_count 1, workers = [worker], no discovery, GENDER_COLLECTION_ENABLED GENERAL "false".
- T-N5 "committed specs carry no value on any SECRET entry": WITHDRAWN by R0b-2: RS:71 already refuses a committed SECRET with a value, so T-N1 and T-N2 cover it (C16).
- T-N6 "a missing live secret fails closed for the staging spec": the fake live spec omits one key (the key `services/discovery/DISCOVERY_CURSOR_KEY`); `assertRefused(r, /render: missing secret in live app: services\/discovery\/DISCOVERY_CURSOR_KEY - set it in DO first/)` (RS:86; RT:61-65: non-zero, stderr names the key only, stdout empty). This is the case that proves a missing secret fails closed.
- Fake secret names = the real key names (names are not secrets); fake ciphertext = the EV form RT's existing fixtures use (B-1).
- YAML to the renderer input (D3; B-2 closed): a strict YAML-subset reader inside RT, used only by the new cases: `readSpec(path)` returns a plain object for the existing `render(spec, live, { APP_DOMAIN })` (RT:38-51). Subset: block mappings and block sequences by two-space indentation, `- ` items, `key: value`, full-line and trailing ` #` comments, plain scalars, double-quoted scalars (JSON.parse of the quoted text). Plain scalars: `^-?[0-9]+$` without a leading zero is a number, `true`/`false` a boolean, anything else a string, except that the reader throws on a plain scalar a YAML parser could type differently (`null`, `~`, `yes`, `no`, `on`, `off`, `y`, `n` in any case, a float, a leading-zero number, a date). It throws, naming the line, on anything outside the subset: anchor `&`, alias `*`, tag `!`, flow `{` or `[`, block scalar `|` or `>`, document marker `---` or `...` (so multi-document), single quote, tab, duplicate key. Candidates weighed (no environment assumption, real-YAML fidelity, size, the 10x test):
  - (a) this reader. No environment assumption beyond RT:1's bash + jq; fidelity limited to the subset, but a construct outside it fails the test instead of being misread; about 50 lines; at ten times the spec surface it still holds or fails loudly, and the upgrade path is a real parser package added by a lane that owns package.json. PICKED.
  - (b) prettier's YAML plugin (3.9.4 installed under `^3.4.2`, package.json:38). `parsers.yaml` is declared as a bare `Parser` (`node_modules/prettier/plugins/yaml.d.ts:3-5`) whose `parse` returns `T` with `T = any` (`node_modules/prettier/index.d.ts:474-475`): its output is not a documented or typed contract, so an in-range update can change the node shape a converter walks; plain scalars still need the hand-written typing of (a). Rejected.
  - (c) spawn Ruby Psych. Full fidelity, a few lines, but Ruby on the GitHub runner cannot be verified here; RT:1 assumes only bash and jq; guaranteeing it needs a ci.yml step (like ci.yml:93's psql install), outside the ownership. Rejected.
  Fidelity outside CI: A-3 (a real YAML parse of both files from a session-notes script, compared with the reader's output); the final real-parser check is the owner's `doctl apps spec validate` (enablement-only).
- T-N7 "the YAML subset reader refuses constructs outside the subset": one small input per construct (anchor, alias, tag, flow map, flow sequence, block scalar, `---`, tab, single quote, duplicate key, plain `yes`); each throws, naming the line.
- T-N8 "every ingress rule keeps the full request path" (D13, B-8; about 15 test lines, R0c): on the rendered staging and production specs of T-N1 and T-N2, staging `ingress.rules` is exactly three rules, as a set {prefix `/discover` -> discovery, prefix `/api/discover` -> discovery, prefix `/` -> web}, production exactly one (prefix `/` -> web); every rule's `component.preserve_path_prefix` is the boolean `true` and no rule has `component.rewrite` (F44). Removing the key from one discovery rule fails this case.
- Fake data: fake ciphertext `EV[1:<kind>-<component>-<key>]` (RT:30-33 form), one distinct value per SECRET entry, built by the test from the committed spec itself; live `.name` = the committed `.name` (RS:58); APP_DOMAIN a fake host (`staging.example.test`, `example.test`; RS:35 form); IMAGE_DIGEST and VPC_ID = RT's DIGEST and VPC (RT:12-13). T-N1 and T-N2 assert each rendered SECRET equals its own fake value (same component and key, RS:84-89).
- (R0b draft, superseded by D3:) YAML to the renderer's input: UNDECIDED (B-2). Measured facts: no `yq` on this Mac, no npm `yaml` package in the worktree's node_modules, Ruby with stdlib Psych and JSON present locally, CI runs actions/setup-node with node 22 on GitHub runners (orchestrator T0); `package.json` and the lockfile are outside the ownership. Candidates: (a) spawn Ruby Psych from RT: Ruby on the CI runner is not provable from the repo, and a converter script file would be a new file outside the ownership; (b) `yq`: absent locally, rejected; (c) committed JSON twins: two sources of truth, rejected; (d) RS reads YAML itself: only if B-1 shows it; (e) a strict YAML-subset reader inside RT, used only by the new cases, failing closed on anything outside the subset, cross-checked once by A-3's real YAML parse: no dependency, runs on CI. Preliminary lean (e) if (d) is false; not a recommendation until B-1 and the precedent grep are measured.

### 2.8 Row-22 port (exact replacement text)

Three hunks; §1.1 (ES:51-113) is not touched.

1. ES:3, replace `> **Version:** v2.2 · 2026-09-03` with `> **Version:** v2.3 · 2026-10-30`.
2. Insert after ES:438 ("credential into all components.") and its following blank line, before the `---` that precedes ES:442 (`## 7. URLs and channel configuration`); the writer confirms with `sed -n '436,443p'` first:

```text
### Implemented by (lane L66, 2026-10-30): files prepared, not applied

| Contract above | File on main | State |
|---|---|---|
| Staging and production App Specs (§3), job-scoped DDL credential (§4, §6) | `infra/app.staging.yaml`, `infra/app.prod.yaml` (PRE_DEPLOY `migrate` job; role `migrate` in `infra/entrypoint.sh`) | PREPARED, NOT APPLIED: no app was created, nothing was deployed, and `doctl apps spec validate` was not run (it needs DigitalOcean auth; owner steps 8.1, 8.2 and 8.5 of the Phase 5 go-live plan) |
| Secret values never in git (§5, §6) | `infra/render-app-spec.sh` and `infra/render-app-spec.test.mjs`; env names per component in `docs/runbooks/env-manifest-staging-production.md` | tested in CI (`test:infra`) with fake names and fake ciphertext only; never run against a live app |

Deviation from this document (default pending owner ratification at step 8.9, DD-129 (1)):

- §5 keeps `DATABASE_URL_MIGRATION` in the protected CI environment or job only. The App Specs carry it as a secret on the PRE_DEPLOY `migrate` job only; it is absent from every runtime component, and the renderer refuses a spec that lists it elsewhere.

Not done and not proven: nothing ran against DigitalOcean. The §1.1 gate is closed as `DO_VPC_COMPATIBLE` by owner exceptions (DD-155, DD-156); a written Zalo Bot Platform answer that requires a fixed source IP reverses it (§1.1, the Q7 fallback). DB TLS CA verification (§4) is not implemented (backlog `db-tls-ca-verification-do-managed-pg`). The deploy workflows, the deploy runbooks, automatic TTL teardown (§9) and the measured RPO/RTO cells do not exist yet.
```

3. Changelog (ES:569 `## Changelog`): a new first data row under the table header:

```text
| 2026-10-30 | v2.3 | Added "Implemented by" under §6 (lane L66): the staging and production App Specs exist as files, PREPARED, NOT APPLIED; no DigitalOcean app, deploy or spec validation ran. No change to §1.1. |
```

Differences from PR 50's hunk (MS:84: its block "claims an implementation that never merged"): the workflows and runbooks rows are dropped (L67, L69, L70 not merged); the backlog slug `infra-ci-order-step1-pg-validation` is dropped (not on main, MS:85); "the §1.1 outbound-IP gate is still open" becomes the closed result of ES:85.

## 3. Lead corrections

- C1. Lead (1) row 3 and MS:65 list ZALO_BOT_API_BASE as missing. M:60 marks it not entered in staging and production; M:111: the code default suffices and another value must be a loopback http origin or the code throws (per M). The lane follows M: not added.
- C2. MS:65 cites `discovery-route-support.ts:42-43`; at base the read is DRS:47 and the refusal DRS:48 (lead (4) already says so). Lead (4)'s ":64 requires a plain readonly role": the check is DRS:62, the throw DRS:64.
- C3. Lead (4) RP:41-48 and :57-63: matches (RP:43 maps to web, RP:48 and RP:62 return true for non-discovery roles).
- C4. Lead (2): every manifest anchor matches (E2 :14, E3 :26, :39, :42, E4 :69, E6 :97, E7 :108, E8 :121, R1 :134, R2 :135).
- C5. P50S:14-18 ("1 web + 1 discovery + 1 worker"; "Production runs 2 web + 2 discovery") is superseded by M:20-22 and DD-154: staging web x2, discovery x2, worker x1; production web x1, worker x1.
- C6. P50S:25-26 says discovery serves "/healthz and /discover*" via `apps/web/middleware.ts`; on main the allowlist is RP:32-39 and also holds `/api/discover`, `/api/discover/<x>`, `/api/discover/share/<x>` and `/session/<x>`.
- C7. P50S:44 says the job does "Migrations + pg-boss/queue provisioning"; role `migrate` runs only `packages/db/src/migrate.ts` (EP:78-85); queue provisioning is role `provision` (EP:68-77), whose place in the deploy order belongs to L63 and L67 (M:24).
- C8. P50S:45-46 ("a non-zero exit fails the whole deployment (the previous deployment keeps serving)") is not stated on the official pages read (R0a Open 1): not ported as fact.
- C9. P50S:96 calls the web URL "pooled (transaction-mode)"; R1 (M:134) defaults to a session-mode pool because the SSE listener holds a client.
- C10. Lead (6) ES:112: matches at base; ES:74 marker and ES:85 result match lead (5).
- C11. MS:84 says the ES hunk ports "only with rows 1-9"; this lane ports it with rows 3-4, so the block names only files on main at merge (2.8).
- C12. P50P:11 "PREPARED, NOT APPLIED" matches lead (1) row 4.
- C13. P50S:7 and P50P:14 point to `docs/runbooks/staging-deploy.md` (an L69 runbook, not on main): the new headers cite M instead.
- C14. P50P:19-21 lists "SePay / ApiPay / Zalo Bot UNRESOLVED" as open gates; at base the gate is closed (ES:85) and SePay/ApiPay are not first-launch dependencies (ES:80-81).
- C15. P50S and P50P set NODE_ENV on every component; M:51 says the image sets it and it is not overridden.
- C16. L65R:179 (S3: RS passes a committed SECRET value) is stale: RS:71 refuses it (2.3; measured by R0b-2).
- C17. ES:196 gives discovery `DATABASE_URL` (readonly); main reads DISCOVERY_DATABASE_URL (DRS:47), and M's D-2 (M:126) agrees with main (measured by R0b-2, not re-read by R0b-3).
- C18. ES:188 and ES:198 (a transaction pool plus DATABASE_URL_LISTEN) differ from R1 (M:134: a session-mode pool, default pending owner sign-off) (measured by R0b-2, not re-read by R0b-3).
- C19. PL:78 (row L66, gate column: G1 PASS by "the vendor's written answer, 8.4", citing ES:81) and PL:159 (L66 starts only after L62 merges and the written answer of step 8.4 exists) are superseded by DD-156 (decisions.md:120, :1792): the owner's exception closes the Zalo row `NO`, G1 passes when the record lands (L81), "continue with L66, L67, L69"; a written Zalo YES switches to the Q7 fallback before production. At the base ES:81 is another row (2.5 item 1).
- C20. PL:97 and PL:268 cite the backlog row `staging-ttl-teardown-automation` at :5892; at the base its heading is :5898.
- C21. 2.2 and D1 cite M:20-22, PL:138-141 and DD-154 for staging's shape-4 window. DD-154 (j2) (decisions.md:1893): the plan does not say which shape staging uses for G2, the owner's Q3 sentence puts only the failover drill on the HA window ((b), :1884), and DD-154 does not decide it; the conductor's default is in `docs/autopilot-templates/web-mvp-phase5-2026-10-28-RUN.md` (S3), labelled "default applied, pending owner sign-off". Read by R0b-4 at the base: RUN:124 (S3) "G2 STAGING SHAPE (default applied, pending owner sign-off): ONE temporary staging in the HA shape (shape 4), created by the owner at G2, covers G2 and G3 (smoke, staging golden path, the section 7.6 drills) within its 48-96 hour window, then the owner deletes it; if G2 needs longer, the owner may run G2 on a non-HA staging and create the HA window for G3 only. [...] this line decides nothing else." (RUN:121 says the same in Vietnamese). The counts come from PL:141 (shape 4 = the temporary staging, 48-96 hours, one window a month, priced on shape 1 or 2), PL:138 (shape 1: web 2 x, discovery 2 x, worker) and PL:139 (shape 2: the same web, discovery, worker line, $58.00 = 2 x 12 + 2 x 12 + 10). Correction: the staging half of D1 carries RUN:124's label, not RO-L66-1's; PL, RUN and DD-154 agree (PL's only staging shape is 4, DD-154 (j2) leaves the G2 choice open, RUN:124 fills it), so no ruling request. RUN = `docs/autopilot-templates/web-mvp-phase5-2026-10-28-RUN.md`.

## 4. Decisions

- D1. Topology reading of DD-154 (a): production = web x1 serving the discovery surface (2.2), worker x1, no discovery component: "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature" (ruling RO-L66-1 item 4). Staging = shape 4, derived, not chosen: web x2, discovery x2, worker x1 (PL:138-139 app line of shapes 1 and 2, PL:141 shape 4); the use of shape 4 for G2 and G3 is the RUN:124 conductor default, "default applied, pending owner sign-off" (C21). The non-HA G2 fallback of RUN:124 is an owner option: L66 writes no non-HA staging spec (RUN:124 "decides nothing else").
- D2. Staging GENDER_COLLECTION_ENABLED = `"false"`: fail closed until the legal answer of step 8.10 (M:103); staging then rehearses the production flag state, and turning it on in staging is a one-line owner change. "default applied, pending owner sign-off".
- D3. The YAML-to-JSON test path: a strict YAML-subset reader inside RT that fails closed on every construct outside the subset (candidate (a) of 2.7; (b) prettier rejected: untyped, undocumented AST; (c) Ruby rejected: runner presence unverifiable, and a ci.yml step is outside the ownership). B3 cost: about 50 test lines, a B3 exception (Node 22 has no YAML parser; package.json and the lockfile are outside the ownership). "default applied, pending owner sign-off".
- D4. No YAML anchors: an explicit image block per component; R0a's pages do not state anchor support, and a converter needs no alias handling. "default applied, pending owner sign-off".
- D5. Owner-entered values with no committed literal (GOOGLE_OAUTH_CLIENT_ID, KMS_KEY_ID) are `type: SECRET`, so RS carries them forward and fails closed when one is missing. "default applied, pending owner sign-off".
- D6. Flags whose "on" is an owner step are written as explicit `"false"` (GENDER_COLLECTION_ENABLED, OUTBOX_DISPATCH_SCHEDULE_ENABLED, CSP_SCRIPT_NONCE_ENABLED); config equal to a code or image default is dropped (NODE_ENV, LOG_LEVEL). "default applied, pending owner sign-off".
- D7. KMS_ENCRYPTED_CONNECTOR_PEPPER on web and worker in both specs, following DD-122 O4's default of a separate key (per M:46); it must be settled before the first real club connects (M:46). "default applied, pending owner sign-off".
- D8. KMS_KEY_ID on web and worker, one value (M:47: both or neither; PL:211 lists it among the KMS names to enter, per M). "default applied, pending owner sign-off".
- D9. AWS_REGION = `ap-southeast-1` (P50S:106) on web and worker; the owner changes it at step 8.1 if the KMS key lives elsewhere (M:33). "default applied, pending owner sign-off".
- D10. No `liveness_health_check` (as PR 50); the worker gets no health-check key (F17, F33). "default applied, pending owner sign-off".
- D11. Drop the alert `REQUEST_DURATION_P95_MS` (not in F5's component rule list).
- D12. Discovery drops DATABASE_URL (M:35, D-2 at M:126); it reads DISCOVERY_DATABASE_URL only.
- D13. Staging ingress = three rules: `/discover` and `/api/discover` to discovery, `/` to web. B-6 (R0b-4): the three routes under `apps/web/app/api/discover` export GET only (`route.ts:20`, `[publicListingId]/route.ts:6`, `share/[slug]/route.ts:11`) and match RP:35-37; the pages `apps/web/app/discover/page.tsx` and `[publicListingId]/page.tsx` match RP:34 and read `/api/discover` by relative URL (`apps/web/lib/discover-api.ts:140`, :145), so the second rule keeps those reads on the discovery component and its readonly pool. `/session/<x>` (RP:38) stays on web, as in PR 50. Forwarded path (B-8, closed by R0c): a rule trims its matched prefix by default (F44), so without a key `/discover/<id>` would reach discovery as `/<id>` and `/api/discover` as `/`, which RP:62-63 refuses (fail closed, but staging discovery would not serve at G2). So every ingress rule of both specs writes, as a block mapping (the D3 reader refuses flow maps), `component:` with `name: <component>` and `preserve_path_prefix: true`, and no `rewrite` (mutually exclusive, F44). Required on the two discovery rules; on the `/` rules (staging web, production web) a Tier B choice: the official example's `/` rule omits the key (F45) and the page does not say how a `/` prefix is trimmed, so the key pins the documented "the path will remain" behavior for every web path; one invariant over all rules, asserted by T-N8; reversible by a spec edit. "default applied, pending owner sign-off".
- D14. Both specs use `domains` and `APP_BASE_URL` = `https://__APP_DOMAIN__`; settled by RS:77, :79-80 (an empty APP_DOMAIN leaves the token, which fails as an unresolved placeholder, 2.3). "default applied, pending owner sign-off".
- D15. Every env entry writes `scope: RUN_TIME` and an explicit `type` (R0a Open 2).

## 5. Acceptance matrix (A-1..A-9; expected results)

| # | Command (writer) | Expected |
|---|---|---|
| A-1 | `pnpm run test:infra` | the 7 existing RT cases plus T-N1 to T-N4 and T-N6 to T-N8 pass, 0 fail |
| A-2 | after the fix commit: delete one SECRET entry from `infra/app.staging.yaml`, rerun A-1, restore with `git checkout --` | T-N3 fails; A-1 green again |
| A-3 | a YAML parse of both specs from a script file under the session notes (orchestrator) | both parse; the B-2 path's JSON equals the real parser's JSON |
| A-4 | `grep -n 'REQUEST_DURATION_P95_MS\|basic-xxs\|EV\[' infra/app.staging.yaml infra/app.prod.yaml` | no hit |
| A-5 | `grep -n 'DATABASE_URL_MIGRATION' infra/app.staging.yaml infra/app.prod.yaml` | one hit per file, inside the migrate job |
| A-6 | `pnpm typecheck`, `pnpm lint`, `pnpm -w format:check` (= `prettier --check .`, root package.json:25; CI ci.yml:75); `.prettierignore` lists `infra/`, `docs/` and `*.md`, so no file of this lane is checked and no prettier run is needed (B-7) | green |
| A-7 | `git diff -U0 be955cf68dd51f6da6024d270585d180d758956d -- docs/standards/environments-setup.md` | three hunks (ES:3, after ES:438, the changelog); none in ES:51-113 |
| A-8 | `pnpm review:check:changed` before each commit; `pnpm review:check` at the end | green |
| A-9 | final-checks.sh; GitNexus detect_changes | the declared files only |

## 6. Verification and review

The lane block's TESTS and REVIEW PLAN as-is: one opus reviewer role, at most 3 rounds counting pre-push rounds, plus one opus security round on section 8; CI green on one push.

## 7. Budget (B3) and files

Plan: about 320 changed lines in 3 files plus the test cases, 0 migrations. Projection from 2.6: staging spec about 165 lines, production about 130, the ES hunks about 25: about 320 non-test; T-N1..T-N6 about 70 test lines. D3 (the in-RT subset reader, 2.7) adds about 50 test lines plus T-N7: a B3 exception with that design reason (Node 22 has no YAML parser; `package.json` and the lockfile are outside the ownership); PL:93 expects that L66 may exceed B3 and requires the exception at step 0. 0 migrations.

## 8. Security notes for the security round

- S1. Secret names only: every SECRET is `type: SECRET` with no `value` key; RS:71 refuses a committed SECRET with a value, so T-N1 and T-N2 prove it for both files by rendering them (2.3, C16).
- S2. DB role per component: web DATABASE_URL `app` (EP:25; M:35; R1), web and staging discovery DISCOVERY_DATABASE_URL `readonly` (asserted in code, DRS:62-64), worker DATABASE_URL_DIRECT `app_worker` (M:36), migrate job DATABASE_URL_MIGRATION `migration` (M:75), on the job only (M:71, M:102; RS:59-65 per M). DB_EXPECTED_ROLE `app` (web) and `readonly` (discovery) arm EP:45-49.
- S3. The private DB path (B-3 closed: PASS). DD-04 §7.1 as the decision log states it, decisions.md:220 (Vietnamese, translated): DO App Platform does not enable VPC-private-DB and dedicated egress-IP at the same time; verify whether SePay/ApiPay/Zalo/Messenger require a fixed outbound source IP BEFORE building the DO App Spec; if so, use fallback (a) Fly + DO, and NEVER silently disable the private-DB path. The gate closed on its VPC-private branch (ES:85 `DO_VPC_COMPATIBLE`). ES:167, the App Spec control for that branch: "VPC attachment to the environment's `sgp1` VPC; no dedicated egress-IP block on the VPC path." F2: the only VPC field is `vpc.id`; F24: VPC "cannot be used with dedicated egress IPs". PR 50's two specs have no `databases`, `egress`, `db_user` or `cluster_name` key (grep of `git show`, zero hits), as lead (1) row 3 says. So the branch is: app-level `vpc.id` + no `egress` block + DB URLs as component SECRET envs (M E3) whose owner-entered values name the private host + trusted sources holding the app's VPC egress private IP (F25, S4). No source requires a `databases:` component: R0a:89's "Private path: `databases` component + `vpc.id` + `${db.DATABASE_PRIVATE_URL}`" describes the bindable route, which cannot carry the manifest's contract: (i) one `db_user` per `databases` component (F19), so four roles need four components; (ii) no documented bindable names a connection pool (F20, F27), so R1's session-mode pool URL (M:134) is not expressible; (iii) a bindable is a committed value, and RS:71 refuses a SECRET with a value, so it would have to be GENERAL, against M E3. Main (RS), M and DD-04 agree; not a ruling request. Residual risk: values are ciphertext, so no test can prove a private host; a public URL is the threat-model mistake. Trusted sources limited to the VPC egress private IP (F25) make such a URL fail to connect (fail closed): an owner step at 8.1 and 8.5, recorded in the header gate list.
- S4. Trusted sources: the app's VPC egress private IP must be added to the database's trusted sources (F25); an owner step, not a spec field.
- S5. Fail-closed rendering: RS fails on a missing secret, a nameless document, a lower-case type and a non-EV live value, and refuses DATABASE_URL_MIGRATION outside the job (2.3, secondary; B-1 re-reads it).

## 9. Known risk

- K1. Worker health: App Platform gives workers no readiness check (F17); whether it honors DF:81-82's HEALTHCHECK is not stated on the pages read; RESTART_COUNT is the worker's only platform signal.
- K2. PRE_DEPLOY failure and readiness-rollback semantics are not stated (R0a Open 1, Open 7).
- K3. VPC egress per component kind is not stated (R0a Open 4): a job or worker without VPC egress fails to reach a private DB (fails closed).
- K4. First creation with value-less SECRET entries (R0a Open 3): owner step 8.5, L67 and L69.
- K5. Production single web instance (2.2 items 1-4).
- K6. The `provision` role is not a component of either spec (M:24 assigns its place to L63 and L67).

## 10. Open

`OPEN_QUESTIONS_IN_SCOPE: 0` (R0b-2 closed B-1 to B-3, R0b-3 and R0b-4 closed B-4, R0b-4 closed B-5 to B-7 and opened B-8, R0c closed B-8; no ruling request is open: PL, RUN and DD-154 agree on staging's shape, C21; owner = the lane orchestrator unless named):
- B-1. CLOSED, PASS (R0b-2, section 2.3). Was: RS and RT not read at the base: the exact placeholder tokens, the committed-spec and live-spec input formats, the behavior on an empty APP_DOMAIN, RT's helpers, fake EV form and existing case names. Resolution: quoted at `path:line`.
- B-2. CLOSED, PASS by decision D3 (Tier B, "default applied, pending owner sign-off"): the strict YAML-subset reader inside RT (2.7). The precedent grep finds no test spawning a YAML converter and no `yaml` or `js-yaml` package in the pnpm store; the only YAML-to-JSON mention is RS:4's owner usage `yq -o=json`. Was: the YAML-to-JSON test path (2.7). Resolution: B-1 plus a precedent grep; if no candidate fits the ownership, a ruling request to the conductor.
- B-3. CLOSED, PASS (R0b-2, S3: app-level `vpc.id` + no `egress` block + DB URLs as component SECRET envs is the VPC-private branch; main, M and DD-04 agree; not a ruling request). Was: the private DB path design: DD-04 §7.1 (decisions.md) and ES:151-207 (§3 "Required App Spec controls", §4 roles) not read; with R0a's unread manage-databases page. Resolution: both quoted; if they require a `databases:` component that cannot express four roles and the session pool, a ruling request.
- B-4. CLOSED, PASS (R0b-3 in part; R0b-4 the residual: (1) RUN:124 quoted, C21, D1; (2) L73 on the base, 2.5 item 7; (3) both backlog bodies, 2.5 items 2 and 8). Quoted at the base: PL:59 (the `health_check` stanza belongs to L66), PL:60 (GENDER_COLLECTION_ENABLED "false" in the spec of the first real-user environment), PL:78 (row L66), PL:93 (L66 may exceed B3 and records the exception at step 0), PL:97, PL:130 (Q8 default `KMS_PROVIDER=aws-kms`), PL:132 (Q10), PL:134-141 (shapes), PL:159, PL:263-269, §8 rows 8.1 (PL:197), 8.2 (:198), 8.5 (:201), 8.9 (:205); DD-154 (decisions.md:122 "Q1, Q2, Q4-Q10 default", Q3 override; consequences (a) :1883, (b) :1884, (c) :1885, (d) :1886, (e) :1887, (g) :1889, (j2) :1893); DD-155 (:121); DD-156 (:120, :1792); DD-04 §7.1 (:220) and its DD-154 supplement (:248); backlog headings `infra-do-app-vpc-deployment` :885 (notes :895), `db-tls-ca-verification-do-managed-pg` :5881, `staging-ttl-teardown-automation` :5898. Findings: C19-C21; header gate items 7-9 (2.5). The residual is closed (above).
- B-5. CLOSED, PASS (R0b-4): the names-only env grep at the base finds no runtime name outside M; the tables and T-N3's counts stand (2.6).
- B-6. CLOSED, PASS (R0b-4): every route under `apps/web/app/api/discover` exports GET only and is on RP:35-37; D13 = `/discover` and `/api/discover` to discovery, `/` to web.
- B-7. CLOSED, PASS (R0b-4): `apps/web/package.json:8-9` both run `next start -p ${PORT:-3000}` (EP:57, :62), so with PORT not set (2.6) both roles listen on 3000 = `http_port: 3000`; `.prettierignore` lists `infra/`, `docs/` and `*.md`, so prettier checks no file of this lane (A-6). R0c: F46 confirms the port premise: the spec declares no PORT (2.6), so the platform adds PORT = `http_port` = 3000, and the health check, with no `port` key, probes 3000.
- B-8. CLOSED, PASS (R0c; 2.4 F44-F47; D13; T-N8). (1) An `ingress.rules[]` rule trims its matched prefix by default; the key that keeps the full path is the rule's `component.preserve_path_prefix: true` (F44, F47; the `routes` form is deprecated; mutually exclusive with `component.rewrite`). D13 writes it on every rule of both specs, so discovery receives `/discover...` and `/api/discover...` unchanged (RP:32-39). (2) With no PORT entry the platform adds PORT = `http_port` (F46): B-7 stays PASS. The facts live in this file (2.4), not in R0a's notes, per the lane orchestrator's R0c brief. Related, not in scope (F47): a service must bind `0.0.0.0`; `next start -p ${PORT:-3000}` passes no `-H` and no HOSTNAME is set (`apps/web/package.json:8-9`, DF, EP: grep), so the bind is Next's default, not a DigitalOcean fact and not re-checked; a loopback bind would fail the `/healthz` check (F46) and the deploy fails closed (runtime risk, like K2). Was: (1) The path an ingress rule forwards to its component: P50S:27-38 routes with `match.path.prefix` and `component.name` only (names-only read; no other key under `component`); R0a's F6 quotes the prefix match and `component.name`, not whether the matched prefix is kept or trimmed nor a key that keeps it (R0a's notes: no hit for `preserve`, `trim`; `rewrite` only in F6's ingress description). Discovery needs the full path: RP:32-39 allowlists `/discover(/|$)` and `/api/discover...`, the pages live under `apps/web/app/discover/`, and RP:62-63 refuses any other path (fail closed: no exposure, but staging discovery would not serve at G2). (2) Whether the platform sets PORT for a service: R0a's notes name PORT only as a DB bindable (F20). Owner: the lane orchestrator (a Q4 unit with web access, official App Spec reference only, R0a's method). Binary resolution: R0a's notes gain fact ids quoting both; D13 writes the quoted key on both discovery rules or records that the path is kept by default; B-7 stays PASS or `http_port` follows the quoted PORT rule. Not a ruling request.

## 11. Hard dependencies and backlog rows

- Measured: #135 merge `4345c284857f70d398d1421ef25db796b56ad319`, #137 merge `4230c752ec0ddb2a14e2a07714a901c6022e862c` and #149 merge `be955cf68dd51f6da6024d270585d180d758956d` (= the base) are on the base (`git log -1 --grep` on HEAD).
- Backlog: `infra-do-app-vpc-deployment` is not edited (lead (6)). Candidate new END rows (at most 3): (1) K1 worker health signal: dropped, the row `staging-ttl-teardown-automation` already notes it (:5912) and a new row would duplicate it; (2) B-3's structural private path if deferred; (3) K6 the provision job's place, if L63 and L67 do not hold it.

## 12. Closure matrix

| # | Gate | Evidence | Result |
|---|---|---|---|
| 1 | Authority snapshot pinned by SHA | the base measured; every TARGET_FILES path exists at the base | PASS |
| 2 | Decisions in scope final | D1-D15 labelled; DD-154/155/156 bodies quoted (R0b-3); staging's G2 shape = RUN:124, counts from PL:138-139, :141 (R0b-4, C21, D1) | PASS |
| 3 | Scope IN/OUT and owner clear | section 1 | PASS |
| 4 | Dependencies classified | section 11 | PASS |
| 5 | Live schema and code match | readers and RS measured (2.2, 2.3); env grep at the base (B-5, 2.6); routes (B-6); port (B-7) | PASS |
| 6 | Data, API, state, auth contract | 2.6 tables from M; private DB path PASS (S3); ingress rules and their forwarded path settled (D13, F44, T-N8) | PASS |
| 7 | Fail-closed, idempotency, order | code and RS measured (2.2, 2.3) | PASS |
| 8 | Open questions in scope = 0 | section 10: 0 (R0c closed B-8) | PASS |
| 9 | Acceptance matrix with expected results | section 5; A-6's format step fixed (B-7); A-1 counts T-N8 (B-8) | PASS |
| 10 | Migration, security, rollback | no migration; section 8; rollback = revert the PR | PASS |
| 11 | First slice hard dependencies merged | section 11 | PASS |
| 12 | Implementation handoff ready | B-1 to B-8 closed; tables 2.6, test plan 2.7, D1-D15, A-1 to A-9; first step in section 13 | PASS |

## 13. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-30
AUTHORITY_SHA: be955cf68dd51f6da6024d270585d180d758956d
BASE_BRANCH: main
TARGET_FILES:
  - infra/render-app-spec.test.mjs (edited: new cases only)
  - docs/standards/environments-setup.md (edited: the row-22 hunk only)
  - docs/autopilot-backlog.md (edited: at most 3 rows at the end)
  - infra/render-app-spec.sh (read-only)
  - infra/entrypoint.sh (read-only)
  - infra/Dockerfile (read-only)
  - docs/runbooks/env-manifest-staging-production.md (read-only)
  - apps/web/lib/request-policy.ts (read-only)
  - apps/web/lib/discovery-route-support.ts (read-only)
  - apps/web/lib/discovery-cursor.ts (read-only)
  - apps/web/lib/log.ts (read-only)
  - apps/web/app/api/me/profile/route.ts (read-only)
  - apps/web/app/healthz/route.ts (read-only)
  - apps/web/e2e/support/staging-golden-path-guard.ts (read-only)
  - docs/sessions/web-mvp-phase5-golive-plan.md (read-only)
  - docs/standards/decisions.md (read-only)
  - docs/research/web-mvp-phase5-golive-measurements-2026-10-28.md (read-only)
SLICE: p5-app-specs
IN_SCOPE: infra/app.staging.yaml and infra/app.prod.yaml (new); new render cases in infra/render-app-spec.test.mjs; the row-22 hunk of docs/standards/environments-setup.md; at most 3 backlog rows at the end; this readiness file
OUT_OF_SCOPE: doctl (including spec validate), gh workflow run, any cloud CLI, console, account, login or deploy; workflows (L67); runbooks (L69, L70); Dockerfile, entrypoint, fly.toml; the renderer script; section 1.1 of environments-setup.md; any secret value; PR 50 and its branch; a Fly variant
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: #135, #137 and #149 merged (measured on the base)
PRIOR_SLICES: #137 (L65, merged: the renderer); #149 (L81, merged: the egress gate closed)
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: owner steps 8.1, 8.2, 8.5, 8.9, 8.10, the DB trusted sources (F25) and doctl apps spec validate (apply and deploy only; none blocks writing the files)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 8
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 - write infra/app.staging.yaml and infra/app.prod.yaml from the 2.6 tables and D1-D15 (D13: every ingress rule carries component.preserve_path_prefix: true), add T-N1 to T-N4 and T-N6 to T-N8 with the D3 reader to infra/render-app-spec.test.mjs, run A-1 to A-6, commit in the worktree
REMAINING_BLOCKERS: none
```
