#!/usr/bin/env bash
# Post-deploy smoke against a deployed origin:  infra/smoke-check.sh https://<host>
# Unauthenticated and read-only by design: liveness JSON, the signed-out landing page
# and the PWA manifest.
set -euo pipefail
base="${1:?usage: smoke-check.sh <https://origin>}"
base="${base%/}"
case "$base" in https://*) ;; *) echo "smoke: origin must be https://" >&2; exit 1 ;; esac
curl_ok() { curl -fsS --max-time 15 --retry 6 --retry-delay 10 --retry-all-errors "$@"; }

health="$(curl_ok "$base/healthz")"
[ "$(jq -r '.ok' <<<"$health")" = "true" ] || { echo "smoke: /healthz not ok: $health" >&2; exit 1; }
echo "ok /healthz"

ctype="$(curl_ok -o /dev/null -w '%{content_type}' "$base/")"
case "$ctype" in text/html*) echo "ok / ($ctype)" ;; *) echo "smoke: / returned $ctype" >&2; exit 1 ;; esac

curl_ok -o /dev/null "$base/manifest.webmanifest"
echo "ok /manifest.webmanifest"
