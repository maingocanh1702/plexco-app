#!/usr/bin/env bash
# Render a committed App Spec (JSON form) into the spec `doctl apps update --spec` receives.
#
#   yq -o=json infra/app.staging.yaml \
#     | IMAGE_DIGEST=sha256:<64 hex> VPC_ID=<uuid> KEY_ROOT=aws-kms|local [APP_DOMAIN=<host>] \
#       infra/render-app-spec.sh <live-spec.json> > spec.local.json
#   (create mode, item 6: the same pipe and environment, `infra/render-app-spec.sh --create > spec.local.json`)
#
# <live-spec.json> is `doctl apps spec get <app-id> --format json`. Contract:
#  1. Placeholders __IMAGE_DIGEST__ / __VPC_ID__ / __APP_DOMAIN__ are replaced from the environment,
#     each validated by shape (a malformed digest must never reach the spec).
#  2. Every committed env is typed GENERAL or SECRET (any case); a missing or unknown type FAILS. A
#     `type: SECRET` entry carries NO value (one that does FAILS). On services, workers and jobs its
#     value is copied from the same component + key in the live spec (already DO-encrypted EV[...]);
#     if the live app lacks it, or a committed GENERAL env would replace a live SECRET there, the
#     render FAILS and names the secret. A committed SECRET on any other surface FAILS as unfilled. A
#     live SECRET the committed spec does not name is left out of the rendered spec: the committed
#     spec decides which envs exist.
#  3. A committed spec that still contains a __PLACEHOLDER__ after substitution fails.
#  4. stdin holds exactly one JSON document whose .name is a non-blank string equal to the live .name.
#     Its services, workers and jobs, and every `envs` in it, are absent (null) or an array: anything
#     else FAILS naming the field (`false` would read as absent, an object as a list).
#  5. KEY_ROOT is required and is exactly aws-kms or local (no default). The committed spec declares
#     both key-root sets; both are checked as in 2, then every env of the set KEY_ROOT does not name
#     (two closed lists, held only below) is dropped from every `envs`, and __KMS_PROVIDER__ is filled
#     from KEY_ROOT. A service, worker or job that declares KMS_PROVIDER must render it equal to
#     KEY_ROOT, and its live component must carry it once with that value, or the render FAILS.
#  6. Create mode, for an app's first creation (`doctl apps create --spec`, no live app yet): `--create` is
#     the ONLY argument, in place of <live-spec.json>. With any other argument, before or after it, the render
#     FAILS (no mixed mode); a live file named --create is passed as ./--create. It runs every input check and
#     every committed-spec check above (1, 3, the types and the no-value check of 2, the document checks of 4,
#     the key-root drop and KMS_PROVIDER = KEY_ROOT of 5) and reads no live spec (/dev/null). It skips exactly
#     the four live checks: the live .name equality (4), the live component's KMS_PROVIDER (5), the live
#     secret copy (2: liveSecrets and fill) and the unfilled-SECRET guard (2: it would fail every SECRET).
#     Every SECRET is left without a value, as committed; a SECRET carrying a value anywhere in the rendered
#     spec (`false` and 0 included) FAILS. It never calls doctl or any network. It pins LC_ALL=C before
#     the shape checks of 1, so a non-ASCII byte fails them in any locale (the update path keeps the caller's).
# Every failure prints this script's own message, naming a key or a field, never a value: jq's own
# error text is withheld (it can quote input bytes). No secret value is ever read from or written to
# anything but the live spec. Needs: bash 3.2+, jq.
set -euo pipefail

live="${1:?usage: render-app-spec.sh <live-spec.json> < committed.json}"
# Create mode (contract item 6). `create` is only ever this script's literal true or false, never input.
create=false
render_app_spec_create_mode() {
  [ "$#" -eq 1 ] || { echo "render: --create takes no live spec" >&2; exit 1; }
  create=true
  live=/dev/null
  # The owner's shell is likely UTF-8, where the bracket ranges of the shape checks below accept a
  # non-ASCII letter (`é`): pin the C locale so they match ASCII bytes only. The update path is unchanged.
  export LC_ALL=C
}
for arg in "$@"; do
  if [ "$arg" = "--create" ]; then render_app_spec_create_mode "$@"; fi
