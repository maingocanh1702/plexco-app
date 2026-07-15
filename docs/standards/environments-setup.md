# Plexco — Hướng dẫn setup 3 môi trường: dev · staging · prod

> Mục tiêu: build & test ổn ở **dev** và **staging** trước khi **go-live** trên **prod**.
> Doc này bám sát hạ tầng thật trong repo: `infra/fly.toml`, `infra/Dockerfile`, `infra/entrypoint.sh`, `.env.example`, và `docs/standards/deployment-infra.md`.
> ⚠️ Đây là app **money-safe / multi-tenant** (đối soát SePay, ledger, RLS). Cách ly env không phải "nice-to-have" — nó là yêu cầu blast-radius (deployment-infra §6, C7).
>
> **Cập nhật 13/07/2026 (DD-37 / BRD v3.4):** target phase-1 = **web + Zalo + Facebook Messenger**, auth **Google OAuth + email/password** (DD-13). Tuy nhiên code baseline `main@1eb6f60` vẫn là Auth v3 Telegram-era: `/api/auth/telegram/callback` **còn bắt buộc `TELEGRAM_BOT_TOKEN`**. Chỉ gỡ secret/route này sau khi provider replacement land; Google/Facebook vars hiện là target contract, chưa được code consume đầy đủ.

---

> 🚨 **DD-04 ĐÃ CHỐT (2026-07-16): hosting = (c) co-locate DigitalOcean** (App Platform + Managed PG HA-standby, **VPC private**, Singapore) — **KHÔNG phải Fly**. Toàn bộ runbook Fly dưới đây (`fly.toml`, `fly deploy`/`fly secrets`, rollback Fly, 3 Fly app, Fly Postgres) là **SUPERSEDED** — **KHÔNG provision Fly cho production**. Runbook DO đầy đủ (DO App Spec · VPC trusted-sources · 4 DB roles least-privilege · pooled/direct conn · failover/PITR drill) viết ở **infra build slice** (xem `dd-04-hosting-final-decision.md` §7.3). **Staging PHẢI chạy topology DO tương đương prod** (test VPC + auto-failover + promotion, không chỉ smoke). Fly runbook giữ làm **fallback (a)** *chỉ nếu* egress-IP gate (§7.1) fail. Dev local (docker compose) không đổi.

## 0. TL;DR — chốt model

**Model: 3 env riêng (dev · staging · prod) + DB riêng mỗi env, cộng vòng lặp dev local.** ⚠️ *(Prod/staging target = **DO App Platform components + DO Managed PG cùng VPC** — runbook Fly dưới đây superseded/fallback; xem banner 🚨.)*

```
┌─────────────┐   git push        ┌──────────────┐  promote (cùng image)  ┌────────────┐
│  LOCAL loop │  feature/* ─PR──▶ │   STAGING    │ ───── sau khi gate ───▶ │    PROD    │
│ docker-     │                   │ plexco-      │       xanh + duyệt      │  plexco-   │
│ compose     │   develop ─auto─▶ │ staging      │                         │  prod      │
│ (+ tunnel)  │      │            │ (Fly app)    │                         │ (Fly app)  │
└─────────────┘      ▼            └──────────────┘                         └────────────┘
                ┌──────────┐         DB staging riêng                       DB prod riêng
                │ plexco-  │         (Tier A/B nhỏ)                          (Tier B money-safe)
                │ dev (Fly)│
                └──────────┘
                 DB dev riêng
```

| | **dev** | **staging** | **prod** |
|---|---|---|---|
| Fly app | `plexco-dev` | `plexco-staging` | `plexco-prod` (hoặc `plexco`) |
| Mục đích | tích hợp end-to-end, data vứt đi | bản sao prod, cổng kiểm thử cuối (UAT/DAST/load) | live, tiền thật |
| Deploy khi | push nhánh `develop` (auto) | merge `main` / `release/*` | **promote** image từ staging (thủ công + duyệt) |
| Database | Postgres riêng, nhỏ nhất | Postgres riêng (managed, PITR) | Postgres riêng (managed, HA + PITR) |
| Kênh/Auth (Zalo bot · Messenger app · Google/FB OAuth) | test riêng | staging riêng | prod thật |
| Cost tier (deployment-infra §9) | Tier A tối thiểu | Tier A → B | **Tier B (money-safe)** |
| Dữ liệu | giả lập / seed | giống prod (đã ẩn danh PII) | thật |

