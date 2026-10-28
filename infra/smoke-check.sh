#!/usr/bin/env bash
# Post-deploy smoke against a deployed origin:  infra/smoke-check.sh https://<host>
# A thin adapter of scripts/smoke-predeploy.mjs, the ONE smoke definition (liveness JSON, the
# signed-out landing page and the PWA manifest; unauthenticated, read-only, never a body printed).
set -euo pipefail
base="${1:?usage: smoke-check.sh <https://origin>}"
base="${base%/}"
case "$base" in https://*) ;; *) echo "smoke: origin must be https://" >&2; exit 1 ;; esac
# Needs node and this checkout. The WHOLE smoke runs up to 7 times, 10 s apart, each request capped
# at 15 s (L65's 1 + 6 retries, 10 s delay, 15 s per request). Exit 0 only on a pass; after the 7th
# failed try, the smoke's own code (1 a failed check, 2 a bad invocation).
smoke="$(dirname "${BASH_SOURCE[0]}")/../scripts/smoke-predeploy.mjs"
rc=1
for try in 1 2 3 4 5 6 7; do
  if SMOKE_BASE_URL="$base" SMOKE_TIMEOUT_MS=15000 node "$smoke"; then exit 0; else rc=$?; fi
  if [ "$try" -lt 7 ]; then sleep 10; fi
done
exit "$rc"
