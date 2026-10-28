#!/bin/sh
# Plexco entrypoint — chọn process theo PROCESS_ROLE.
# web/discovery: HTTP (role DB = app / readonly, connection pooled = DATABASE_URL)
# worker:        không HTTP (role DB = app_worker, connection DIRECT = DATABASE_URL_DIRECT)
set -eu

# Ưu tiên arg ($1) — deployment process group truyền "web|discovery|worker" làm command;
# rồi FLY_PROCESS_GROUP (Fly đặt biến này cho mọi Machine); rồi PROCESS_ROLE env
# (docker-compose); cuối cùng default web.
ROLE="${1:-${FLY_PROCESS_GROUP:-${PROCESS_ROLE:-web}}}"

# EXPORT, không chỉ gán. `apps/web/middleware.ts` đọc process.env.PROCESS_ROLE để quyết định
# discovery chỉ được phục vụ /healthz + /discover*. Một biến shell không export KHÔNG tới được
# tiến trình Next: trên Fly, process group truyền role qua COMMAND (arg), còn image thì
# `ENV PROCESS_ROLE=web`, nên tiến trình discovery sẽ khởi động với PROCESS_ROLE=web và
# allowlist không bao giờ bật — mọi route auth/session/onboarding đều mở trên ingress discovery.
export PROCESS_ROLE="$ROLE"

# Fly: CẢ [env] LẪN `fly secrets set` đều là app-wide, không có biến nào theo process group.
# Vì vậy giá trị khác nhau theo role phải giải ở đây, từ biến có hậu tố role (đặt app-wide):
#   DATABASE_URL_WEB / DATABASE_URL_DISCOVERY, DB_EXPECTED_ROLE_WEB / DB_EXPECTED_ROLE_DISCOVERY.
# Không đặt thì giữ nguyên DATABASE_URL/DB_EXPECTED_ROLE chung (hành vi cũ).
case "$ROLE" in
  web)
    EXPECT_DB_ROLE=app
    if [ -n "${DATABASE_URL_WEB:-}" ]; then export DATABASE_URL="$DATABASE_URL_WEB"; fi
    if [ -n "${DB_EXPECTED_ROLE_WEB:-}" ]; then export DB_EXPECTED_ROLE="$DB_EXPECTED_ROLE_WEB"; fi
    ;;
  discovery)
    EXPECT_DB_ROLE=readonly
    if [ -n "${DATABASE_URL_DISCOVERY:-}" ]; then export DATABASE_URL="$DATABASE_URL_DISCOVERY"; fi
    if [ -n "${DB_EXPECTED_ROLE_DISCOVERY:-}" ]; then export DB_EXPECTED_ROLE="$DB_EXPECTED_ROLE_DISCOVERY"; fi
    ;;
  *)
    EXPECT_DB_ROLE=
    ;;
esac

# Vai trò DB kỳ vọng là thuộc tính của ROLE, không phải của một biến dùng chung. Nếu chỉ có
# biến CHUNG `DB_EXPECTED_ROLE` (cấu hình Fly mới làm một nửa) thì nó phải KHỚP vai trò của
# process này; nếu không, discovery sẽ chạy bằng credential của web và assert của chính nó
# cũng PASS — fail-open đúng chỗ mà W-10 sinh ra để chặn. Không khớp thì từ chối khởi động.
# (Để trống `DB_EXPECTED_ROLE` vẫn là tắt kiểm tra — opt-in là quyết định của owner, không đổi
# ở đây; xem fly.toml.)
if [ -n "${EXPECT_DB_ROLE:-}" ] && [ -n "${DB_EXPECTED_ROLE:-}" ] \
   && [ "$DB_EXPECTED_ROLE" != "$EXPECT_DB_ROLE" ]; then
  echo "[entrypoint] REFUSING: role=${ROLE} expects DB role '${EXPECT_DB_ROLE}' but DB_EXPECTED_ROLE='${DB_EXPECTED_ROLE}'." >&2
  echo "[entrypoint] Set DB_EXPECTED_ROLE_$(echo "$ROLE" | tr '[:lower:]' '[:upper:]') (and DATABASE_URL_$(echo "$ROLE" | tr '[:lower:]' '[:upper:]')) per role, or drop the shared value." >&2
  exit 1
fi

echo "[entrypoint] starting role=${ROLE}"

case "$ROLE" in
  web)
    # dashboard + API + SSE + mọi webhook (TG/Zalo/SePay) — port 3000
    exec pnpm --filter @plexco/web start:web
    ;;
  discovery)
    # chỉ GET /discover — projection-only, field-whitelist, readonly role.
    # DATABASE_URL được scope theo component: primary Day-1, read-only node khi telemetry trigger.
    exec pnpm --filter @plexco/web start:discovery
    ;;
  worker)
    # pg-boss scheduler/dispatcher + projectors + cron — cần DATABASE_URL_DIRECT
    exec pnpm --filter @plexco/bot start:worker
    ;;
  provision)
    # One-shot trước worker: dựng pgboss schema + queues bằng role migration
    # (DATABASE_URL_MIGRATION). Prod: CI/one-shot job-scoped secret. Local compose
    # KHÔNG có service riêng cho bước này (audit 2026-09-06: comment cũ trỏ tới một
    # service `queue-provision` chưa từng tồn tại) — chạy ad-hoc, URL truyền qua -e:
    #   docker compose -f infra/docker-compose.yml run --rm \
    #     -e DATABASE_URL_MIGRATION=postgres://plexco:plexco_dev@postgres:5432/plexco \
    #     worker provision
    exec pnpm --filter @plexco/bot provision:queue
    ;;
  migrate)
    # One-shot SQL migrations, step 2 of the required CI order in docs/standards/environments-setup.md
    # (`provision` above is step 3). The runner reads only DATABASE_URL_MIGRATION and refuses an empty
    # value itself. It runs through apps/bot because tsx is a production dependency there; the db
    # package's own script needs a dev-only tsx that the pruned image does not carry.
    exec pnpm --filter @plexco/bot exec tsx ../../packages/db/src/migrate.ts
    ;;
  *)
    echo "[entrypoint] PROCESS_ROLE không hợp lệ: ${ROLE} (web|discovery|worker|provision|migrate)" >&2
    exit 1
    ;;
esac
