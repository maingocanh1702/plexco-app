#!/usr/bin/env bash
# Render a committed App Spec (JSON form) into the spec `doctl apps update --spec` receives.
#
#   yq -o=json infra/app.staging.yaml \
#     | IMAGE_DIGEST=sha256:<64 hex> VPC_ID=<uuid> [APP_DOMAIN=<host>] \
#       infra/render-app-spec.sh <live-spec.json> > spec.local.json
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

# Empty stdin (a failed upstream `yq`) must fail HERE, not later inside `doctl apps update`.
committed="$(cat)"
[ -n "$committed" ] || { echo "render: empty spec on stdin" >&2; exit 1; }

jq -e --slurpfile live "$live" --arg digest "$digest" --arg vpc "$vpc" --arg domain "$domain" '
  # Live spec envs for a component, keyed "<kind>/<name>/<ENV_KEY>".
  def liveSecrets:
    [ ("services", "workers", "jobs") as $k | ($live[0][$k] // [])[] | . as $c | ($c.envs // [])[]
      | select(((.type? // "") | ascii_upcase) == "SECRET" and (.value // "") != "")
      | { key: "\($k)/\($c.name)/\(.key)", value: .value } ] | from_entries;
  # A nameless document fails here: null or {} (an empty YAML file through yq), an array, a string.
  (if (.name? // "") == "" then error("committed spec has no name") else . end) |
  # Choke-point guard (CLOSED SET): the DDL credential may exist ONLY as an env of a PRE_DEPLOY job
  # (docs/standards/environments-setup.md §4, §13). Count it everywhere in the document and compare
  # with the PRE_DEPLOY-job count, so any other surface (services, workers, static_sites, functions,
  # top-level envs, POST_DEPLOY / FAILED_DEPLOY / SCHEDULED jobs) fails without being enumerated.
  (if ([.. | objects | select(.key? == "DATABASE_URL_MIGRATION")] | length)
      != ([.jobs[]? | select(.kind == "PRE_DEPLOY") | .envs[]? | select(.key == "DATABASE_URL_MIGRATION")] | length)
   then error("DATABASE_URL_MIGRATION outside the PRE_DEPLOY job") else . end)
  # Placeholders are substituted and checked BEFORE secrets are copied: a copied value is never
  # transformed, scanned or quoted.
  | walk(if type == "string" then
           gsub("__IMAGE_DIGEST__"; $digest) | gsub("__VPC_ID__"; $vpc)
           | (if $domain != "" then gsub("__APP_DOMAIN__"; $domain) else . end)
         else . end)
  | if ([.. | strings | select(test("__[A-Z_]+__"))] | length) > 0
    then error("unresolved placeholder: \([.. | strings | scan("__[A-Z_]+__")] | unique | join(", "))")
    else . end
  | liveSecrets as $ls
  | def fill($kind): . as $c | .envs = [ ($c.envs // [])[] |
      if ((.type? // "") | ascii_upcase) == "SECRET" and (.value // "") == ""
      then ($ls["\($kind)/\($c.name)/\(.key)"]) as $v
           | if $v == null then error("missing secret in live app: \($kind)/\($c.name)/\(.key) - set it in DO first")
             elif ($v | (startswith("EV[") and endswith("]")) | not)
             then error("live secret is not an EV ciphertext: \($kind)/\($c.name)/\(.key)")
             else . + {value: $v} end
      else . end ];
  .services |= (. // [] | map(fill("services")))
  | .workers |= (. // [] | map(fill("workers")))
  | .jobs    |= (. // [] | map(fill("jobs")))
  # Never silently blank a secret: a SECRET left valueless on any surface fill() does not cover fails.
  | (if any(.. | objects | select(((.type? // "") | ascii_upcase) == "SECRET" and (.value // "") == ""); .)
     then error("unfilled SECRET outside services/workers/jobs") else . end)
' <<<"$committed"
