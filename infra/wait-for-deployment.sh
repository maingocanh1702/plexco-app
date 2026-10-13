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
deadline=$(( $(date +%s) + timeout ))
dep=""

while :; do
  dep_json="$(doctl apps list-deployments "$app" -o json \
    | jq -c --arg d "$digest" '[.[] | select(any(.spec.services[]?; .name == "web" and .image.digest == $d))] | .[0] // empty')"
  if [ -n "$dep_json" ]; then
    dep="$(jq -r '.id' <<<"$dep_json")"
    phase="$(jq -r '.phase' <<<"$dep_json")"
    echo "deployment $dep phase=$phase"
    case "$phase" in
      ACTIVE) break ;;
      ERROR|CANCELED|SUPERSEDED) echo "deployment $dep ended in $phase" >&2; exit 1 ;;
    esac
  else
    echo "no deployment for $digest yet"
  fi
  [ "$(date +%s)" -lt "$deadline" ] || { echo "timed out after ${timeout}s waiting for $digest" >&2; exit 1; }
  sleep 15
done

active="$(doctl apps get "$app" -o json | jq -r '.[0].active_deployment.id // empty')"
[ "$active" = "$dep" ] || { echo "active deployment is '$active', expected $dep (superseded?)" >&2; exit 1; }
echo "ACTIVE deployment=$dep digest=$digest"
