# Plexco — multi-stage, single-image / multi-process Dockerfile
# 1 image → 3 process group (web · discovery · worker), chọn bằng PROCESS_ROLE.
# Yêu cầu: monorepo pnpm (packages/core · packages/db · apps/bot · apps/web). Node 22.
# pnpm version: corepack đọc "packageManager" trong package.json (source of truth).

# ---- base: bật pnpm qua corepack -------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
# Shared cache path — NOT under $HOME, so the cache survives USER switches.
ENV COREPACK_HOME=/corepack
# No TTY in image builds: pnpm 10 aborts prod re-installs without CI=true.
ENV CI=true
RUN corepack enable
WORKDIR /app

# ---- deps: cài full deps theo lockfile (cache-friendly) --------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
# Hydrate the pinned pnpm (packageManager) into Corepack's cache at BUILD time.
RUN corepack install
COPY packages/core/package.json packages/core/
COPY packages/db/package.json packages/db/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: typecheck + build toàn monorepo --------------------------------
# Root `build` = typecheck ALL workspaces first (the worker ships TS source run
# via tsx — a type error must fail the image, not the process at boot).
FROM deps AS build
COPY . .
RUN pnpm -w build

# ---- prod-deps: prune về production-only -----------------------------------
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- runtime: image cuối, non-root, healthcheck-ready ----------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
ENV COREPACK_HOME=/corepack
WORKDIR /app

# artifacts — package.json first so corepack can pin pnpm at BUILD time
# (a container must never lazy-download its package manager at boot).
COPY --from=build     /app/package.json /app/pnpm-workspace.yaml ./
RUN corepack enable && corepack install
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/packages ./packages
COPY --from=build     /app/apps ./apps
# The build stage's per-workspace node_modules carry DEV deps — strip them and
# overlay the pruned per-workspace links from prod-deps instead.
RUN find packages apps -mindepth 2 -maxdepth 2 -name node_modules -type d -exec rm -rf {} +
COPY --from=prod-deps /app/packages ./packages
COPY --from=prod-deps /app/apps ./apps
COPY infra/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# non-root; the corepack cache must be readable+writable by the runtime user
# (corepack updates lastKnownGood metadata on first use).
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin plexco \
  && chown -R plexco:plexco "$COREPACK_HOME"
USER plexco

# web/discovery lắng nghe HTTP; worker không có ingress
EXPOSE 3000
# PROCESS_ROLE ∈ {web, discovery, worker} — default web
ENV PROCESS_ROLE=web
# Audit 2026-09-06 X-5: header nói "healthcheck-ready" nhưng không có HEALTHCHECK. web/discovery
# probe /healthz (cùng target với fly.toml http_checks; compose/DO đọc directive này). worker
# không có HTTP: exit 0 = "process còn sống" (Docker đã restart khi process chết); liveness
# nghiệp vụ của worker (heartbeat vào DB) là row riêng, không giả vờ ở đây.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD sh -c 'if [ "$PROCESS_ROLE" = "worker" ]; then exit 0; fi; node -e "fetch(\"http://127.0.0.1:\" + (process.env.PORT || 3000) + \"/healthz\").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"'
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
