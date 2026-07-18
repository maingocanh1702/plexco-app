# Autopilot slice — DigitalOcean App Platform + VPC deployment

> **Slug:** `infra-do-app-vpc-deployment`  
> **Status:** P0 manual design contract · **AUTOPILOT CODEGEN PROHIBITED**  
> **Risk:** P0 · manual workflow only · no AP launcher/review loop  
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0  
> **Authority:** `dd-04-hosting-final-decision.md` Rev 2 + `standards/environments-setup.md` v2.1  
> **Manifest:** `docs/autopilot-manifests/infra-do-app-vpc-deployment.json`

## Policy gate

Canonical v0.6.0 classifies scope touching migrations or secrets as P0. This design necessarily coordinates a
one-shot migration and secret-bearing database/deploy configuration, so it must not be executed by unattended
autopilot. `.claude/commands/ap-21-infra-do-app-vpc-deployment.md` is intentionally disabled.

First close DD-04 §7.1 through the P2 docs-only `infra-egress-compatibility-evidence` slice. A compatible result
does not lower this contract's risk tier; implementation still requires separately authorized manual slices.

## Manual task authority

```text
Implement the first production-grade DigitalOcean deployment contract for Plexco without changing
application/domain behavior.

The green path is DigitalOcean App Platform + DigitalOcean Managed PostgreSQL primary/HA standby in
Singapore on the same VPC. One immutable OCI image runs three components: web, discovery, and worker.
Create reproducible production and ephemeral-staging App Specs plus an approval-gated deploy workflow.

This is NOT permission to provision paid resources, change DNS/webhooks, upload secrets, or deploy to
production. Stop at a reviewed, locally validated branch READY for founder merge and later execution.
```

## Negative scope

- No application, domain, auth, money, RLS-policy, migration, or schema behavior changes.
- No Kubernetes/DOKS, Terraform provider abstraction, new DB proxy, Redis, or second data store.
- No permanent staging environment and no permanent read-only node Day-1.
- No console-only configuration; every production control must be represented in App Spec/workflow/docs.
- No secret value in git, logs, App Spec literals, runtime image, or runtime-wide migration env.
- Do not modify provider-dependent business code because none should exist.

## Required reading

1. Canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md`
   and confirm v0.6.0 or newer before execution.
2. `docs/dd-04-hosting-final-decision.md`, especially §5 and §7.1–§7.6.
3. `docs/standards/environments-setup.md` v2.1 and `docs/standards/deployment-infra.md` §3–§9.
4. `docs/features/BE/feature_multi_tenant_tech.md` for four-role and migration-secret boundaries.
5. Current `infra/Dockerfile`, `infra/entrypoint.sh`, `.env.example`, and `.github/workflows/ci.yml`.
6. Current official DigitalOcean App Spec, VPC, autoscaling, encrypted-env, deployment, and spec-validation
   documentation. Use primary sources; record the exact URL/date used in the runbook evidence table.

## Pre-flight hard gate — close DD-04 §7.1 first

Before editing an App Spec, write evidence into the §1.1 table in `environments-setup.md` for SePay,
ApiPay, Zalo, and Messenger: whether server-to-server calls require a fixed outbound source IP.

- All four explicitly support dynamic egress or do not require source-IP allowlisting → proceed on DO VPC.
- Any confirmed fixed-egress requirement → write
  `.autopilot/state/infra-do-app-vpc-deployment/HALT-DESIGN_UNFIT.txt`, do not author DO App Specs,
  and report that the bounded Fly fallback must be re-sliced.
- Missing/ambiguous provider evidence → fail closed with the same HALT; do not infer compatibility.
- Never solve this gate by enabling dedicated egress and silently removing the private DB route.

## Implementation contract

### App Specs

- `infra/app.prod.yaml`: app name `plexco-prod`, Singapore region, one immutable image digest/tag, and
  explicit `web`, `discovery`, `worker` components using existing entrypoint roles.
- `infra/app.staging.yaml`: same component/DB-role shape, isolated names/endpoints, smallest safe resources,
  and TTL/destruction metadata consumed by the workflow. It must not point to production DB/secrets.
- Web and discovery start with two instances; worker starts with one. Health/readiness and rolling-deploy
  behavior must preserve webhook/SSE availability.
- Document accurately: request-rate/p95 autoscaling works on shared or dedicated compute; CPU-based
  autoscaling requires dedicated CPU. Do not promise an unsupported policy in the spec.

### Network and DB boundaries

- Bind app and Managed PostgreSQL to the same VPC/private route; trusted sources remain explicit.
- Component-scoped `DATABASE_URL`: `app` for web, `readonly` for discovery. Day-1 discovery points to the
  primary through a bounded pool; future read-only-node adoption changes this component value only.
- `DATABASE_URL_LISTEN` exists only on web; `DATABASE_URL_DIRECT` exists only on worker.
- `DATABASE_URL_MIGRATION` exists only in the approved one-shot deploy job. It must never be an App
  Platform app/component secret or runtime env.
- No runtime role is owner/superuser/BYPASSRLS. TLS CA/hostname verification remains enabled even on VPC.

### Deploy workflow

- Add `.github/workflows/deploy.yml`; do not overload ordinary PR CI with production authority.
- Use immutable build provenance. Staging deploy/verify precedes production promotion of the exact artifact.
- Production requires the repository environment approval boundary.
- Ordered one-shot DB preparation: run migration runner first, then existing `provision`/pg-boss setup.
- Run smoke/role/RLS/public-projection/SSE reconnect/pg-boss no-duplicate checks before promotion.
- Include explicit ephemeral-staging destroy and a safe TTL cleanup path.
- Do not run the workflow or call paid/provider mutations in this slice.

### Fly fallback file

Keep `infra/fly.toml` as a clearly marked bounded fallback, not a competing primary deployment. It must say
that activation requires a separate fallback slice with static egress, trusted-source allowlist, and
`sslmode=verify-full`; it must not claim cross-cloud private networking.

## Verification

1. Parse both App Specs and workflow YAML with a deterministic validator.
2. Run the current official non-provisioning DigitalOcean checks on **both** specs:
   `doctl apps spec validate <spec-file>` (local/schema + remote correctness unless `--schema-only`) and
   `doctl apps propose --spec <spec-file>` (review/validate/cost proposal). Record `doctl version`, output and date;
   these commands validate/propose only — do not call `apps create/update` in this slice.
3. Add static assertions that:
   - no spec/workflow contains a literal secret;
   - no runtime component contains `DATABASE_URL_MIGRATION`;
   - web/discovery/worker receive only their permitted DB variables;
   - staging and production identifiers/endpoints cannot cross;
   - migration precedes queue provisioning;
   - production promotion has an approval environment and exact-artifact input.
4. Start the throwaway local PostgreSQL service, require `DATABASE_URL_TEST` to point to `plexco_test`, then
   run `pnpm install --frozen-lockfile`, `pnpm -w typecheck`, `pnpm -w lint`, `pnpm -w test`, and
   `pnpm -w build`. Never use a development, staging, or production database for the suite.
5. Run `git diff --check` and confirm the diff is non-empty and limited to manifest scope.

## Manual review and stop condition

Do not register this P0 manifest or invoke AP-21. A founder-authorized manual implementation must be split by
mechanism, preserve the full verification contract above, and stop before any provider mutation, secret upload,
DNS/webhook change, or spend unless those external actions are separately and explicitly authorized.
