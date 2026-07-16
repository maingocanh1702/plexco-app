# Plexco — Review Fix Closure

> **Date:** 2026-07-16  
> **Scope:** Consolidated record of the code, documentation, CI/security, dependency and financial-model fixes completed after the full repository review.  
> **Repository state:** Local `main`, ahead of `origin/main` by 1 commit at the time of closure. The changes below are local and have not been committed or pushed by this task.

## 1. Outcome

All actionable defects found by the review were fixed and re-verified locally.

- Trusted client-IP resolution is provider-pinned and fail-closed in production.
- CI now runs the complete install/format/typecheck/lint/build/test gate.
- A separate security workflow covers SAST and dependency vulnerabilities.
- Known vulnerable dependency versions were removed or overridden to maintained versions.
- The Drizzle upgrade remains compatible with the real PostgreSQL/RLS suite.
- Documentation now separates implemented reality, design readiness and future roadmap work.
- The SaaS P&L model no longer presents zero-placeholder COGS as a valid margin forecast.
- The complete local verification suite is green.

This closure makes the current foundation safe to continue from. It does **not** mean that the unimplemented feature roadmap or external production-readiness evidence is complete.

## 2. Trusted ingress and authentication rate limiting

### Problem closed

The previous resolver accepted more than one forwarding-header convention and could fall back to `X-Forwarded-For`. When the actual ingress does not overwrite every accepted header, a client can influence its rate-limit identity.

### Implementation

`apps/web/lib/session-cookies.ts` now defines an explicit provider contract:

```ts
type TrustedIngressProvider = "digitalocean" | "fly" | "direct";
```

- `digitalocean` trusts only `do-connecting-ip`.
- `fly` trusts only `fly-client-ip`.
- `direct` is local/non-production only and ignores forwarding headers.
- Production without an explicit supported provider throws immediately.
- Production explicitly configured as `direct` also throws.
- Missing, malformed or multi-value trusted headers collapse into one bounded provider-specific `untrusted` bucket.
- The resolver never falls back to `X-Forwarded-For` or another provider's header.

Configuration was propagated to:

- `.env.example`: local default `TRUSTED_INGRESS_PROVIDER=direct` plus production guidance.
- `infra/fly.toml`: bounded Fly fallback sets `TRUSTED_INGRESS_PROVIDER=fly`.
- `docs/standards/environments-setup.md`: DigitalOcean public HTTP components must set `digitalocean`.

### Regression coverage

`apps/web/lib/session-cookies.test.ts` now covers:

1. DigitalOcean reads only its own header.
2. Cross-provider and `X-Forwarded-For` spoofing are ignored.
3. Malformed and comma-separated values are rejected.
4. Fly reads only its own header.
5. Direct mode returns the local bucket.
6. Missing production provider is rejected.
7. Production direct mode is rejected.
8. Unknown providers are rejected.
9. Explicit production provider resolution succeeds.

Telegram auth state/callback route tests now use the DigitalOcean contract and explicitly set the provider.

GitNexus reported a **LOW** blast radius for the resolver change: two direct auth-route callers, with the affected state/callback processes covered by the updated tests.

## 3. CI and security gates

### Main CI

`.github/workflows/ci.yml` now runs, in order:

1. PostgreSQL service health check.
2. `pnpm install --frozen-lockfile`.
3. Workspace typecheck.
4. Full-repository format check.
5. ESLint.
6. Production build.
7. Full workspace test suite with the real PostgreSQL/RLS harness.

GitHub actions are pinned to immutable commit SHAs rather than mutable tags:

- `actions/checkout` v4.
- `pnpm/action-setup` v4.
- `actions/setup-node` v4.

The existing `.github/workflows/linear-sync.yml` action references were pinned as well.

### Security workflow

New file `.github/workflows/security.yml` adds:

- Semgrep CE on pull requests, merge queue, pushes to `main`, schedule and manual dispatch.
- OSV dependency-diff scanning for pull requests/merge queue.
- OSV full dependency scanning for pushes, schedule and manual dispatch.
- Pinned Semgrep container digest.
- Pinned OSV reusable-workflow SHA.
- Read-only repository permissions.
- SARIF upload disabled because this private repository does not currently have GitHub Advanced Security enabled.

Remote workflow runs become durable release evidence only after these local files are committed and pushed.

## 4. Dependency and supply-chain closure

### Direct upgrades

`packages/db/package.json`:

- `drizzle-orm`: `^0.38.4` → `^0.45.2`.
- `drizzle-kit`: `^0.30.2` → `^0.31.10`.

`pnpm-lock.yaml` was regenerated and verified with a frozen install.

### Transitive security floors

`pnpm-workspace.yaml` now enforces:

```yaml
minimumReleaseAge: 10080
trustPolicy: no-downgrade
blockExoticSubdeps: true

overrides:
  "esbuild@<0.25.0": 0.25.12
  "postcss@<8.5.10": 8.5.16
```

This closes the OSV findings previously reported for:

- `drizzle-orm 0.38.4`.
- `esbuild 0.18.20` / `0.19.12`.
- `postcss 8.4.31`.

