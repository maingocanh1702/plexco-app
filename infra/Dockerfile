# Plexco — multi-stage, single-image / multi-process Dockerfile
# 1 image → 3 process group (web · discovery · worker), chọn bằng PROCESS_ROLE.
# Yêu cầu: monorepo pnpm (packages/core · apps/bot · apps/web). Node 22, pnpm 9.
# ⚠️ P0 TEMPLATE — script (start:web/discovery/worker) & apps/* sẽ tạo ở scaffold P0.

# ---- base: bật pnpm qua corepack -------------------------------------------
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# ---- deps: cài full deps theo lockfile (cache-friendly) --------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/core/package.json packages/core/
COPY apps/bot/package.json apps/bot/
COPY apps/web/package.json apps/web/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ---- build: typecheck + build toàn monorepo --------------------------------
FROM deps AS build
COPY . .
RUN pnpm -r build

# ---- prod-deps: prune về production-only -----------------------------------
FROM deps AS prod-deps
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --prod

# ---- runtime: image cuối, non-root, healthcheck-ready ----------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@9 --activate
WORKDIR /app

# artifacts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build     /app/packages ./packages
COPY --from=build     /app/apps ./apps
COPY --from=build     /app/package.json /app/pnpm-workspace.yaml ./
COPY infra/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# non-root
RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin plexco
USER plexco

# web/discovery lắng nghe HTTP; worker không có ingress
EXPOSE 3000
# PROCESS_ROLE ∈ {web, discovery, worker} — default web
ENV PROCESS_ROLE=web
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
