#!/usr/bin/env bash
# Post-deploy smoke against a deployed origin:  infra/smoke-check.sh https://<host>
# Unauthenticated and read-only by design: liveness JSON, the signed-out landing page
# and the PWA manifest.
set -euo pipefail
base="${1:?usage: smoke-check.sh <https://origin>}"
base="${base%/}"
case "$base" in https://*) ;; *) echo "smoke: origin must be https://" >&2; exit 1 ;; esac
# -q first: curl skips any .curlrc, which could add -L or -k behind this script's back.
curl_ok() { curl -q -fsS --max-time 15 --retry 6 --retry-delay 10 --retry-all-errors "$@"; }

health="$(curl_ok "$base/healthz")"
# Exactly one JSON document whose .ok is the boolean true (the string "true" fails; `-s` stops a second
# document from deciding the result); jq's stderr is dropped so no message quotes the body.
jq -es 'length == 1 and .[0].ok == true' >/dev/null 2>&1 <<<"$health" || { echo "smoke: /healthz field .ok is not true" >&2; exit 1; }
echo "ok /healthz"

# curl -f without -L passes a 3xx, so both checks below also require a 2xx status.
out="$(curl_ok -o /dev/null -w '%{http_code} %{content_type}' "$base/")"
code="${out%% *}"
ctype="${out#* }"
case "$code" in 2*) ;; *) echo "smoke: / returned HTTP $code" >&2; exit 1 ;; esac
case "$ctype" in text/html*) echo "ok / ($code $ctype)" ;; *) echo "smoke: / returned $ctype" >&2; exit 1 ;; esac

code="$(curl_ok -o /dev/null -w '%{http_code}' "$base/manifest.webmanifest")"
case "$code" in 2*) echo "ok /manifest.webmanifest ($code)" ;; *) echo "smoke: /manifest.webmanifest returned HTTP $code" >&2; exit 1 ;; esac
