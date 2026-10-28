#!/usr/bin/env bash
# Block until the App Platform deployment that carries IMAGE_DIGEST is ACTIVE, or fail.
#   infra/wait-for-deployment.sh <app-id> <sha256:digest> [timeout-seconds=900]
# A deployment is "ours" when its spec's `web` image digest equals the digest we just rendered, so a
# concurrent deployment of something else is never mistaken for success. The PRE_DEPLOY `migrate`
# job runs inside this deployment: a failed migration ends the phase in ERROR (previous deployment
# keeps serving). Finally the app's active deployment must be that same id (not superseded).
# Needs: doctl (authenticated), jq.
set -euo pipefail

app="${1:?usage: wait-for-deployment.sh <app-id> <digest> [timeout]}"
digest="${2:?digest required}"
timeout="${3:-900}"
# Digits only, no leading zero: the arithmetic below would also evaluate an array subscript such as
# a[$(cmd)], and it reads a leading-zero constant as octal (010 is 8 seconds, 08 is an error).
[[ "$timeout" =~ ^(0|[1-9][0-9]*)$ ]] || { echo "wait: timeout must be whole seconds" >&2; exit 1; }
# The app id goes to doctl ahead of its flags, so a leading - would parse as a flag (an empty one
# already stopped at ${1:?} above). No --: doctl's handling of it is not confirmed.
case "$app" in -*) echo "wait: app id must not start with -" >&2; exit 1 ;; esac
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "wait: digest must be sha256:<64 hex>" >&2; exit 1; }
deadline=$(( $(date +%s) + timeout ))
dep=""
fails=0

while :; do
  # A transient doctl/jq failure must not abort the wait, but 5 CONSECUTIVE failures do (a dead token
  # or API must not burn the whole timeout); the deadline below also bounds the loop.
  # jq reads through a pipe, never a here-string: bash may spill a here-string to a temp file, and
  # $raw carries every listed deployment's spec.
  dep_json=""
  if raw="$(doctl apps list-deployments "$app" -o json 2>/dev/null)" \
     && dep_json="$(printf '%s' "$raw" | jq -c --arg d "$digest" '[.[] | select(any(.spec.services[]?; .name == "web" and .image.digest == $d))] | .[0] // empty')"; then
    fails=0
  else
    dep_json=""
    fails=$((fails + 1))
    [ "$fails" -lt 5 ] || { echo "doctl/jq failed ${fails}x consecutively" >&2; exit 1; }
    echo "doctl/jq failed (${fails}/5); retrying"
  fi
  if [ -n "$dep_json" ]; then
    dep="$(printf '%s' "$dep_json" | jq -r '.id')"
    phase="$(printf '%s' "$dep_json" | jq -r '.phase')"
    # doctl's JSON shape is not confirmed: a missing field stops at once, and failure messages name
    # the field, never a value read from doctl other than a terminal phase the `case` below matches
    # (an unknown phase VALUE keeps polling).
    case "$dep" in ""|null) echo "wait: deployment field .id missing" >&2; exit 1 ;; esac
    case "$phase" in ""|null) echo "wait: deployment field .phase missing" >&2; exit 1 ;; esac
    echo "deployment $dep phase=$phase"
    case "$phase" in
      ACTIVE) break ;;
      ERROR|CANCELED|SUPERSEDED) echo "wait: deployment field .phase is $phase" >&2; exit 1 ;;
    esac
  else
    echo "no deployment for $digest yet"
  fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo "wait: timed out after ${timeout}s waiting for $digest${dep:+ (deployment field .phase never ACTIVE)}" >&2; exit 1; }
  sleep 15
done

active="$(doctl apps get "$app" -o json | jq -r '.[0].active_deployment.id // empty')"
[ -n "$active" ] || { echo "wait: app field .[0].active_deployment.id missing" >&2; exit 1; }
[ "$active" = "$dep" ] || { echo "wait: app field .[0].active_deployment.id is not the awaited deployment (superseded?)" >&2; exit 1; }
echo "ACTIVE deployment=$dep digest=$digest"
