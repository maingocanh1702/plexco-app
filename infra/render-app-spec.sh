#!/usr/bin/env bash
# Render a committed App Spec (JSON form) into the spec `doctl apps update --spec` receives.
#
#   yq -o=json infra/app.staging.yaml \
#     | IMAGE_DIGEST=sha256:<64 hex> VPC_ID=<uuid> [APP_DOMAIN=<host>] \
#       infra/render-app-spec.sh <live-spec.json> > rendered.json
#
# <live-spec.json> is `doctl apps spec get <app-id> --format json`. Contract:
#  1. Placeholders __IMAGE_DIGEST__ / __VPC_ID__ / __APP_DOMAIN__ are replaced from the environment,
#     each validated by shape (a malformed digest must never reach the spec).
#  2. Every `type: SECRET` entry in the committed spec carries NO value. Its value is copied from the
#     same component + key in the live spec (already DO-encrypted EV[...]). If the live app lacks it
#     the render FAILS and names the secret: a deploy must never silently drop or blank a secret.
#  3. A committed spec that still contains a __PLACEHOLDER__ after substitution fails.
# No secret value is ever read from or written to anything but the live spec. Needs: bash 3.2+, jq.
set -euo pipefail

live="${1:?usage: render-app-spec.sh <live-spec.json> < committed.json}"
digest="${IMAGE_DIGEST:?IMAGE_DIGEST is required}"
vpc="${VPC_ID:?VPC_ID is required}"
domain="${APP_DOMAIN:-}"

[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "render: IMAGE_DIGEST must be sha256:<64 hex>" >&2; exit 1; }
[[ "$vpc" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "render: VPC_ID must be a UUID" >&2; exit 1; }
if [ -n "$domain" ]; then
  [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "render: APP_DOMAIN is not a hostname" >&2; exit 1; }
fi

jq --slurpfile live "$live" --arg digest "$digest" --arg vpc "$vpc" --arg domain "$domain" '
  # Live spec envs for a component, keyed "<kind>/<name>/<ENV_KEY>".
  def liveSecrets:
    [ ("services", "workers", "jobs") as $k | ($live[0][$k] // [])[] | . as $c | ($c.envs // [])[]
      | select(.type == "SECRET" and (.value // "") != "")
      | { key: "\($k)/\($c.name)/\(.key)", value: .value } ] | from_entries;
  liveSecrets as $ls
  | def fill($kind): . as $c | .envs = [ ($c.envs // [])[] |
      if .type == "SECRET" and (.value // "") == ""
      then ($ls["\($kind)/\($c.name)/\(.key)"]) as $v
           | if $v == null then error("missing secret in live app: \($kind)/\($c.name)/\(.key) - set it in DO first")
             else . + {value: $v} end
      else . end ];
  .services |= (. // [] | map(fill("services")))
  | .workers |= (. // [] | map(fill("workers")))
  | .jobs    |= (. // [] | map(fill("jobs")))
  | walk(if type == "string" then
           gsub("__IMAGE_DIGEST__"; $digest) | gsub("__VPC_ID__"; $vpc)
           | (if $domain != "" then gsub("__APP_DOMAIN__"; $domain) else . end)
         else . end)
  | if ([.. | strings | select(test("__[A-Z_]+__"))] | length) > 0
    then error("unresolved placeholder: \([.. | strings | select(test("__[A-Z_]+__"))] | unique | join(", "))")
    else . end
'