Local docker-compose (`infra/docker-compose.yml`) vẫn là vòng lặp nhanh nhất hằng ngày; `plexco-dev` là env **chia sẻ** để test webhook/PWA thật khi cần URL công khai.

---

## 1. Vì sao 3 Fly app riêng là phù hợp nhất với project này

Quyết định này gắn trực tiếp với roadmap: **Phase 1 = bot Zalo + Facebook Messenger + webapp PWA** (Telegram đã bỏ — DD-37), sau đó **native iOS/Android**.

1. **Webhook đa kênh cần URL công khai ổn định, tách biệt mỗi env.**
   web role nhận *mọi* webhook (`entrypoint.sh`: Zalo/Messenger/SePay). Zalo BYO token per-club (`setWebhook` per bot); Messenger verify webhook theo App/Page + verify-token; SePay verify theo account+Apikey. Nếu gộp chung 1 app, callback của staging và prod đụng nhau. 3 app riêng ⇒ `plexco-staging.fly.dev` vs `plexco-prod.fly.dev`, mỗi env đăng ký bot/app/secret riêng, không bao giờ lẫn.

2. **PWA + native bake sẵn API base URL theo env.**
   PWA đọc base URL lúc build; **native iOS/Android còn cứng hơn** — binary lên store trỏ cố định 1 API host + OAuth/deep-link callback. Phải có host ổn định cho từng env để QA bản staging trước khi submit store. Mô hình "1 app nhiều config" không cho native một host staging ổn định.

3. **Money-safe = cách ly blast-radius.**
   deployment-infra C7 tách 4 role DB ở mức connection (`migration` chỉ trong CI, không bao giờ ở runtime; `app` NOSUPERUSER NOBYPASSRLS; `app_worker`; `readonly`). Tách hẳn DB + secrets per env đảm bảo cred/migration của staging **không thể** chạm dữ liệu tiền của prod. Dùng chung DB/app là vi phạm trực tiếp nguyên tắc này.

4. **Promote immutable artifact.** deployment-infra §7 yêu cầu `build image (signed) → CI gates → deploy staging → promote prod`. Prod chạy **đúng image** đã pass ở staging — không build lại. Việc này cần staging và prod là 2 app tách biệt nhận cùng artifact.

> Phương án "1 Fly app nhiều DB/biến môi trường" bị loại: rẻ hơn chút nhưng phá cách ly webhook, host native, và blast-radius tiền — không chấp nhận với app đối soát tiền.

---

## 2. Tạo hạ tầng từng env

### 2.1 Fly apps

```bash
# Tạo 3 app (chạy 1 lần). KHÔNG deploy vội — chỉ tạo app trước.
fly apps create plexco-dev
fly apps create plexco-staging
fly apps create plexco-prod      # hoặc giữ tên hiện tại "plexco"

# Region: Singapore (gần VN) cho mọi env — khớp infra/fly.toml (primary_region = "sin")
```

### 2.2 Một `fly.toml` per env (tách app + sizing)

Hiện repo có 1 file `infra/fly.toml` (app = `plexco`). Tách thành 3 file, **giữ nguyên** phần `[processes]`, `[[services]]`, healthcheck — chỉ đổi `app`, và sizing/scale theo env:

```
infra/
  fly.dev.toml        # app = "plexco-dev"        | VM nhỏ nhất, min_machines_running = 0 (tiết kiệm)
  fly.staging.toml    # app = "plexco-staging"    | giống prod nhưng scale nhỏ
  fly.prod.toml       # app = "plexco-prod"       | min_machines_running ≥1, VM lớn hơn cho web
```

