<!-- review-readiness: code-ready -->

# Step-0 readiness: L84 p5-kms-root-key-choice (session P5-S13a)

Writer: W0 (opus, readiness writer), 2026-10-31, from the step-0 sizing of unit SZ1 (status FINAL). Base and authority: `5c225d89978eedfcbed32a66bd363ac7804bc894` (origin/main, PR 154's merge; the worktree HEAD at the start). Every line number is a source line at that base. Risk P1 (the renderer copies the live secrets, and it now selects the key root) with one security round; 0 migrations. Short names: R `infra/render-app-spec.sh`, T `infra/render-app-spec.test.mjs`, SR `packages/db/src/secret-key-root.ts`, M `docs/runbooks/env-manifest-staging-production.md`, RB `docs/runbooks/staging-deploy.md`, E `docs/standards/environments-setup.md`, GNG `docs/runbooks/go-no-go-template.md`.

## 1. Authority

- DD-158 in `docs/standards/decisions.md` (summary row :120; entry :1789-1831; the answer to item 6 at :1822-1828), recorded by PR 154, merged as `5c225d89978eedfcbed32a66bd363ac7804bc894`. The owner's own words at 01:23, confirmed at 01:3x: "cho phép tạo 2 option, key local và aws". The readings at :1823-1827 are the readings of the owner's assistant and of the conductor, not the owner's words:
  - :1823: the root key stays the owner's choice per environment at step 8.5, between the two supported roots, aws-kms (default) and the local key (KMS_PROVIDER local or unset, with ENCRYPTION_KEY); SR already supports both, so L77 does not start.
  - :1824: what is missing: both App Specs declare only the aws-kms set and no ENCRYPTION_KEY, row 9 of M says no component reads ENCRYPTION_KEY, and the renderer fails closed by name on a missing secret, so "the owner cannot choose local alone".
  - :1825: ONE new lane, L84, after L83: the smallest design that stays fail-closed (a renderer parameter or a second declared set; the conductor chooses, Tier B), with M, step 8.5 of RB and the tests. The PR touches the deploy-guard files `infra/app*.yaml`, so it is an owner merge.
  - :1826, the cost clause: one step-0 reader; a lane larger than one small lane under the 16:40 rule (DD-157), for example under the code review policy because the renderer is a script, needs an owner AskUserQuestion BEFORE any writer. The step-0 sizing classed L84 a CODE lane (R is the secret-copying choke point and T is executable test code: up to 3 code rounds plus 1 security round, opus), so the conductor asked. The owner's answer of 2026-10-31 08:06, verbatim: "Chạy code lane (Recommended)".
  - :1827: the local key stays the lower-protection path: section 7.6 item 10 is deferred, and choosing it needs the owner's step 8.9.
- The design choice, D1b plus the KMS_PROVIDER agreement guard (2.2), is Tier B: "decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature". The owner's own steps stay the owner's: KEY_ROOT per environment, the ENCRYPTION_KEY value and the 8.9 sign-off.
- The only Tier C item of the lane is item 6, the merge: four deploy-guard files (2.4) make it an owner merge.

## 2. Measured at base

### 2.1 The renderer, the specs, the tests and the workflows at the base; facts K1-K3

- R (99 lines): :5 the usage line; :8-24 the contract comment (:16-17: "the committed spec decides which envs exist"); :27-30 the inputs (:28-29 `IMAGE_DIGEST` and `VPC_ID` through bash `:?`); :32-36 the shape checks; :39-40 stdin is read and an empty one fails; :42 the jq call (`--slurpfile live`, `--arg digest`, `--arg vpc`, `--arg domain`); :45-48 `liveSecrets`, a lookup keyed `<kind>/<name>/<KEY>` over services, workers and jobs; :52 `list($f)` (null reads as empty, an array as itself, anything else fails naming the field); :56-58 one document, a non-blank `.name`, equal to the live `.name`; :63-65 the closed-set guard on `DATABASE_URL_MIGRATION`; :68-72 the type/value check over every committed `envs` on any surface; :75-78 the placeholder `walk` (`gsub` per token); :79-81 the unresolved-placeholder check; :82-94 `fill` (:86 a missing live secret, :87-88 a live secret that is not an `EV[...]` ciphertext, :90 a live SECRET demoted to a plain env); :96-97 the unfilled-SECRET check; :99 the `catch`: only messages starting `render: ` pass, jq's own text is withheld.
- The specs. Staging: header :5-6 (the placeholder list) and :21 (KMS_ENCRYPTED_CONNECTOR_PEPPER, DD-122 O4); web: KMS_PROVIDER :140-143 (value `"aws-kms"` at :143), AWS_REGION :144-147, KMS_KEY_ID :165, AWS_ACCESS_KEY_ID :168, AWS_SECRET_ACCESS_KEY :171, KMS_ENCRYPTED_AUTH_PEPPER :174, KMS_ENCRYPTED_CONNECTOR_PEPPER :178, the list ends at :183 (LINK_CODE_LOOKUP_HMAC_KEY); worker: KMS_PROVIDER :271-274 (value at :274), AWS_REGION :275-278, KMS_KEY_ID :289, KMS_ENCRYPTED_CONNECTOR_PEPPER :293, the AWS pair :296 and :299, the list and the file end at :301. Production: header :5-6 and :23; web: KMS_PROVIDER :127-130 (value at :130), AWS_REGION :131, KMS_KEY_ID :152, the AWS pair :155 and :158, the auth pepper :161, the connector pepper :165, the list ends at :170; worker: KMS_PROVIDER :204-207 (value at :207), AWS_REGION :208, KMS_KEY_ID :222, the connector pepper :226, the AWS pair :229 and :232, the list and the file end at :234. No spec names ENCRYPTION_KEY. Precedent comments: "# One value for web and worker." (staging :164, :177; production :164) and "# Same value as on web." (staging worker :288, :292).
- T: `render()` :38-51 with its env at :46 (`PATH`, `IMAGE_DIGEST`, `VPC_ID`, `TMPDIR`, then `...env`); the empty-stdin test :161-191 spawns bash itself, with its own env at :170 (no `...env`); the list-shape cases :212-224 expect `render: <field> must be an array` for `services: {}`, a string `services` and `workers: {}`; the oracle comment :377-378 and `EXPECTED_ENVS` :379-396 (web 8 GENERAL + 11 SECRET, discovery 4 + 2, worker 5 + 5, migrate 1 + 1); `components` :399-401; `fakeLive` :404-410 (every SECRET gets `EV[1:<kind>-<name>-<KEY>]`, every other value is the committed one); `secrets` :413-418; `assertEnvKeys` :422-433 (sorted `deepEqual` at :427, RUN_TIME at :429, no SECRET value at :430); the render loop over both specs :435-453 (`secrets(out)` equals `secrets(liveSpec)` at :447); the counts and the negative control :455-468 (counts at :457: `{ web: 19, discovery: 6, worker: 10, migrate: 2 }`); production shape 3 :470-486; the missing live secret :488-497; the YAML subset reader from :499; the ingress test renders `fakeLive(spec)` at :527.
- The workflows: the render step's env ends after `.github/workflows/deploy-staging.yml:127` and `.github/workflows/deploy-production.yml:121` (step-0 measurement). The rollback jobs restore a saved spec and never render.
- K1 (the step-0 measurement). SR is read lazily: the root is cached on first use (SR:15, :25, :44), with no start-time caller at the base. First use is the first Google sign-in on web or the first zalo-dm projection on worker (a bad root there is a `bot_unavailable` dead letter). `/healthz` and the deploy smoke stay green on a wrong or missing root, so the renderer's checks are the only pre-deploy guard. On local a changed ENCRYPTION_KEY keeps the label "local" (SR:111-113): the label check cannot see it, only GCM and hash mismatches do. On local KMS_KEY_ID must be ABSENT, or the label says "KMS key" while the root is ENCRYPTION_KEY: the drop (2.2 step 4) guarantees it.
- K2. SR:90-91: on local ONE ENCRYPTION_KEY roots the auth hashes, PKCE, gender (PII) and the Zalo connector secrets (HKDF `info` still separates the AES keys, SR:115-122). DD-122 O4 is unavailable on local: an item of the owner's 8.9 sign-off.
- K3. R:16-17; `fill` maps only committed envs (R:84-91) and `liveSecrets` is a lookup (R:45-48). Unmeasured premise, an inference from update = replace: `doctl apps update` then drops the live envs the rendered spec omits, so any switch deletes the OTHER set's live values at the next deploy, including DigitalOcean's only copy of the KMS pepper blobs. Second unmeasured premise: doctl accepts valueless SECRETs at create, already handled at RB:52. Neither is an open question: K3 is the reason the K1 rule (2.6) forbids a switch by variable edits, and the create path exists today.

### 2.2 Q1: the design, D1b plus the KMS_PROVIDER agreement guard

Each spec declares BOTH key-root sets, each env once; R keeps the set that a required input KEY_ROOT names and drops the other. The membership of the sets has ONE source: two closed lists held in R (precedent: R already hard-codes a closed-set key guard at :59-65). T keeps its own hard-coded per-set lists as the independent oracle (2.5).

The renderer, in this order (steps 1-3 and 5 change existing lines, steps 4 and 6 are new, step 7 is unchanged):

1. Inputs, before stdin: `KEY_ROOT` is read beside :28-29 through bash `:?` with the message `KEY_ROOT is required`, so unset or empty fails with `KEY_ROOT: KEY_ROOT is required` before :39 reads stdin. Beside the shape checks at :32-33, the value must equal exactly `aws-kms` or `local` (string equality: no pattern, no case folding, no trimming); any other value, whitespace-only, `AWS-KMS` and `gcp-kms` included, fails with `render: KEY_ROOT must be aws-kms or local` and exit 1, never printing the value. There is no default: no `:-`, no fallback in jq. A GitHub variable that is not set reaches the step as an empty string, which is the `:?` case.
2. :42 passes the value to jq as `--arg root`.
3. :56-58, :63-65 and the type/value check :68-72 are unchanged and run over the WHOLE committed spec, both sets, before anything is dropped: a value-carrying SECRET or an untyped env in the non-chosen set still FAILS instead of being dropped silently.
4. NEW, after :72, the drop. The two closed lists, defined once in the jq program beside `liveSecrets` and `list`:
   - aws-only: AWS_REGION, KMS_KEY_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, KMS_ENCRYPTED_AUTH_PEPPER, KMS_ENCRYPTED_CONNECTOR_PEPPER;
   - local-only: ENCRYPTION_KEY.

   `KEY_ROOT=aws-kms` drops the local-only list, `KEY_ROOT=local` drops the aws-only list, from every committed `envs` list (the same every-surface walk as :68, so no component is enumerated and a new component needs no edit). The match is the exact key. KMS_PROVIDER is in neither list and stays on both roots.
5. :75-78: the `walk` gains `gsub("__KMS_PROVIDER__"; $root)` beside the other tokens; :79-81 unchanged, so a token left unfilled still fails.
6. NEW, after :81, the agreement guard, before `liveSecrets as $ls` (:82). For every component of services, workers and jobs (each list read through `list($k)`, so a wrong-shaped list still fails with its existing `render: <field> must be an array`, as T:212-224 expect) that carries an env with key KMS_PROVIDER: the rendered value must equal `$root`, AND the live spec's component of the same kind and name must carry KMS_PROVIDER exactly once with the value `$root`. A live component or env that is absent, or a live surface of the wrong shape (read with `arrays`, as :46), counts as differing. Else FAIL with `render: KMS_PROVIDER differs from KEY_ROOT: <kind>/<name>`: the component and the key only, never the rendered or the live value. About 5 jq lines. It turns a later flip of the variable into a loud stop (the K1 rule, enforced), and it catches a creation copy made with the other value or left as `__KMS_PROVIDER__`, and a half-switched spec.
7. `fill` (:82-94), the unfilled check (:96-97) and the `catch` (:99): unchanged. Every existing guard keeps its meaning and its tests.

Comments: the usage line :5 adds `KEY_ROOT=aws-kms|local`; the contract :8-24 gains one item (KEY_ROOT required, closed set, no default; both sets type/value-checked, then the non-chosen set dropped by the two lists; `__KMS_PROVIDER__` filled from KEY_ROOT; the agreement guard, live and rendered); "Needs: bash 3.2+, jq." stays.

The specs, both files:

- web and worker: KMS_PROVIDER's value `"aws-kms"` becomes `"__KMS_PROVIDER__"` (staging :143 and :274, production :130 and :207), in place;
- web: after its last env (staging :183, production :170), four lines: the comment `# One value for web and worker; the renderer keeps it only when KEY_ROOT is local.`, then `- key: ENCRYPTION_KEY`, `scope: RUN_TIME`, `type: SECRET` (no value), indented as the other env entries;
- worker: after its last env (staging :301, production :234), four lines: the comment `# Same value as on web.`, then the same three lines;
- the header comments, in place (staging :5-6 and :21, production :5-6 and :23 keep their line counts, so every later line number and `docs/autopilot-backlog.md:8103` hold): :5-6 name the fourth placeholder `__KMS_PROVIDER__` (filled from KEY_ROOT) and say that both key-root sets are declared and the renderer keeps only the set KEY_ROOT names; :21 (production :23) says the connector pepper item applies on aws-kms, and that on local one ENCRYPTION_KEY roots the auth, PII and connector secrets (K2), an item of the owner's 8.9 sign-off.

The workflows: `KEY_ROOT: ${{ vars.KEY_ROOT }}` as ONE env line in the render step only (staging after :127, production after :121); the rollback jobs are untouched (they restore, no render). KEY_ROOT is a GitHub variable per environment, set by the owner at 8.5.

Rejected, one line each:

- D1a, a tag field marking each env's set: it invents a non-DigitalOcean field that R and the hand creation copy must strip, plus about 22 spec lines.
- D2, one spec per choice switched by a PR: it fails "picked at 8.5" and "the owner cannot choose local alone".
- D1c, the root read from the live KMS_PROVIDER with no variable: about 8 lines smaller, but it FOLLOWS a DigitalOcean-side edit instead of stopping, so it fails tie-break 1 (fail-closed).
- A workflow-side jq filter: two untested copies of the selection.

Criterion: fail-closed (closed set, the guard, the type/value hygiene over both sets) > one source (the lists in R) > fewer concepts (one name, one placeholder) > precedent (R:28-36, :59-65) > reversible (no SR or schema change). The 10x test: a new component needs no edit; a third provider fails closed in SR:22 and in R until a lane adds it.

### 2.3 The decision table (rows 1-11)

Every refusal: a non-zero exit, empty stdout, the exact message on stderr, never a value.

| # | KEY_ROOT | Live: chosen set | Live: other set | Live KMS_PROVIDER | Result |
| --- | --- | --- | --- | --- | --- |
| 1 | unset or empty | any | any | any | FAIL `KEY_ROOT: KEY_ROOT is required` (bash `:?`, as R:28-29), before stdin |
| 2 | any other value (`gcp-kms`, `AWS-KMS`, whitespace) | any | any | any | FAIL `render: KEY_ROOT must be aws-kms or local`, before stdin; the value is never printed |
| 3 | aws-kms | all `EV[...]` | absent or present | aws-kms | RENDER, KMS_PROVIDER=aws-kms. Web: AWS_REGION and the 5 aws SECRETs; worker: AWS_REGION, KMS_KEY_ID, KMS_ENCRYPTED_CONNECTOR_PEPPER and the AWS pair; ENCRYPTION_KEY dropped. Counts 19/6/10/2 (= today) |
| 4 | aws-kms | one missing | any | aws-kms | FAIL `render: missing secret in live app: workers/worker/KMS_KEY_ID - set it in DO first` (R:86) |
| 5 | local | ENCRYPTION_KEY `EV[...]` on web and worker | absent or present | local | RENDER, KMS_PROVIDER=local, ENCRYPTION_KEY kept, the aws-only set dropped. Counts 14/6/6/2; SR's label "local" |
| 6 | local | ENCRYPTION_KEY missing on one | any | local | FAIL `render: missing secret in live app: workers/worker/ENCRYPTION_KEY - set it in DO first` |
| 7 | either | one not `EV[...]` | any | matches | FAIL `render: live secret is not an EV ciphertext: services/web/<KEY>` (R:87-88) |
| 8 | either | any | any | differs or absent | FAIL `render: KMS_PROVIDER differs from KEY_ROOT: services/web` (the component and the key only; `workers/worker` likewise) |
| 9 | either | n/a | n/a | n/a | a half-switched spec (a literal KMS_PROVIDER left in a committed spec): the rendered value differs from KEY_ROOT, so row 8's FAIL. T also pins the placeholder on web and worker |
| 10 | either | n/a | n/a | n/a | a value-carrying SECRET or an untyped env in the NON-chosen set: FAIL at R:70-71 (`render: committed SECRET carries a value: <KEY>`; `render: env type must be GENERAL or SECRET: <KEY>`), before the drop |
| 11 | either | n/a | n/a | n/a | a duplicate key: D1b adds none. A spec duplicate fails T's sorted `deepEqual` (T:427), not R (pre-existing) |

Precedence follows the order of 2.2: rows 1-2 stop before stdin, row 10 at the type/value check, rows 8-9 at the guard before `fill`, rows 4, 6 and 7 in `fill`. A test for a later row therefore satisfies every earlier one (in rows 4, 6 and 7 the live KMS_PROVIDER matches).

### 2.4 Q2: the files, the base line ranges and the deploy guard

DG = the deploy-guard regex matches the path.

| File | Lines at the base | +/- est. | DG |
| --- | --- | --- | --- |
| `infra/render-app-spec.sh` | :5 usage; :8-24 the contract item; :27-36 KEY_ROOT; :42 `--arg root`; after :72 the drop; :76 the `gsub`; after :81 the guard | +20/-3 | no |
| `infra/render-app-spec.test.mjs` | :46 the default KEY_ROOT; :170 the empty-stdin test's own env; :377-396 ENCRYPTION_KEY, the per-set lists, the comment's source; :404-410 `fakeLive(spec, root)`; :422-433 the placeholder assert; :435-453 the loop, roots x specs; :457 the counts; new tests after :497 | +72/-8 | no |
| `infra/app.staging.yaml` | :5-6 and :21 in place; :143 and :274 the value; +4 after :183 (web); +4 after :301 (worker) | +8/-4 | YES |
| `infra/app.prod.yaml` | :5-6 and :23 in place; :130 and :207 the value; +4 after :170 (web); +4 after :234 (worker) | +8/-4 | YES |
| `.github/workflows/deploy-staging.yml` | +1 env line after :127 (the render step); the rollback job untouched | +1 | YES |
| `.github/workflows/deploy-production.yml` | +1 env line after :121 (the render step); the rollback job untouched | +1 | YES |
| M | :5 header (DD-158); :28 the legend; rows 2 :33, 9 :40 and 14-17 :45-48; :67 the AWS pair on aws-kms only; E5 a KEY_ROOT row (:83-95); E7 :112 removed | +12/-10 | no |
| RB | :38-39 (section 2.4, KEY_ROOT); :45, :51, :53, :69 (the fourth token, the chosen set); one new K1-rule paragraph; the cite shifts at :45, :114, :128 | +9/-7 | no |
| E | :389-390 (section 5); :418 the placeholder list | +3/-3 | no |
| `.env.example` | the comments :128-136 only (:129, :132; optionally :130, :135); no value change | +3/-3 | no |
| GNG | :67 the cite shift; :73 the sign-off row | +2/-2 | no |
| `docs/runbooks/pilot-club-host-onboarding.md` | :21 only | +1/-1 | no |
| `docs/autopilot-backlog.md` | at most 3 new rows at the END | about +6 | no |

OWNER merge: four deploy-guard files (the two App Specs and the two deploy workflows).

- The texts that call the local key dev-only: M:40 (row 9), M:112 (E7), M:48 (row 17, "KMS cho staging và production"), `.env.example` :129 and :132, E:389-390. RB has no such sentence: it gains the fourth token, the variable and the K1 rule.
- The cite shift: the four web lines move every staging line after :183 (cited: :191, :193, :201-210, :246, :248, :249-258) and every production line after :170 (cited: :179, :182-193); the cites sit at RB:45, :114, :128 and GNG:67. W2 re-measures each against W1's committed specs, never by adding a hand-counted offset. The header edits stay in place, so `docs/autopilot-backlog.md:8103` holds; dated session docs are not edited.
- SR: no change (negative scope). It already supports both roots (SR:22, :36, :48-57). Its "dev" wording (SR:8, :11, :33, :41, :52) goes in a backlog row, because its error strings are matched by `auth-secrets.test.ts` (:27, :50). Also negative: `connector-crypto.ts`, `gender-crypto.ts`, `apps/**`, the PLAN (:130, :229, :267 already cover local and 8.9; dated), `decisions.md`, `infra/entrypoint.sh`, the Dockerfile.

### 2.5 The test plan (T, about 77 lines)

1. `render()` (:46) gains `KEY_ROOT: "aws-kms"` before `...env`; a case removes it with `KEY_ROOT: undefined` (Node's spawn skips an undefined env value) or sets `""`. The empty-stdin test's own env (:170) gains `KEY_ROOT: "aws-kms"`: with KEY_ROOT checked before stdin, its `/empty spec on stdin/` assertion (:174) would otherwise meet the `:?` first. (The step-0 file list named :46 only; :170 was found while writing this record.)
2. The oracle (:377-396), hard-coded, never derived from a spec or from R's lists: `EXPECTED_ENVS` keeps the keys common to both roots, and two per-set tables sit beside it. aws-only: web GENERAL AWS_REGION, SECRET KMS_KEY_ID, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, KMS_ENCRYPTED_AUTH_PEPPER, KMS_ENCRYPTED_CONNECTOR_PEPPER; worker GENERAL AWS_REGION, SECRET KMS_KEY_ID, KMS_ENCRYPTED_CONNECTOR_PEPPER, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY. local-only: web and worker SECRET ENCRYPTION_KEY. The committed expectation is the common keys plus both sets; the rendered expectation for a root is the common keys plus that root's set. The counts are hard-coded: committed `{ web: 20, discovery: 6, worker: 11, migrate: 2 }` (:457), rendered aws-kms `{ web: 19, discovery: 6, worker: 10, migrate: 2 }` (= today), rendered local `{ web: 14, discovery: 6, worker: 6, migrate: 2 }`. The comment :377-378 keeps its source and adds section 2.2 of this record for the two sets.
3. `fakeLive(spec, root = "aws-kms")` (:404-410): every SECRET of both sets gets its fake `EV[1:<kind>-<name>-<KEY>]` (the "other set present" live app) and every KMS_PROVIDER gets `root`. Its callers at :441, :490 and :527 keep working with the default.
4. `assertEnvKeys` (:422-433) on both committed specs: the committed lists, plus web and worker each carry KMS_PROVIDER with the value exactly `"__KMS_PROVIDER__"` (row 9's pin) and ENCRYPTION_KEY once, as a valueless SECRET.
5. The loop (:435-453), rows 3 and 5: both committed specs x both roots. Each renders with `fakeLive(spec, root)` and with a variant whose live app lacks the other set: both exit 0 with empty stderr and the SAME stdout; each rendered component's `<KEY> <TYPE>` list equals the hard-coded rendered list for that root; each SECRET's value is the fake of its own kind, name and key; KMS_PROVIDER equals the root on web and worker; no `__X__` token is left (:448); `DATABASE_URL_MIGRATION` appears once (:450-451).
6. New tests after :497, on the staging spec; each refusal goes through `assertRefused` (:61-65: non-zero, the exact message, empty stdout), and stderr never contains a fake value:
   - row 1: KEY_ROOT unset and `""`: `/KEY_ROOT: KEY_ROOT is required/`; a direct spawn with an empty stdin (as :161-191) gets this message, not `empty spec on stdin`;
   - row 2: `gcp-kms`, `AWS-KMS`, `" local"` and `plain-fake-root`: `/render: KEY_ROOT must be aws-kms or local/`; stderr contains neither `gcp-kms` nor `plain-fake-root`;
   - row 4: aws-kms, the live worker lacks KMS_KEY_ID: the row-4 message;
   - row 6: local, the live worker lacks ENCRYPTION_KEY: the row-6 message;
   - row 7: local, the live web ENCRYPTION_KEY is `plain-fake-key` (no `EV[` prefix): `render: live secret is not an EV ciphertext: services/web/ENCRYPTION_KEY`, without the value;
   - row 8, with a live app that carries every secret of both sets, so the guard is the only refusal: (a) KEY_ROOT local, the live web KMS_PROVIDER `aws-kms`; (b) the live worker without KMS_PROVIDER; (c) the live web KMS_PROVIDER left `__KMS_PROVIDER__` (a creation copy): the row-8 message naming `services/web`, `workers/worker` and `services/web`, with no value in stderr;
   - row 9: the committed web KMS_PROVIDER a literal `"aws-kms"`, KEY_ROOT local, the live app local: the row-8 message naming `services/web`;
   - row 10: KEY_ROOT aws-kms with the committed web ENCRYPTION_KEY carrying `plain-fake-key`: `render: committed SECRET carries a value: ENCRYPTION_KEY`, without the value; KEY_ROOT local with the committed worker AWS_REGION untyped: `render: env type must be GENERAL or SECRET: AWS_REGION`;
   - row 11: a negative control beside :460-467: a staging variant with ENCRYPTION_KEY twice on web fails `assertEnvKeys`.
7. Planted mutations, each AFTER W1's commit, then restored with `git checkout -- infra/render-app-spec.sh` (and `git diff --quiet` proves the restore): m1 remove the agreement guard: the row-8 test fails; m2 give KEY_ROOT a default of aws-kms (`${KEY_ROOT:-aws-kms}`): the row-1 test fails; m3 drop the non-chosen set BEFORE the type/value check: the row-10 test fails.
8. jq: only builtins that jq 1.7.1 has (the CI runner, ubuntu-24.04); a newer local jq would pass a later builtin that fails on CI. `bash -n infra/render-app-spec.sh`. shellcheck and actionlint are not installed on the lane machine (2026-10-31): W1 says so in its report.
9. Fake values only (`EV[...]` strings, `plain-fake-*`); no DB, docker or network in the tests; nothing is read from a real app.

### 2.6 The docs plan (W2)

W2 (opus, as every unit of this CODE lane) runs after W1's code commit, serially in the same worktree, so every cite is final. Each file keeps its own language: M, RB, GNG and `docs/runbooks/pilot-club-host-onboarding.md` in Vietnamese, E in English, each `.env.example` comment line in the language it has, the backlog rows in the backlog's row format. Every edit stays inside the lines of 2.4.

- M: :5 the header cites DD-158; :28 the legend; row 2 (:33); row 9 (:40): web and worker read ENCRYPTION_KEY when KEY_ROOT is local, a permitted production option of lower protection, picked at 8.5 with the owner's sign-off 8.9 (no longer "no component reads it"); rows 14-17 (:45-48): the aws set applies only when KEY_ROOT is aws-kms (row 17's "KMS cho staging và production" becomes the owner's choice per environment); :67: the AWS pair on aws-kms only; E5 (:83-95): one new row, the GitHub variable KEY_ROOT (per environment, aws-kms or local, set at 8.5); E7 (:112), the item calling the local key dev-only: removed.
- RB: section 2.4 (:38-39): KEY_ROOT, a GitHub variable per environment, aws-kms or local, set at 8.5. Section 2.5 (3)-(4), the creation copy (:45, :51, :53): replace a fourth token, `__KMS_PROVIDER__` = this environment's KEY_ROOT, on web and on worker; keep both sets' valueless SECRETs. (5): enter only the chosen set's values; the first normal render drops the other set. :69 is edited only if it lies inside section 2.5 (3)-(5); the "first render drops the other set" sentence can sit in (5) or in the K1 paragraph, so no line outside the owned regions is needed. Then ONE K1-rule paragraph (below) and the cite shifts at :45, :114, :128.
- E: :389-390 (section 5): the local key is no longer "local development only": a permitted production option of lower protection, picked per environment at 8.5 with the owner's sign-off 8.9 (DD-158). :418: the placeholder list gains `__KMS_PROVIDER__`, filled from KEY_ROOT.
- `.env.example`, comments only (:128-136): :129 and :132 no longer call the local key dev-only ("dev-only (KHÔNG dùng ở prod)"); optionally :130 (`gcp-kms` is not supported) and :135 ("at boot": the root is read lazily, at first use, K1). No value line changes.
- GNG: :67 the cite shift (it cites staging :193 and :248); :73 the sign-off row gains the K2 consequence, per environment.
- `docs/runbooks/pilot-club-host-onboarding.md`: :21 only: ENCRYPTION_KEY under local, with its src marker to `packages/db/src/secret-key-root.ts:49`.
- `docs/autopilot-backlog.md`: at most 3 new rows at the END. Candidates: SR's "dev" wording (a code lane: its error strings are matched by tests, 2.4); the re-encryption path for a later root switch (K1).

The K1 rule, the meaning W2 writes in ONE RB paragraph:

- choose the root ONCE per environment at 8.5, before the first real data (the first Google sign-in, the first Zalo connect, the first gender value);
- KEY_ROOT and the creation copy's KMS_PROVIDER must be equal: the renderer refuses otherwise (row 8);
- after that, never change KEY_ROOT, KMS_PROVIDER, KMS_KEY_ID, the ENCRYPTION_KEY value or a KMS pepper: stored ciphertexts stop opening, auth hashes stop matching, clubs reconnect; a switch would also delete the other set's live values at the next deploy (K3);
- never switch by editing variables: a later switch needs its own lane (a re-encryption path);
- an ephemeral staging window may choose again, with fresh data.

The owner steps at 8.5 and 8.9 (the owner's, never an agent's; RB carries them at 8.5, GNG:73 the 8.9 consequence):

- set KEY_ROOT per environment, as a GitHub variable;
- generate ENCRYPTION_KEY on the owner's machine (`openssl rand -base64 32`, as `seed.ts:85`), ONE value for web and worker;
- keep an offline copy BEFORE entering it (DigitalOcean's read-back of encrypted values is not re-checked);
- the same root on staging and production is recommended: otherwise staging does not exercise production's key path;
- the 8.9 sign-off when local: the root sits in the app secret; ONE root covers the auth, PII and connector secrets (K2); section 7.6 item 10 is deferred (PLAN :229, :267; GNG:73); there is no rotation path.

## 3. Decisions

- D1, decided by the conductor under the owner's delegation of 2026-10-22, not an owner signature (Tier B, reversible): D1b plus the KMS_PROVIDER agreement guard (2.2); the rejected alternatives are listed there.
- D2, in-lane default, Tier B, reversible: KEY_ROOT has no default. DD-158's "aws-kms (default)" (:1823) names the recommended choice at 8.5 and today's spec value, not a renderer fallback: a fallback would silently render aws-kms for an environment whose owner chose local (the first threat of section 7). m2 pins it.
- D3, in-lane default, Tier B, reversible: the drop walks every committed `envs` list, as :68 does; the guard reads services, workers and jobs through `list($k)` and the live side with `arrays`, so the existing shape messages and the withheld-jq-text rule hold.
- D4, in-lane default, Tier B, reversible: each new ENCRYPTION_KEY entry carries the precedent comment (2.2), four lines per component instead of the step-0 three: the shared value is a correctness property (web writes connector secrets that the worker opens, K2).
- D5, in-lane default, Tier B, reversible: the empty-stdin test's own env (T:170) gains KEY_ROOT; the step-0 file list named T:46 only.
- D6, in-lane default, Tier B, reversible: W2 re-measures every shifted cite against W1's commit, never by a hand-counted offset (the shift is four lines after D4).
- D7, in-lane default, Tier B, reversible: the backlog rows (at most 3) are W2's; candidates in 2.6.
- Tier C: only item 6, the owner merge (2.4). No new money or PII contract: DD-158 names the artifacts by name (a renderer parameter or a second declared set, M, RB step 8.5, the tests), which demotes their execution to Tier A/B. The owner's steps of 2.6 stay outside the lane.

## 4. Acceptance matrix (A-1..A-15; expected results)

| ID | Command or check | Expected |
| --- | --- | --- |
| A-1 | `pnpm run test:infra` | green; every existing test keeps its meaning; rows 1-11 pinned (2.5) |
| A-2 | the loop (2.5 item 5): both committed specs x both roots, the other set present and absent | exit 0, empty stderr, identical stdout per pair; rendered counts aws-kms 19/6/10/2, local 14/6/6/2; KMS_PROVIDER = the root on web and worker |
| A-3 | `assertEnvKeys` on both committed specs | committed counts 20/6/11/2; KMS_PROVIDER `"__KMS_PROVIDER__"` on web and worker; ENCRYPTION_KEY once on each, a valueless SECRET |
| A-4 | rows 1-2 | the exact messages, before stdin; the value is never printed |
| A-5 | rows 4, 6 and 7 | the exact messages; no fake value in stderr |
| A-6 | rows 8-9 | the exact message naming the component; no value in stderr |
| A-7 | row 10 | the R:70-71 messages for the non-chosen set |
| A-8 | row 11 | the negative control fails `assertEnvKeys` |
| A-9 | m1, m2 and m3 after the commit, each restored with `git checkout --` | the row-8, row-1 and row-10 test fails, respectively; the restored file equals the committed one |
| A-10 | `bash -n infra/render-app-spec.sh`; shellcheck and actionlint if installed | exit 0; neither is installed on the lane machine (2026-10-31): say so |
| A-11 | `pnpm typecheck`, `pnpm lint`, `pnpm format:check` | exit 0 each |
| A-12 | `pnpm review:check:changed` before every commit; `pnpm review:check` at the end | exit 0 |
| A-13 | `git diff --name-only 5c225d89978eedfcbed32a66bd363ac7804bc894...HEAD` and the hunk headers of every partly-owned file | exactly the files of 2.4 plus this record; each partly-owned file only in its named lines |
| A-14 | the diff of the two workflows | one added env line each, in the render step; the rollback jobs unchanged |
| A-15 | the lane's final checks | B3 within 160-230; attribution 0; closing keywords 0; clean porcelain |

## 5. Verification and review

One opus reviewer role, at most 3 rounds counting pre-push rounds, plus one opus security round on the threat model (section 7); they may run together on one committed HEAD when no writer is live. The last round follows the L44 policy: a P3 or lower, a docs- or comment-only fix, is labelled "fix applied after the final round, not re-reviewed (3-round cap)"; a P1 or P2, or any code change, becomes ruling request RQ-L84-R3 and an AWAIT. STOP: a HALT if the diff leaves the file ownership; a ruling request if a row of the decision table cannot hold without an app change or an unowned file; a classifier denial is an AWAIT with the exact commands; BLOCKED on 3 failed rounds. CI runs the full suite on one push. No local DB run: no DB-touching change. The clerk does not merge: four deploy-guard files make it an owner merge, and the conductor gives the owner the exact merge command.

## 6. Budget (B3) and files

B3 about 180 owned-diff lines (range 160-230): renderer about 23, test about 77, specs about 20, workflows 2, docs about 56. The per-file estimates of 2.4 sum to about 185 (D4's four comment lines and the T:170 line), within the range. 0 migrations; no migration slot; the DB/e2e lock is not needed. Runs: 2 likely, 3 worst (cap 3). One PR: the runbook stays with the renderer (one feature).

Amendment 2026-10-31 (RO-L84-2): the file ownership adds docs/runbooks/migration-on-deploy-and-rollback.md and gains number-only line-cite edits, with no wording change, on living-doc lines whose cite this lane's diff moved: docs/runbooks/staging-deploy.md in any section, the cites of docs/runbooks/migration-on-deploy-and-rollback.md and the renderer cites of docs/runbooks/env-manifest-staging-production.md; it also gains two rows at the end of docs/autopilot-backlog.md.

## 7. Security notes for the security round

Threat model: the adversary is a mistake, not a motivated attacker. The owner, the DigitalOcean Control Panel and the owner-set GitHub variables are trusted.

- A deploy that silently switches an environment's root (stored ciphertexts stop opening, auth hashes stop matching, clubs reconnect): KEY_ROOT has no default (row 1, m2); the agreement guard compares the LIVE KMS_PROVIDER as well as the rendered one (row 8, m1); the K1 rule in RB; K3 explains why a switch also deletes the other set's live values.
- A render that lets the non-chosen set through or drops a chosen-set secret: the two closed lists in R; T's hard-coded per-set oracle checks every rendered `<KEY> <TYPE>` list and count (rows 3 and 5); `fill` is unchanged (rows 4 and 6).
- A KEY_ROOT that defaults or accepts an unknown value: rows 1-2, exact string equality, m2.
- A creation copy left with `__KMS_PROVIDER__`: the guard's live side (row 8 (c)); the rendered side stays covered by :79-81.
- A jq error that quotes a live ciphertext: the new code raises only `render: ` messages naming a component or a key; the `catch` (:99) is unchanged; the live side is read with `arrays` (as :46), so a wrong-shaped live surface reads as "differs", never as a jq error quoting it.
- A committed SECRET carrying a value: the type/value check runs over both sets before the drop (row 10, m3).
- The credential surface is otherwise unchanged: the same secrets are copied from the same live components, ENCRYPTION_KEY is a name only (its value is entered by the owner in DigitalOcean), and no new component or job appears.
- Merge consequence: after the merge every deploy needs `vars.KEY_ROOT` in its environment; a missing one stops at the render (row 1), before `doctl apps update` (no app mutation; the earlier doctl calls are the read-only `apps spec get` and the registry steps). The owner sets it at 8.5, before the first deploy under this code.

## 8. Open

0 in scope. The two unmeasured premises of 2.1 (K3: an update drops the omitted live envs, an inference; doctl accepting valueless SECRETs at create, handled at RB:52) are premises, not open questions: neither changes the design or a test.

## 9. Hard dependencies and backlog rows

None unmerged: this is the root slice. `5c225d89978eedfcbed32a66bd363ac7804bc894` (PR 154's merge, which carries DD-158) is the base. No other lane runs and no PR is open; the DB/e2e lock is not needed. Backlog rows: at most 3 at the END, by W2 (2.6).

## 10. Closure matrix (12 of 12 PASS)

| # | Gate | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Authority snapshot pinned by SHA | `AUTHORITY_SHA` = the worktree HEAD = the base; section 1 | PASS |
| 2 | Decisions in scope final | DD-158 (:1822-1828) and the owner's answer of 08:06; D1 by the conductor, Tier B; in-lane defaults D2-D7 (section 3) | PASS |
| 3 | Scope IN/OUT and owner clear | the lane's file ownership and negative scope (2.4; the verdict's IN_SCOPE and OUT_OF_SCOPE); A-13, A-14 | PASS |
| 4 | Dependencies classified | section 9 | PASS |
| 5 | Live schema and code match | section 2.1, measured at the base; no schema change | PASS |
| 6 | Data, API, state, auth contract | the same secrets copied from the same components; the closed sets and the guard (2.2); SR untouched (2.4) | PASS |
| 7 | Fail-closed, idempotency, order | the order of 2.2; rows 1-11 (2.3); the render stays a pure function of its inputs | PASS |
| 8 | Open questions in scope = 0 | section 8 | PASS |
| 9 | Acceptance matrix with expected results | section 4 (A-1..A-15) | PASS |
| 10 | Migration, security, rollback | no migration; one security round on section 7; rollback = revert the merge commit while no environment holds real data under the local root (after that, a revert is a root switch under the K1 rule and needs its own lane) | PASS |
| 11 | First slice hard dependencies merged | W1 depends on nothing unmerged (section 9) | PASS |
| 12 | Implementation handoff ready | sections 2.2-2.6 and 4: the renderer's order, the lists, the guard, the specs, the workflows, the tests, the docs | PASS |

## 11. Verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: CODE_READY
REVIEWED_AT: 2026-10-31
AUTHORITY_SHA: 5c225d89978eedfcbed32a66bd363ac7804bc894
BASE_BRANCH: main
TARGET_FILES:
  - infra/render-app-spec.sh (edited: KEY_ROOT, the drop, the KMS_PROVIDER placeholder, the agreement guard, the comments)
  - infra/render-app-spec.test.mjs (edited: KEY_ROOT, the per-set oracle, fakeLive, the loop, rows 1-11)
  - infra/app.staging.yaml (edited: the header comments in place, the KMS_PROVIDER value, ENCRYPTION_KEY on web and worker)
  - infra/app.prod.yaml (edited: the header comments in place, the KMS_PROVIDER value, ENCRYPTION_KEY on web and worker)
  - .github/workflows/deploy-staging.yml (edited: one env line in the render step)
  - .github/workflows/deploy-production.yml (edited: one env line in the render step)
  - docs/runbooks/env-manifest-staging-production.md (edited: the lines of section 2.4)
  - docs/runbooks/staging-deploy.md (edited: sections 2.4 and 2.5 (3)-(5), one K1-rule paragraph, the cite shifts)
  - docs/standards/environments-setup.md (edited: lines 389-390 and 418 only)
  - .env.example (edited: the comments at lines 128-136 only)
  - docs/runbooks/go-no-go-template.md (edited: lines 67 and 73 only)
  - docs/runbooks/pilot-club-host-onboarding.md (edited: line 21 only)
  - docs/autopilot-backlog.md (edited: at most 3 new rows at the end)
  - packages/db/src/secret-key-root.ts (read-only: both roots, the label, the lazy cache)
  - docs/standards/decisions.md (read-only: DD-158)
SLICE: p5-kms-root-key-choice
IN_SCOPE: the renderer's KEY_ROOT input, drop, placeholder and agreement guard; its tests; both App Specs (header comments, the KMS_PROVIDER value, ENCRYPTION_KEY on web and worker); one env line in each deploy workflow's render step; the docs lines of section 2.4; at most 3 backlog rows; this record
OUT_OF_SCOPE: packages/** (secret-key-root.ts, connector-crypto.ts, gender-crypto.ts), apps/**, infra/entrypoint.sh, the Dockerfile, the rollback jobs, decisions.md, the PLAN, dated session docs; any env other than the key-root set; any DB, docker or network in tests; setting a GitHub variable or running doctl; any secret value
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: PASS
HARD_DEPENDENCIES: none unmerged; 5c225d89978eedfcbed32a66bd363ac7804bc894 (PR 154's merge, carrying DD-158) is the base
PRIOR_SLICES: L66 (the App Specs, PR 150), L67 (the deploy workflows, PR 152) and L83 (DD-158, PR 154), all merged and in the base
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: none # the owner sets KEY_ROOT per environment at 8.5; a deploy without it stops at the render (row 1)
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS # no migration; one security round (opus) on section 7
IMPLEMENTATION_ARTIFACTS: PASS
FIRST_IMPLEMENTATION_STEP: W1 edits the renderer (2.2), both App Specs and both workflows, then the tests (2.5), runs A-1..A-12, commits in the worktree and runs m1-m3; W2 then writes the docs (2.6)
REMAINING_BLOCKERS: none
```
