#!/usr/bin/env bash
# Share page proof (lane L39; two phases since lane L72): on the real stack an ANONYMOUS visitor opens
# /session/<slug> of a host-shared public session (200 and the card; one uniform 404 for an unknown, rotated-away,
# private or suspended-tenant slug; the hide-exact-address option ON, OFF and at the D-4 default). Phase 1 runs
# `next dev` (e2e/public-share-page.config.ts) and does all host work; phase 2 runs `next build` + `next start`
# (e2e/public-share-page-prod.config.ts) to pin the production headers, then suspends the tenant. Phase 1 hands
# phase 2 the share paths and the host's session token in a 0600 file in a `mktemp -d` dir; only the file's path
# travels (SHARE_PROOF_STATE_FILE), and the trap deletes the dir after the database drop. TEST-ONLY, never run in
# CI: no workflow names this file or either config. The one command, from the repo root, under the session DB/e2e
# lock:
#   bash apps/web/e2e/public-share-page-proof.sh
# It creates ONLY the scratch database plexco_l39_scratch and always drops it (trap on EXIT, INT and TERM),
# printing the database listing before and after; it never touches plexco, plexco_smoke or plexco_test. It needs
# port 3000 free (each config starts the one server there; checked again between the phases). A preflight refusal
# (a port busy, or lsof missing or failing; exit 2) stops before anything is created, so it prints neither the
# database listing nor the drop line.
set -u
cd "$(dirname "$0")/../../.." || exit 2
[ -f infra/docker-compose.yml ] || { echo "proof: repo root not found" >&2; exit 2; }
# A listener on port 3000 in any address family (a server on [::1]:3000 gets the clients' localhost
# first) would receive the proof's writes: refuse before the listing, the trap or any CREATE.
# Fail closed, unknown means stop: no lsof stops here, and lsof exits 1 both when nothing matched and when
# it failed, so exit 1 alone is not proof the port is free; only exit 1 with an empty stderr (captured
# below, stdout discarded) reads as free.
command -v lsof > /dev/null 2>&1 || { echo "proof: lsof not found; cannot prove port 3000 is free" >&2; exit 2; }
port_free() {
  local rc=0 err
  err=$(lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>&1 > /dev/null) || rc=$?
  if [ "$rc" -eq 0 ]; then echo "proof: port $1 is busy; stop the server listening on it first" >&2; exit 2; fi
  if [ "$rc" -ne 1 ] || [ -n "$err" ]; then echo "proof: lsof failed (exit $rc); cannot prove port $1 is free" >&2; exit 2; fi
}
port_free 3000
# The ONE database name, checked here, before the trap and before any CREATE or DROP; readonly from here on.
readonly DB=plexco_l39_scratch
[[ "$DB" =~ ^plexco_l39_scratch$ ]] || { echo "proof: refusing database name $DB" >&2; exit 2; }

psqlx() { docker exec -i plexco-postgres-1 psql -U plexco -X -q -v ON_ERROR_STOP=1 "$@"; }
sql() { psqlx -d "$1" -c "$2" < /dev/null; }
list() { psqlx -d postgres -Atc "select datname from pg_database order by 1" < /dev/null; }
die() { echo "proof: $1 failed; stopping" >&2; exit 1; }
# Superuser password from infra/docker-compose.yml, read exactly as the lane's locked-run.sh reads it.
SU_PW=$(grep -m1 -E 'POSTGRES_PASSWORD' infra/docker-compose.yml \
  | sed -E 's/^[^:=]*POSTGRES_PASSWORD[[:space:]]*[:=][[:space:]]*//; s/^["'"'"']//; s/["'"'"'][[:space:]]*$//; s/[[:space:]]+$//' \
  | tr -d '\r')
# Runtime role passwords: the runbook's section 5 statements, the one authority (applied below as well).
STMTS=$(grep -oE "ALTER ROLE [a-z_]+ +WITH PASSWORD '[^']+'" docs/runbooks/local-mvp-smoke.md)
pw_of() { printf '%s\n' "$STMTS" | sed -nE "s/^ALTER ROLE $1 +WITH PASSWORD '([^']+)'\$/\1/p" | head -1; }
APP_PW=$(pw_of app); RO_PW=$(pw_of readonly)
if [ -z "$SU_PW" ] || [ -z "$APP_PW" ] || [ -z "$RO_PW" ]; then die "password lookup"; fi
SU_URL="postgres://plexco:$SU_PW@localhost:5432/$DB"
APP_URL="postgres://app:$APP_PW@localhost:5432/$DB"
RO_URL="postgres://readonly:$RO_PW@localhost:5432/$DB"
echo "databases BEFORE:"; list || die "listing BEFORE"