The final resolved dependency graph contains `drizzle-orm 0.45.2`, maintained `esbuild` versions and `postcss 8.5.16`.

### Static-analysis closure

- `compare-linear.mjs` now uses a constant console format string.
- The two dynamic regular expressions in `packages/core/src/matching.ts` retain explicit Semgrep suppressions only at the exact lines where interpolated values are first escaped by `escapeRegExp`.
- No security rule was globally disabled.

GitNexus reported **LOW** blast radius for both matching symbols; the existing matching suite remained green.

## 5. PostgreSQL/RLS compatibility after Drizzle upgrade

Drizzle 0.45 wraps the underlying PostgreSQL error in `Error.cause`. Two RLS assertions previously checked only the top-level generic query message, even though PostgreSQL still rejected both cross-tenant writes correctly.

`packages/db/src/rls-invariants.test.ts` now uses `expectErrorChainToMatch` for Drizzle-backed rejection paths. The helper:

- requires an actual `Error` rejection;
- walks the complete non-cyclic `Error.cause` chain;
- asserts that the real PostgreSQL `row-level security` message remains present;
- does not treat a generic rejection as sufficient.

The raw `pg` assertion remains unchanged. This preserves the fail-closed semantic guarantee rather than weakening the tests to accommodate a library upgrade.

## 6. Documentation reconciliation

The closure updated the documentation graph so that implementation status and build readiness are not overstated.

### Updated authority/status files

- `docs/features/README.md`
  - Corrected current feature/spec versions.
  - Multi-tenant product spec now points to v1.5.
- `docs/standards/BUILD-STATUS.md`
  - Records the current 223-test green suite.
  - Clarifies that docs/schema readiness is not feature implementation readiness.
  - Preserves B0–B3 and DD-49 design-probe boundaries.
- `docs/standards/environments-setup.md`
  - Records the trusted-ingress production contract.
  - Documents the real CI and security gates.
- `docs/pre-code-open-items-2026-07-16.md`
  - D2: canonical PostgreSQL suite closed.
  - D3: formatting/build closure recorded.
  - D7: DD-49..56 propagation recorded against current decisions v1.39.
  - D8: trusted-ingress and CI/security closure recorded.
  - D9: `phase1-fable5` retained as a read-only forensic worktree.

### Retained forensic worktree

`.autopilot/worktrees/phase1-fable5` has no unique implementation commit and its branch is already contained in `origin/main`, but its ignored `.autopilot/state/**` files are referenced by auth/security documentation.

Therefore:

- it is not a base for new work;
- it remains read-only;
- it must not be removed with a bare `git worktree remove`;
- cleanup is allowed only after referenced evidence is archived or migrated and the normal `ap-finish` flow can run safely.

## 7. SaaS P&L model closure

Updated workbook:

`docs/strategy/saas-pnl-model.xlsx`

### Problem closed

Variable provider/support COGS was still a zero placeholder while contribution and margin outputs appeared numerically valid. This could make the model look materially more profitable than the sourced inputs justified.

### Implementation

- Added visible `MODEL STATUS` to Assumptions and Checks.
- If the COGS input remains unresolved/zero:
  - revenue sensitivity remains available;
  - contribution, contribution margin and downstream margin outputs return `REVIEW`;
  - checks explain that the model is revenue-sensitivity-only.
- Cross-sheet formulas were normalized and quoted correctly.
- Labels and source notes now distinguish usable revenue sensitivity from blocked profit forecasting.
- The Sources sheet explicitly records why COGS-dependent outputs are gated.

### Workbook verification

- Formula error scan: 0 errors.
- All four sheets rendered and visually inspected.
- No severe clipping or illegible layout found.
- No temporary `.xlsx.inspect.ndjson` artifact remains in the repository.

The workbook is intentionally still `REVIEW` until defensible provider/support COGS is sourced. That is a data-input gate, not an unresolved spreadsheet defect.

## 8. Final verification evidence

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Pass |
| `pnpm format:check` | Pass |
| `pnpm lint` | Pass |
| Workspace typecheck | Pass |
| Next.js production build | Pass |
| Core tests | 111/111 pass |
| DB/RLS/auth tests | 44/44 pass |
| Web tests | 65/65 pass |
| Bot tests | 3/3 pass |
| Full suite | **20 files / 223 tests pass** |
| OSV dependency scan | **No issues found** |
| Semgrep tracked source scan | **0 findings** |
| Semgrep explicit new-workflow scan | **0 findings** |
| GitHub workflow YAML parse | Pass |
| Fly TOML parse | Pass |
| `git diff --check` | Pass |
| PostgreSQL test container | Stopped after verification |

The final GitNexus scan over the entire dirty working tree reported **medium** aggregate risk across the pre-existing broad WIP, but mapped only one affected execution flow (`GET → AppDb`) from the changed runtime symbols. The specific runtime symbols changed by this closure were individually assessed as LOW blast radius and are covered by targeted plus full-suite tests.

## 9. Files intentionally changed by this closure

### Runtime and tests

