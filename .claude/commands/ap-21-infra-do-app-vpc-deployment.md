# AP-21 — DigitalOcean App Platform + VPC deployment

Read the canonical `/Users/maingocanh/Projects/Claude template/autopilot/autopilot-prompt-GENERIC.md`
and confirm v0.6.0 or newer; then verify the repo mirror
`docs/autopilot-templates/autopilot-prompt-GENERIC.md` is not older. Execute the task contract in
`docs/autopilot-infra-do-app-vpc-deployment.md` with manifest
`docs/autopilot-manifests/infra-do-app-vpc-deployment.json`.

Before any feature work:

1. Confirm these artifacts are committed on and pushed to `main`.
2. Register the manifest.
3. Create `.autopilot/worktrees/infra-do-app-vpc-deployment` from named base `main`; verify both SHAs match.
4. Enter that worktree and create the required counter files.
5. Execute the DD-04 §7.1 evidence gate before writing either App Spec.

This is P1/manual-only: two consecutive FULL-base clean Codex rounds, verify green, then scope-gate READY
and STOP. Do not provision resources, upload secrets, change DNS/webhooks, merge, or push `main`.

Begin with Pre-flight, then Step 1.