RC=1 # non-zero until phase 2's own code is known: an early stop, INT or TERM never reads as a pass
cleanup() {
  trap - EXIT INT TERM
  # Playwright's webServers have already stopped; FORCE only ends leftover sessions on the scratch DB.
  sql postgres "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
  local after
  after=$(list)
  printf 'databases AFTER:\n%s\n' "$after"
  # Measured from that listing; its postgres row is the positive control that the listing rendered.
  if printf '%s\n' "$after" | grep -qx postgres && ! printf '%s\n' "$after" | grep -qx "$DB"; then
    echo "scratch database dropped: yes"
  else
    echo "scratch database dropped: no"; RC=1
  fi
  # The state file holds bearer tokens: its dir goes after the drop, measured (unset = never created).
  if [ -n "${STATE_DIR:-}" ] && [ -d "$STATE_DIR" ]; then rm -rf "$STATE_DIR"; fi
  if [ -n "${STATE_DIR:-}" ] && [ -e "$STATE_DIR" ]; then
    echo "state dir removed: no"; RC=1
  else
    echo "state dir removed: yes"
  fi
  exit "$RC"
}
trap cleanup EXIT INT TERM
# Phase 1 writes the state file here (0700 dir); only the file's path goes into the environment.
STATE_DIR=$(mktemp -d) && [ -d "$STATE_DIR" ] || die "state dir"
STATE_FILE="$STATE_DIR/state.json"

sql postgres "DROP DATABASE IF EXISTS $DB" || die "drop of a leftover $DB"
sql postgres "CREATE DATABASE $DB" || die "create $DB"
for f in 01-job-definer 02-chat-definer 03-identity-definer; do
  psqlx -d "$DB" < "infra/postgres-init/$f.sql" || die "bootstrap $f"
done
env -u DATABASE_URL_TEST DATABASE_URL_MIGRATION="$SU_URL" pnpm --filter @plexco/db migrate 2>&1 | tail -5
[ "${PIPESTATUS[0]}" -eq 0 ] || die "migrate"
while IFS= read -r s; do sql "$DB" "$s" || die "password step"; done <<EOF
$STMTS
EOF
sql postgres "ALTER DATABASE $DB SET plexco.dev_login = 'on'" || die "dev-login opt-in"
# Ephemeral key: env only, never printed or written; never ~/.plexco-smoke-encryption-key.
ENCRYPTION_KEY="$(openssl rand -base64 32)"; export ENCRYPTION_KEY
[ -n "$ENCRYPTION_KEY" ] || die "key generation"
env -u DATABASE_URL_TEST DATABASE_URL="$APP_URL" pnpm dev:seed 2>&1 | tail -3
[ "${PIPESTATUS[0]}" -eq 0 ] || die "seed"

# Phase 1, `next dev`: all host work. SHARE_PROOF_DB_URL = superuser URL of this scratch DB only (the spec enables
# public_sessions there); servers use RO_URL. `direct` is accepted outside production only.
env -u NODE_ENV -u DATABASE_URL_TEST -u PROCESS_ROLE SHARE_PROOF_BASE_URL=http://localhost:3000 \
  SHARE_PROOF_DB_URL="$SU_URL" DATABASE_URL="$APP_URL" DISCOVERY_DATABASE_URL="$RO_URL" \
  SHARE_PROOF_STATE_FILE="$STATE_FILE" \
  PLEXCO_DEV_LOGIN=1 TRUSTED_INGRESS_PROVIDER=direct DB_EXPECTED_ROLE=app KMS_PROVIDER=local \
  pnpm --filter @plexco/web exec playwright test --config e2e/public-share-page.config.ts --reporter=list
P1_RC=$?
echo "phase 1 playwright exit: $P1_RC"
[ "$P1_RC" -eq 0 ] || { RC=$P1_RC; exit "$RC"; }

# Between the phases. The file holds bearer tokens: it must exist with mode 600 (macOS stat).
{ [ -f "$STATE_FILE" ] && [ "$(stat -f %Lp "$STATE_FILE")" = 600 ]; } || die "state file"
echo "state file mode: 600"
# Phase 1's dev server must be gone, or it would answer phase 2; a refusal here exits through the trap.
port_free 3000
# The lock wrapper sets NODE_ENV=test, which a production build must not see; next.config.mjs stops a build that
# sees PLEXCO_DEV_LOGIN; the CSP nonce flag stays off (lane L72 D7). No key either: a build needs none (CI builds
# without one) and the key is never written. The build rewrites apps/web/.next, so reusing it in sequence is safe.
env -u NODE_ENV -u DATABASE_URL_TEST -u PROCESS_ROLE -u PLEXCO_DEV_LOGIN -u CSP_SCRIPT_NONCE_ENABLED \
  -u ENCRYPTION_KEY pnpm --filter @plexco/web build 2>&1 | tail -5
[ "${PIPESTATUS[0]}" -eq 0 ] || die "production build"

# Phase 2, `next start` (NODE_ENV unset as in production; next start sets it): the production headers, then the
# tenant suspension. Production refuses `direct`; digitalocean is valid in any mode, and the proof sends no
# forwarded client-IP header, so every request shares one limiter bucket.
env -u NODE_ENV -u DATABASE_URL_TEST -u PROCESS_ROLE -u PLEXCO_DEV_LOGIN -u CSP_SCRIPT_NONCE_ENABLED \
  SHARE_PROOF_BASE_URL=http://127.0.0.1:3000 SHARE_PROOF_DB_URL="$SU_URL" SHARE_PROOF_STATE_FILE="$STATE_FILE" \
  DATABASE_URL="$APP_URL" DISCOVERY_DATABASE_URL="$RO_URL" TRUSTED_INGRESS_PROVIDER=digitalocean \
  DB_EXPECTED_ROLE=app KMS_PROVIDER=local \
  pnpm --filter @plexco/web exec playwright test --config e2e/public-share-page-prod.config.ts --reporter=list
RC=$?
echo "phase 2 playwright exit: $RC"
exit "$RC"