Deploy chỉ định file:

```bash
fly deploy -c infra/fly.dev.toml
fly deploy -c infra/fly.staging.toml
fly deploy -c infra/fly.prod.toml
```

> Giữ 3 process group (web · discovery · worker) ở **mọi** env để staging thật sự giống prod (worker/pg-boss, discovery read-path đều được test). Riêng dev có thể tắt `discovery` nếu chưa cần.

### 2.3 Database riêng mỗi env (bạn đã chọn: DB riêng)

Mỗi env một Postgres độc lập. Hai lựa chọn, theo deployment-infra §5/§9:

| Provider | Khi nào dùng | Ghi chú |
|---|---|---|
| **Fly Postgres** (private networking) | dev, staging | Cùng platform, DX đơn giản; **Postgres KHÔNG expose public** (deployment-infra §6.1). PITR/HA yếu hơn → chỉ dev/staging. |
| **DigitalOcean Managed PG (co-locate, VPC private — DD-04 ✅ (c))** | **prod** (bắt buộc), staging nên dùng | HA standby + PITR + auto-failover + private VPC + restore drill (deployment-infra §8; `dd-04-hosting-final-decision.md`; egress-IP gate §7.1). Prod money-safe = Tier B. |

```bash
# Ví dụ Fly Postgres cho dev & staging (private, attach vào app tương ứng)
fly postgres create --name plexco-db-dev      --region sin --vm-size shared-cpu-1x
fly postgres attach  plexco-db-dev      --app plexco-dev

fly postgres create --name plexco-db-staging  --region sin
fly postgres attach  plexco-db-staging  --app plexco-staging

# Prod: dùng managed Postgres (Supabase/Neon) → lấy connection string → set qua fly secrets (mục 3)
```

**4 connection / role mỗi DB** (theo `.env.example` + deployment-infra C7):

| Biến | Role | Dùng cho | Pooling |
|---|---|---|---|
| `DATABASE_URL` | `app` (NOSUPERUSER, NOBYPASSRLS) | web/discovery | POOLED (transaction-mode) |
| `DATABASE_URL_DIRECT` | `app_worker` | worker / pg-boss (LISTEN/NOTIFY + advisory lock) | DIRECT (session-mode, **không qua pooler**) |
| `DATABASE_URL_LISTEN` | `app` (chỉ LISTEN) | SSE listener trong web | DIRECT |
| `DATABASE_URL_REPLICA` | `readonly` | discovery / player-view reads (tuỳ chọn) | replica |
| *(chỉ trong CI)* | `migration` | job migrate | **KHÔNG BAO GIỜ** có trong runtime prod |

---

## 3. Secrets per env — không bao giờ commit

`.gitignore` đã chặn `.env*`. Quy tắc (`.env.example`, `fly.toml`):

- **dev local**: copy `.env.example` → `.env` (chỉ máy bạn). `KMS_PROVIDER=local`, `ENCRYPTION_KEY` fallback dev.
- **dev / staging / prod trên Fly**: set qua `fly secrets set`, **không** dùng file `.env`. Prod dùng **KMS thật** (envelope AES-GCM), `SESSION_SECRET` auto-rotate 30d.