done
digest="${IMAGE_DIGEST:?IMAGE_DIGEST is required}"
vpc="${VPC_ID:?VPC_ID is required}"
root="${KEY_ROOT:?KEY_ROOT is required}"
domain="${APP_DOMAIN:-}"

[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "render: IMAGE_DIGEST must be sha256:<64 hex>" >&2; exit 1; }
[[ "$vpc" =~ ^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$ ]] || { echo "render: VPC_ID must be a UUID" >&2; exit 1; }
[[ "$root" == "aws-kms" || "$root" == "local" ]] || { echo "render: KEY_ROOT must be aws-kms or local" >&2; exit 1; }
if [ -n "$domain" ]; then
  [[ "$domain" =~ ^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$ ]] || { echo "render: APP_DOMAIN is not a hostname" >&2; exit 1; }
fi

# Empty stdin (a failed upstream `yq`) must fail HERE, not later inside `doctl apps update`.
committed="$(cat)"
[ -n "$committed" ] || { echo "render: empty spec on stdin" >&2; exit 1; }

jq -s -e --slurpfile live "$live" --arg digest "$digest" --arg vpc "$vpc" --arg root "$root" --arg domain "$domain" --argjson create "$create" 'try (
  # Live spec envs for a component, keyed "<kind>/<name>/<ENV_KEY>". `arrays` skips a live surface of
  # the wrong shape (its secrets then count as missing) instead of letting jq quote it in an error.
  def liveSecrets:
    [ ("services", "workers", "jobs") as $k | ($live[0][$k] // [] | arrays)[] | . as $c | ($c.envs // [] | arrays)[]
      | select(((.type? // "") | ascii_upcase) == "SECRET" and (.value // "") != "")
      | { key: "\($k)/\($c.name)/\(.key)", value: .value } ] | from_entries;
  # Every committed list RS reads (services, workers, jobs, any envs) goes through this: absent (null)
  # reads as empty, an array as itself, anything else FAILS naming the field. `//` would read `false`
  # as absent and `map` an object as a list: components or envs, live secrets included, would drop.
  def list($f): if . == null then [] elif type == "array" then . else error("render: \($f) must be an array") end;
  # The two key-root sets (closed lists, held only here): KEY_ROOT keeps one, the other is dropped.
  def awsOnly: ["AWS_REGION", "KMS_KEY_ID", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "KMS_ENCRYPTED_AUTH_PEPPER", "KMS_ENCRYPTED_CONNECTOR_PEPPER"];
  def localOnly: ["ENCRYPTION_KEY"];
  # One document (a multi-document YAML through yq is two). A nameless one fails here: null or {} (an
  # empty YAML file through yq), an array, a string, a non-string or blank .name. Secrets are copied
  # from the same app only.
  (if length != 1 then error("render: stdin must hold exactly one JSON document") else .[0] end)
  | (if [.name?][0] | type == "string" and test("\\S") then . else error("render: committed spec has no name") end)
  | (if ($create | not) and (($live[0].name? // null) != .name) then error("render: live spec .name differs from the committed .name") else . end)
  # Choke-point guard (CLOSED SET): the DDL credential may exist ONLY as an env of a PRE_DEPLOY job
  # (docs/standards/environments-setup.md §4, §13). Count it everywhere in the document and compare
  # with the PRE_DEPLOY-job count, so any other surface (services, workers, static_sites, functions,
  # top-level envs, POST_DEPLOY / FAILED_DEPLOY / SCHEDULED jobs) fails without being enumerated.
  | (if ([.. | objects | select(.key? == "DATABASE_URL_MIGRATION")] | length)
      != ([.jobs[]? | select(.kind == "PRE_DEPLOY") | .envs[]? | select(.key == "DATABASE_URL_MIGRATION")] | length)
   then error("render: DATABASE_URL_MIGRATION outside the PRE_DEPLOY job") else . end)
  # Every committed env on any surface is typed GENERAL or SECRET (any case), and a SECRET carries no
  # value: a masked or pasted one would be submitted as the NEW live value. Runs after the guard.
  | ((.. | objects | .envs | list("envs") | .[]
      | (.type? // null | if type == "string" then ascii_upcase else null end) as $t
      | if $t != "GENERAL" and $t != "SECRET" then error("render: env type must be GENERAL or SECRET: \(.key? // null)")
        elif $t == "SECRET" and (.value // "") != "" then error("render: committed SECRET carries a value: \(.key)")
        else empty end), .)
  # Only now is the set KEY_ROOT does not name dropped, from every `envs`: a valued SECRET or an untyped
  # env in it has already FAILED above instead of vanishing here.
  | (if $root == "local" then awsOnly else localOnly end) as $drop
  | walk(if type == "object" and (.envs | type) == "array" then .envs |= map(select(.key | IN($drop[]) | not)) else . end)
  # Placeholders are substituted and checked BEFORE secrets are copied: a copied value is never
  # transformed, scanned or quoted.
  | walk(if type == "string" then
           gsub("__IMAGE_DIGEST__"; $digest) | gsub("__VPC_ID__"; $vpc) | gsub("__KMS_PROVIDER__"; $root)
           | (if $domain != "" then gsub("__APP_DOMAIN__"; $domain) else . end)
         else . end)
  | if ([.. | strings | select(test("__[A-Z_]+__"))] | length) > 0
    then error("render: unresolved placeholder: \([.. | strings | scan("__[A-Z_]+__")] | unique | join(", "))")
    else . end
  # Agreement guard (component-level KMS_PROVIDER only, as both specs and the creation copy declare it;
  # app-level envs are not compared): rendered as KEY_ROOT, and the live component carries exactly that
  # value once (absent or wrong-shaped differs): a flip or half-switch stops, naming the component only.
  | ((("services", "workers", "jobs") as $k | (.[$k] | list($k))[] | . as $c
      | [($c.envs | list("envs"))[] | select(.key == "KMS_PROVIDER") | .value] | select(length > 0)
      | if all(.[]; . == $root) and ($create or [($live[0][$k] // [] | arrays)[] | select(.name? == $c.name)
             | (.envs? // [] | arrays)[] | select(.key? == "KMS_PROVIDER") | .value] == [$root])
        then empty else error("render: KMS_PROVIDER differs from KEY_ROOT: \($k)/\($c.name)") end), .)
  # Create mode copies no secret: every SECRET stays as committed, without a value, and one that carries a
  # value anywhere (`false` and 0 included) fails. The update path below is unchanged.
  | if $create then
      (if any(.. | objects | select(((.type? // "") | ascii_upcase) == "SECRET" and (.value | . != null and . != "")); .)
       then error("render: create mode would emit a SECRET with a value") else . end)
    else (.
  | liveSecrets as $ls
  # A SECRET is copied from the live app. A GENERAL env over a live SECRET would blank or demote it.
  | def fill($kind): . as $c | .envs = [ ($c.envs | list("envs"))[] | $ls["\($kind)/\($c.name)/\(.key)"] as $v |
      if (.type | ascii_upcase) == "SECRET"
      then if $v == null then error("render: missing secret in live app: \($kind)/\($c.name)/\(.key) - set it in DO first")
           elif ($v | type == "string" and startswith("EV[") and endswith("]") | not)
           then error("render: live secret is not an EV ciphertext: \($kind)/\($c.name)/\(.key)")
           else . + {value: $v} end
      elif $v != null then error("render: live SECRET would be demoted to a plain env: \($kind)/\($c.name)/\(.key)")
      else . end ];
  .services |= (list("services") | map(fill("services")))
  | .workers |= (list("workers") | map(fill("workers")))
  | .jobs    |= (list("jobs") | map(fill("jobs")))
  # Never silently blank a secret: a SECRET left valueless on any surface fill() does not cover fails.
  | (if any(.. | objects | select(((.type? // "") | ascii_upcase) == "SECRET" and (.value // "") == ""); .)
     then error("render: unfilled SECRET outside services/workers/jobs") else . end)
    ) end
  # jq error text can quote input bytes (a live ciphertext): only the messages raised above pass.
) catch (if type == "string" and startswith("render: ") then . else "render: the input is not the expected JSON shape (the jq message is withheld: it can quote a value)" end | error)' <<<"$committed"
