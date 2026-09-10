#!/usr/bin/env bash
# PreToolUse hook (Edit|Write|MultiEdit): deny an edit outside the running task's scope.
# No-op unless AP3_TASK points at the dispatched task file, so it never touches the
# owner's normal interactive sessions in the same repo. Logic + stdin parse live in
# aplib.py's `hook` subcommand (exec keeps the tool JSON on stdin intact).
set -euo pipefail
[ -n "${AP3_TASK:-}" ] && [ -f "${AP3_TASK:-}" ] || exit 0
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$DIR/../aplib.py" hook "$AP3_TASK"
