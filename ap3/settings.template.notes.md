# settings.template.json — key sources

JSON has no comments; this file cites where each key was verified. Sources: the installed
`claude` 2.1.177 (`claude --help`) and the official docs on 2026-09-09
(`https://code.claude.com/docs/en/{sandboxing,settings,hooks}` — `docs.claude.com/...` 301-redirects
there). W1.1 (2026-09-10): `install.sh` resolves this file (or the project's `settings.<project>.json`)
into a tracked, per-run `ap3/writer-settings.json`, and the dispatcher hands it to the writer with
`claude --settings` — it is NOT merged into the target's repo-wide `.claude/settings.json` (see
`W1.1-HANDOVER.md`). The old opt-in `install.sh --repo-wide` path that did that merge was removed
2026-09-10 after three clean wave-2 runs proved the per-run contract sufficient on its own.

| Key | Verified | Meaning |
|---|---|---|
| `sandbox.enabled` | sandboxing | Turn on the OS Bash sandbox (Seatbelt on macOS). |
| `sandbox.failIfUnavailable` | sandboxing | Fail closed: if the sandbox can't start (missing deps / unsupported platform) HALT instead of the default "warn and run UNSANDBOXED". Required for an unattended writer — its whole safety is the sandbox. |
| `sandbox.allowUnsandboxedCommands` | sandboxing | `false` = Strict sandbox mode: disable the unsandboxed-retry escape hatch; `dangerouslyDisableSandbox` is ignored and every command must run sandboxed (or be in `excludedCommands`). Closes the escape W1-DECISION probe 5 tried. |
| `sandbox.autoAllowBashIfSandboxed` | sandboxing | A sandboxable command runs without a prompt; one that can't be sandboxed falls back to the permission rules. |
| `sandbox.excludedCommands` | sandboxing | Commands that run outside the sandbox. Empty until a probe proves one is needed (e.g. the codex pin — probe 2 decides). |
| `sandbox.network.allowedDomains` | sandboxing | Egress allow-list. github/npm only — the writer does not call Codex (the dispatcher does, unsandboxed). |
| `sandbox.filesystem.denyRead` | sandboxing | OS-enforced for child processes — the real block on `~/.ssh`, `~/.aws`, `~/.gnupg`, `**/.env*`, and `**/ap3/env` (2026-10-19: `**/.env*` never matches a file named `env`, so without it the writer's Bash could `cat` the dispatcher's env file). The `Read(...)` deny rules below only cover Claude's own tool. |
| `permissions.allow` / `permissions.deny` | settings, permissions | Tool + `Bash(...)`/`Read(...)` glob rules. Under `--permission-mode dontAsk` anything not allowed is denied and logged in `permission_denials`, never prompted. The writer does coding only — no `gh`, no `codex`, `git push` denied; the dispatcher owns push/PR/review. See `W1-DECISION-codex-sandbox.md`. `Read(//**/ap3/env)` (2026-10-18): `//` anchors the rule at the filesystem root, so the target's `ap3/env` is denied to the Read tool whatever the session's cwd (the writer runs in a worktree, where `./ap3/env` never matched the real file). |
| `hooks.PreToolUse` matcher `Edit\|Write\|MultiEdit` | hooks | Runs `scope-guard.sh` before every edit; a deny returns `{"hookSpecificOutput":{"permissionDecision":"deny",...}}` (exit 0) — or exit 2 also blocks. `install.sh` (`aplib.py writer_guard_problems`) accepts a matcher only when it is absent, `""` or `"*"`, or a plain `\|`-separated list of tool names (`[A-Za-z0-9_\|]+`) naming Edit, Write and MultiEdit; any other regex syntax is refused. |
| `hooks.Stop` | hooks | Runs `finish-guard.sh`; exit 2 keeps the session going until the writer writes `.ap3-run/READY-FOR-REVIEW` (the dispatcher then runs the review + opens the PR) or `.ap3-run/HALT.md`. Guarded by `stop_hook_active`. |

Verified separately and recorded in `probes/RESULTS.md` / `docs/level3-native/W1-HANDOVER.md`:

- `--permission-mode` accepts `dontAsk` (choices: acceptEdits, auto, bypassPermissions, default,
  **dontAsk**, plan). `--max-budget-usd`, `--output-format json`, `--model` exist.
- **`--max-turns` does NOT exist in 2.1.177.** DESIGN §4 and BUILD-PROMPT assume it; it is dropped.
  `--max-budget-usd` is the sole native per-run ceiling. (measurement wins over the contract.)
- Do not use `--bare` (skips hooks/skills/CLAUDE.md) or `--permission-prompts none` (needs ≥ 2.1.259).