```bash
# Mỗi env set secret riêng (token/bot/webhook KHÁC NHAU giữa các env)
fly secrets set -a plexco-staging \
  DATABASE_URL="postgres://app:...@.../plexco?sslmode=require" \
  DATABASE_URL_DIRECT="postgres://app_worker:...@.../plexco?sslmode=require" \
  TELEGRAM_BOT_TOKEN="<temporary-auth-v3-token>" \
  GOOGLE_OAUTH_CLIENT_ID="<google-client-id>" \
  GOOGLE_OAUTH_CLIENT_SECRET="<google-secret-staging>" \
  FACEBOOK_APP_ID="<fb-app-id>" \
  FACEBOOK_APP_SECRET="<fb-secret-staging>" \
  MESSENGER_VERIFY_TOKEN="<random-staging>" \
  SEPAY_WEBHOOK_SECRET="<staging>" \
  SESSION_SECRET="<random>" \
  KMS_PROVIDER="aws-kms" KMS_KEY_ID="<arn-staging>" \
  SENTRY_DSN="<staging-dsn>" LOG_LEVEL="info"

# `TELEGRAM_BOT_TOKEN` ở trên chỉ phục vụ auth-v3 hiện tại; xoá sau provider replacement DD-13/DD-37.
# Zalo bot token = per-club, mã hoá KMS lưu trong DB (KHÔNG phải global secret).
# Lặp lại cho -a plexco-prod với GIÁ TRỊ THẬT (Google/Facebook app prod, KMS prod, DB prod).
```

Biến **chung không bí mật** (`PORT`, `NODE_ENV`, `PROCESS_ROLE`) để trong `[env]` của fly.toml. `NODE_ENV=production` ở cả staging lẫn prod (staging là bản sao prod); phân biệt env bằng app name + secret, không bằng `NODE_ENV`.

---

## 4. Webhook & URL theo env

| Kênh | dev | staging | prod |
|---|---|---|---|
| Zalo (BYO per-club) | club test | club staging | token thật, mã hoá KMS |
| Messenger *(phase-1, P2.5)* | app FB ở chế độ Dev/Test | app FB staging | app FB Live (sau App Review) |
| Google/Facebook OAuth | client dev + redirect `plexco-dev.fly.dev` | client staging | client prod (domain thật) |
| SePay | sandbox/bank test | tài khoản test | tài khoản thật |
| PWA base URL | `plexco-dev.fly.dev` | `plexco-staging.fly.dev` | domain prod (vd `app.plexco.vn`) |
| Native iOS/Android (sau) | build `dev` scheme | build `staging` (TestFlight / Internal testing) | build `prod` (store) |

> Mỗi lần redeploy đổi host, nhớ **re-set webhook Zalo bot** (`setWebhook` per bot) + cập nhật **Messenger callback URL** (Meta App) + **Google/Facebook OAuth redirect URI** cho đúng env. Đặt việc này thành script trong CI sau deploy. *(Telegram đã bỏ — DD-37.)*

---

## 5. Branch ↔ env & luồng CI/CD

Khớp `push → build immutable image → CI gates → deploy staging → promote prod` (deployment-infra §7). README §Quy trình: tạo feature branch, không sửa thẳng `main`.

```
feature/*  ──PR──▶  CI (build + test + scan, KHÔNG deploy)
                       │ merge
                       ▼
   develop  ──────▶  build image  ──auto-deploy──▶  plexco-dev
                       │ merge / tag release
                       ▼
     main   ──────▶  build image (signed)  ──deploy──▶  plexco-staging
                       │ gate xanh + duyệt thủ công
                       ▼
                    PROMOTE cùng image  ─────────────▶  plexco-prod
```

**Gate bắt buộc xanh trước khi promote** (deployment-infra §7):
1. Unit/integration/E2E + invariants RLS / public-projection / person-self / **ledger**
2. Migration fresh / upgrade / rollback-forward
3. Dependency / license / secret scan / SAST / container scan
4. **DAST trên staging**
5. Event/schema compatibility
6. Load/soak: webhook burst, discovery, final-slot contention, queue recovery
7. **Duyệt bảo mật thủ công** cho: auth · money · identity · public projection · privileged DB

Repo hiện chỉ có workflow `linear-sync.yml`. Cần thêm (đề xuất, làm ở bước sau nếu bạn muốn):
`.github/workflows/ci.yml` (PR gates), `deploy-dev.yml` (push develop), `deploy-staging.yml` (push main), `promote-prod.yml` (manual `workflow_dispatch` + environment protection rule yêu cầu reviewer).

---

## 6. Migration — controlled job, không chạy trong runtime

deployment-infra C7: role `migration` **chỉ** sống trong CI job, không bao giờ trong web/worker runtime.