- `apps/web/lib/session-cookies.ts`
- `apps/web/lib/session-cookies.test.ts`
- `apps/web/app/api/auth/telegram/state/route.test.ts`
- `apps/web/app/api/auth/telegram/callback/route.test.ts`
- `packages/db/src/rls-invariants.test.ts`
- `packages/core/src/matching.ts`
- `compare-linear.mjs`

### Dependency and configuration

- `.env.example`
- `packages/db/package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `infra/fly.toml`

### Automation

- `.github/workflows/ci.yml`
- `.github/workflows/linear-sync.yml`
- `.github/workflows/security.yml` — new file

### Documentation and model

- `docs/features/README.md`
- `docs/standards/BUILD-STATUS.md`
- `docs/standards/environments-setup.md`
- `docs/pre-code-open-items-2026-07-16.md`
- `docs/strategy/saas-pnl-model.xlsx`

This list is the closure scope, not the complete current `git diff`; the working tree already contained extensive user WIP before this task.

## 10. Remaining boundaries before more feature code

These are intentional project gates or future implementation work, not defects left by this closure:

1. Run B0 auth proof/lifecycle design probe before authoring provider replacement code.
2. Split S4 into mechanism-named slices:
   - shared account/session core;
   - Google OAuth adapter;
   - complete email credential lifecycle;
   - expand/contract removal of Telegram-era runtime after consumers move.
3. Do not open one auth mega-slice or enable an incomplete email lifecycle.
4. Preserve B1/B2/B3 and DD-49 correction boundaries before money/session/sync mutations.
5. Complete external/legal/provider evidence before the related go-live gates.
6. Enter sourced provider/support COGS before using P&L contribution or margin outputs for planning.
7. Obtain remote CI/Security evidence after an intentional per-file commit and push.

## 11. Git/worktree caution

Immediately before this report was created, the root working tree contained:

- 85 tracked modified files;
- 13 untracked paths;
- local `main` ahead of `origin/main` by 1 commit.

This report itself adds one additional untracked Markdown file until staged. Do not use `git add -A`. Any later commit must stage the intended files explicitly and preserve unrelated WIP.

## 12. External references used for the closure

- DigitalOcean real client IP header: <https://docs.digitalocean.com/support/where-can-i-find-the-client-ip-address-of-a-request-connecting-to-my-app/>
- pnpm 10.x workspace/security settings: <https://pnpm.io/10.x/settings>
- OSV Scanner GitHub Action: <https://google.github.io/osv-scanner/github-action/>
- Semgrep CI configuration: <https://semgrep.dev/docs/semgrep-ci/sample-ci-configs>

## 13. Post-review verification addendum (2026-07-16)

Independent re-verification of this report against the working tree, plus closure of the three review findings:

1. **pnpm supply-chain keys — VERIFIED VALID, with the pnpm 10 boundary stated exactly.** Repo pins `pnpm@10.30.2`; the version-matched pnpm 10.x documentation confirms: `minimumReleaseAge` was added in v10.16.0 and delays resolution of direct and transitive releases younger than the configured age; `trustPolicy` was added in v10.21.0 and `no-downgrade` rejects a package whose trust evidence is weaker than an earlier-published version; `blockExoticSubdeps` was added in v10.26.0, defaults to `false` in pnpm 10, and is enabled here explicitly with `true`. pnpm 10 does **not** provide the pnpm 11 `minimumReleaseAgeStrict` setting, so this report makes no strict-fallback claim. These are dependency-resolution guards; OSV separately audits the resolved lockfile already present in the repository.
2. **GitHub Action SHA pins — VERIFIED chính chủ** via `git ls-remote --tags` (2026-07-16): `actions/checkout@34e11487…` = **v4.3.1** · `pnpm/action-setup@b906affc…` = **v4.3.0** (peeled annotated tag) · `actions/setup-node@49933ea5…` = **v4.4.0** · `google/osv-scanner-action@9a498708…` = **v2.3.8** (exact). Workflow comments updated from generic `# v4` to exact verified tags. Semgrep image is content-addressed by digest within the official `semgrep/semgrep` repository.
3. **Report location:** verified under `docs/` (this file) so the closure record ships with the docs tree; commit per-file as §11 instructs (no `git add -A`).

Spot-check matrix from the independent review (all ✅): resolver contract in `session-cookies.ts:131-170` + env/fly propagation; `ci.yml` postgres service + `DATABASE_URL_TEST` + gate order; `security.yml` pinned digest/SHA; lockfile resolves `drizzle-orm@0.45.2` / `esbuild@0.25.12` / `postcss@8.5.16` (overrides effective); `nosemgrep` only at the two `escapeRegExp`-guarded lines; `expectErrorChainToMatch` retains `/row-level security/` assertion; BUILD-STATUS 223-test evidence; tracker D8/D9; `feature_multi_tenant.md` v1.5 matches index; test-count arithmetic internally consistent (web 56→65 = +9 new resolver tests; full 214→223).

Known accepted tradeoff: missing/malformed trusted headers collapse into one bounded `untrusted` bucket per provider — fail-closed by design; legitimate traffic behind a broken ingress shares that rate-limit bucket.
