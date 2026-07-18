# AP-21 — DISABLED: P0 DigitalOcean deployment wiring

HALT immediately. Do not register a manifest, create/edit files, create a branch, or run codegen.

Canonical `autopilot-prompt-GENERIC` v0.6.0 classifies scopes touching migrations or secrets as P0. The AP-21
contract orchestrates a migration job and secret-bearing database/deploy configuration, so unattended
autopilot is prohibited even though the files are infrastructure configuration rather than application code.

The only current safe launcher is `/ap-22-infra-egress-compatibility-evidence`, which edits one documentation
file to close DD-04 §7.1 evidence and still stops at manual merge. AP-22 completion does not promote AP-21 out
of P0. AP-21 requires a separately authorized manual workflow and bounded manual slices.
