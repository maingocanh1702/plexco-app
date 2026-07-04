#!/bin/sh
# Plexco entrypoint — chọn process theo PROCESS_ROLE.
# web/discovery: HTTP (role DB = app / readonly, connection pooled = DATABASE_URL)
# worker:        không HTTP (role DB = app_worker, connection DIRECT = DATABASE_URL_DIRECT)
set -eu

# Ưu tiên arg ($1) — Fly process group truyền "web|discovery|worker" làm command;
# fallback PROCESS_ROLE env (dùng cho docker-compose); cuối cùng default web.
ROLE="${1:-${PROCESS_ROLE:-web}}"
echo "[entrypoint] starting role=${ROLE}"

case "$ROLE" in
  web)
    # dashboard + API + SSE + mọi webhook (TG/Zalo/SePay) — port 3000
    exec pnpm --filter @plexco/web start:web
    ;;
  discovery)
    # chỉ GET /discover — no-RLS, field-whitelist, đọc read replica
    # dùng readonly role + (khuyến nghị) DATABASE_URL_REPLICA nếu có
    exec pnpm --filter @plexco/web start:discovery
    ;;
  worker)
    # pg-boss scheduler/dispatcher + projectors + cron — cần DATABASE_URL_DIRECT
    exec pnpm --filter @plexco/bot start:worker
    ;;
  provision)
    # One-shot trước worker: dựng pgboss schema + queues bằng role migration
    # (DATABASE_URL_MIGRATION). Fly: [deploy] release_command = "provision";
    # compose: service queue-provision (worker depends_on completed).
    exec pnpm --filter @plexco/bot provision:queue
    ;;
  *)
    echo "[entrypoint] PROCESS_ROLE không hợp lệ: ${ROLE} (web|discovery|worker|provision)" >&2
    exit 1
    ;;
esac