```
deploy staging → CI chạy migrate (role=migration) lên DB staging → test → OK
promote prod   → CI chạy migrate lên DB prod (controlled job) → rồi mới release image
```

- Migration phải **forward-safe** (không rollback irreversible) — dùng expand/contract.
- worker/projector hỗ trợ mixed event version trong lúc rollout (deployment-infra §7).

---

## 7. Promote & Rollback

**Promote (staging → prod):** release đúng image đã pass staging.

```bash
# Lấy image ref đang chạy ở staging
fly status -a plexco-staging          # hoặc fly releases -a plexco-staging
# Deploy CHÍNH image đó lên prod (không build lại)
fly deploy -a plexco-prod --image <registry>/plexco@sha256:<digest>
```

**Rollback prod nhanh:**

```bash
fly releases -a plexco-prod           # xem lịch sử
fly deploy -a plexco-prod --image <digest-bản-trước>   # về image trước
```

- App có healthcheck `/healthz` (fly.toml) → bật tiêu chí **auto-rollback** theo health/readiness.
- Migration đã chạy thì **không** rollback ngược DB — sửa bằng forward migration (xem §6).
- Sự cố tiền/cross-tenant → theo **runbook** bắt buộc (deployment-infra §8).

---

## 8. Checklist go-live (lần đầu lên prod) — ⚠️ SUPERSEDED (Fly checklist; DO go-live + acceptance §7.3 viết ở infra slice — xem banner 🚨)

- [ ] 3 Fly app tạo xong (`plexco-dev/staging/prod`), region `sin`.
- [ ] 3 DB riêng, Postgres **không** public, attach private networking.
- [ ] 4 role DB tách (`migration`/`app`/`app_worker`/`readonly`) cho staging & prod.
- [ ] Secrets set per env qua `fly secrets` (Google/FB app · KMS · SESSION khác nhau); prod dùng KMS thật.
- [ ] Webhook Zalo/Messenger/SePay + OAuth redirect (Google/Facebook) đăng ký đúng host từng env.
- [ ] CI gates §7 xanh trên staging (gồm DAST + load/soak + duyệt thủ công).
- [ ] Migration chạy controlled job, forward-safe, test trên staging trước.
- [ ] Sentry + structured log gắn `tenant_id` (không PII/secret) bật ở staging & prod.
- [ ] Backup/PITR + 1 lần **restore drill** trên staging trước go-live.
- [ ] Promote đúng image staging → prod; xác nhận `/healthz` xanh; sẵn lệnh rollback.

---

## 9. Chi phí tham chiếu (deployment-infra §9)

| Env | Tier | Ước tính/tháng |
|---|---|---|
| dev | Tier A tối thiểu (VM nhỏ, min machines = 0) | ~$5–15 |
| staging | Tier A → chớm B | ~$30–60 |
| **prod** | **Tier B money-safe** (managed PG HA+PITR, WAF Pro, Sentry, scale) | **~$120–200** |

> Nhắc lại từ deployment-infra: **money-safe = Tier B**, không phải Tier A. Đừng cắt prod xuống Tier A khi đã có tiền thật chạy qua.

---

## 10. Anti-patterns cần tránh (deployment-infra §10)

- ❌ Gộp 3 env vào 1 Fly app / 1 DB — phá cách ly webhook + blast-radius tiền.
- ❌ Dùng `.env` file ở prod — luôn dùng secret manager / KMS.
- ❌ Mang role `migration`/superuser vào runtime — phá RLS.
- ❌ Build lại image cho prod thay vì promote image staging — mất tính immutable.
- ❌ Kubernetes / tách microservices / Redis / serverless cho worker-webhook-SSE — thừa với quy mô này.

---

*Tham chiếu: `docs/standards/deployment-infra.md` (§5–§11), `infra/fly.toml`, `infra/Dockerfile`, `infra/entrypoint.sh`, `infra/docker-compose.yml`, `.env.example`, `README.md` (Port Registry).*
