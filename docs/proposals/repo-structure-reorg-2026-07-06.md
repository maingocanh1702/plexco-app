# Proposal: Tổ chức lại cấu trúc repo & docs — Plexco

> **Trạng thái:** ⚠️ **HISTORICAL / phần lớn SUPERSEDED (2026-07-15)** — `docs/channels/{messenger,zalo,telegram}/` đã tồn tại; Messenger nay **P2.5 phase-1** (không còn P4.8). Proposal 07-06 giữ làm tham chiếu lịch sử, KHÔNG phải kế hoạch hiện hành.
> **Ngày:** 2026-07-06
> **Phạm vi:** cấu trúc thư mục root + `docs/` (không đụng logic code trong `apps/`, `packages/`)
> **Nguyên tắc:** không phá cross-reference/tooling; mọi thay đổi làm bằng `git mv` + link-update pass; giữ ổn định các file được tham chiếu dày (features/, decisions.md)

---

## 1. Mục tiêu & nguyên tắc

Làm cấu trúc **khoa học** (nhóm theo mục đích, thứ tự đọc rõ), **thân thiện** (người mới biết vào đâu tìm gì), **dễ quản lý** (giảm file rác ở root, gộp các cụm đang phân tán).

Nguyên tắc ràng buộc khi (sau này) thực hiện:

- **Không phá reference.** Docs Plexco cross-link rất dày (decisions.md ↔ features ↔ identity-model ↔ standards). Mọi move phải kèm link-update; file tham chiếu nhiều nhất (thư mục `features/`, `decisions.md`, `business-rules.md`) **giữ nguyên tên** để giảm rủi ro.
- **Tôn trọng tooling đọc path cố định.** `CLAUDE.md`/`AGENTS.md` phải nằm ở **root** (agent đọc ở đó); GitNexus index theo path; autopilot scripts đọc path cố định. Đổi vị trí các file mà tooling trỏ tới ⇒ phải update tooling cùng lúc.
- **Làm theo phase, mỗi phase là 1 commit review được** (§6).

---

## 2. Vấn đề hiện tại (findings cụ thể)

### 2.1 Root lộn xộn — ~20 file lẻ trộn nhiều loại

| Nhóm | File ở root hiện tại | Vấn đề |
|---|---|---|
| Docs vận hành/agent | `CLAUDE.md`, `AGENTS.md`, `README.md` | **Đúng chỗ** — tooling đọc ở root, giữ nguyên |
| Docs automation | `AUTOMATION.md`, `ONBOARDING-AUTOMATION.md`, `EXECUTION-PLAYBOOK.md`, `BACKLOG-P0-P3.md` | Nên gom về `docs/automation/` (đang tách rời khỏi `docs/autopilot-*`) |
| Docs chiến lược/GTM | `Plexco_GTM_Strategy.md`, `plexco-gtm-doi-soat-decision.md`, `plexco-base-chat-package-feasibility.md` | Docs dài nằm lạc ở root; nên vào `docs/strategy/` |
| Meta | `CHANGELOG.md`, `PR_TEMPLATE.md` | `CHANGELOG` giữ root (chuẩn); `PR_TEMPLATE.md` nên vào `.github/` |
| Tooling Linear (scripts + input tĩnh) | `compare-linear.mjs`, `gen-linear-csv.mjs`, `linear-sync.mjs`, `sync-embedded.mjs`, `linear-import.csv` | Cụm "Linear sync" rải ở root; đích P2-optional `tools/linear/`. **Reference lẫn nhau + README/AUTOMATION nhắc** → move phải update path. (`progress.json`/`snapshot.json`/`dashboard.html` ở row data/state bên dưới.) |
| Data/state (versioned) | `progress.json`, `plexco-dashboard.html`, `linear-snapshot.json` | **KHÔNG phải cache**: `progress.json` = **state versioned source-of-truth**, `dashboard.html` = **projection**, `snapshot.json` = generated-nhưng-đang-versioned (Q4 §8). **Khuyến nghị GIỮ Ở ROOT** đợt này (workflow + `__dir` phụ thuộc); chỉ cân nhắc move sau khi patch trọn |
| Config chuẩn | `package.json`, `pnpm-*.yaml`, `tsconfig*.json`, `eslint.config.mjs`, `.prettier*`, `.env.example`, `.gitignore`, `.dockerignore` | **Đúng chỗ** — giữ nguyên |

### 2.2 `docs/` — file lẻ trộn với thư mục, cụm autopilot phân mảnh

- **File lẻ ở `docs/` root**: `identity-model.md`, `autopilot-ONBOARDING.md`, `autopilot-backlog.md`, `autopilot-invariant-catalog.md`, `autopilot-parallel-scope-gate.md` — nằm ngang hàng với các thư mục, khó quét.
- **Autopilot bị xé 4 nơi**: `docs/autopilot-*.md` (lẻ) + `docs/autopilot-manifests/` + `docs/autopilot-templates/` + (root) `AUTOMATION.md`/`ONBOARDING-AUTOMATION.md`/`EXECUTION-PLAYBOOK.md` + `scripts/autopilot-*` + `.autopilot/`. Một subsystem mà tài liệu ở 4 chỗ.
  - ⚠️ **Nhưng đây KHÔNG chỉ là docs — nhiều path là executable contract.** `scripts/autopilot-onboard.sh` verify **exact path** (`docs/autopilot-ONBOARDING.md`, `docs/autopilot-invariant-catalog.md`, `docs/autopilot-backlog.md`, `docs/autopilot-parallel-scope-gate.md`, `docs/autopilot-manifests/_TEMPLATE.json`, `docs/autopilot-templates/autopilot-invariants.md` + `autopilot-prompt-GENERIC.md`); `scripts/autopilot-scope-gate` suy ra catalog `docs/autopilot-invariant-catalog.md` + `--manifest docs/autopilot-manifests/<x>.json`; `scripts/autopilot-backlog-reconcile` hard-code `docs/autopilot-backlog.md`. ⇒ move = **phải sửa scripts đồng thời**, không phải move docs thuần.
  - ⚠️ **KHÔNG gộp `docs/autopilot-backlog.md` với `BACKLOG-P0-P3.md`.** Chúng khác bản chất: `autopilot-backlog.md` = **slice registry machine-scannable** (backlog-reconcile derive merged-status từ code); `BACKLOG-P0-P3.md` = **checklist sản phẩm/module** người đọc. Gộp sẽ phá reconcile.
- **3 folder channel mỗi cái chỉ 1 README**: `docs/bot-telegram/`, `docs/bot-zalo/`, `docs/bot-messenger/` — cộng `docs/web-app/`. Rời rạc, nên gộp `docs/channels/`.
- **`docs/appendices/` trộn nhiều loại**: analysis/audit (`player-side-saas-AUDIT`, `bestminton-*`), plan (`saas-implementation-plan`), model tài chính (`saas-pnl-model.xlsx`), và `messenger-channel-design.md` (thực chất là **feature spec chờ convert**, không phải phụ lục).
- **Naming không nhất quán**: `core/` = UPPERCASE (`BRD.md`), phần còn lại kebab-case, `features/` = `feature_snake_case.md`. Ba quy ước trong một cây docs.

### 2.3 Trùng lặp & rác

- `design-tokens.md` tồn tại **3 bản**: `docs/standards/`, `docs/web-app/`, `templates/` → nguy cơ lệch nguồn.
- `feature-dependency-graph.md` tồn tại **2 bản**: `docs/standards/` và `templates/feature-dev/`.
- `.DS_Store` rải rác (`docs/`, `packages/`, `packages/db/`); `.gitignore` lại khai `.DS_Store` **3 lần** (rác).
- `templates/` nằm ở **root** trong khi nội dung thuần về docs (feature-spec-template, be-tech-spec-template…) → hợp lý hơn khi ở `docs/templates/`.

---

## 3. Cấu trúc đề xuất (target)

### 3.1 Root — chỉ giữ thứ bắt buộc/chuẩn

```
/
├── README.md                 # entry, giữ root
├── CLAUDE.md  AGENTS.md       # agent đọc ở root — giữ
├── CHANGELOG.md              # chuẩn — giữ root
├── package.json  pnpm-*.yaml  tsconfig*.json  eslint.config.mjs
├── .prettier*  .env.example  .gitignore  .dockerignore
├── apps/        # bot, web (giữ nguyên)
├── packages/    # core, db (giữ nguyên)
├── .github/     # workflows/ (ci.yml, linear-sync.yml) + PULL_REQUEST_TEMPLATE.md (← PR_TEMPLATE.md)
├── infra/       # Dockerfile, fly.toml, compose (giữ nguyên)
├── scripts/     # shell ops (autopilot-onboard, ap-finish, scope-gate…) — ĐỌC PATH DOCS CỐ ĐỊNH (xem §7)
├── (root Linear files)  # GIỮ Ở ROOT đợt này: compare-linear.mjs, gen-linear-csv.mjs,
│                        #   linear-sync.mjs, sync-embedded.mjs, linear-import.csv,
│                        #   progress.json, plexco-dashboard.html, linear-snapshot.json
│                        #   (workflow + __dir phụ thuộc — xem P2 §6)
├── tools/linear/  # ⭐ TƯƠNG LAI / P2-OPTIONAL: chỉ dời scripts vào đây SAU khi patch
│                  #   __dir→repo-root resolve + workflow. KHÔNG làm mặc định đợt này.
└── docs/        # xem 3.2
```

### 3.2 `docs/` — nhóm theo mục đích + thứ tự đọc (numeric prefix tuỳ chọn)

```
docs/
├── README.md                    # DOC MAP: index toàn bộ, thứ tự đọc, ai đọc gì
│
├── 00-start-here/               # đọc trước tiên
│   ├── HANDOFF.md               # ← từ standards/ (CLAUDE.md trỏ tới — cập nhật pointer)
│   └── identity-model.md        # ← từ docs/ root (orientation identity)
│
├── product/                     # ← rename từ core/  (BRD/PRD/TDD/ROADMAP/CRM_DASHBOARD_BRD)
│
├── standards/                   # bất biến & nền kỹ thuật (giữ, bỏ HANDOFF ra 00-)
│   ├── decisions.md             # GIỮ TÊN — tham chiếu cực dày
│   ├── business-rules.md        # GIỮ TÊN
│   ├── core-db-architecture-principles.md
│   ├── deployment-infra.md  environments-setup.md
│   ├── feature-dependency-graph.md   # nguồn DUY NHẤT (xem §4 dedup)
│   ├── design-tokens.md              # nguồn DUY NHẤT (xem §4 dedup)
│   └── BUILD-STATUS.md
│
├── features/                    # GIỮ NGUYÊN (feature_*.md + BE/) — reference dày
│
├── channels/                    # ⭐ gộp các kênh
│   ├── telegram/   (← bot-telegram/)
│   ├── zalo/       (← bot-zalo/)
│   ├── messenger/  (← bot-messenger/)
│   └── web/        (← web-app/: README, design-brief, ux-sync-design, screens/)
│
├── research/                    # ← rename từ appendices/ (phân tích/audit/scan)
│   ├── bestminton-to-plexco-analysis.md
│   ├── bestminton-latest-scan-2026-06-21.md
│   ├── player-side-saas-AUDIT.md
│   └── player-side-saas-reconciliation.md
│
├── strategy/                    # ⭐ GTM & business (kéo từ root + appendices)
│   ├── gtm-strategy.md          (← root Plexco_GTM_Strategy.md)
│   ├── gtm-doi-soat-decision.md (← root)
│   ├── base-chat-package-feasibility.md (← root)
│   ├── native-app-strategy.md           (← appendices/)  # chiến lược native app
│   ├── saas-implementation-plan.md      (← appendices/)
│   └── saas-pnl-model.xlsx              (← appendices/)
│
├── proposals/                   # GIỮ NGUYÊN (kể cả file proposal này)
│   └── … + messenger-channel-design.md?  # xem §4: chuyển thành feature spec hoặc để proposals
│
├── automation/                  # ⭐ gộp phần DOCS-thuần của automation (KHÔNG move file scripts trỏ tới — xem ⚠️)
│   ├── README.md                # map subsystem + trỏ tới autopilot-kit paths ổn định
│   ├── playbook.md              (← root EXECUTION-PLAYBOOK.md)      # docs người đọc, an toàn move
│   ├── automation-overview.md   (← root AUTOMATION.md)             # an toàn move
│   ├── onboarding.md            (← root ONBOARDING-AUTOMATION.md)  # an toàn move (KHÁC docs/autopilot-ONBOARDING.md — path scripts verify)
│   └── product-backlog.md       (← root BACKLOG-P0-P3.md)          # checklist sản phẩm — KHÁC autopilot-backlog
│   #
│   # ⚠️ GIỮ NGUYÊN PATH (executable contract — scripts verify/hard-code):
│   #   docs/autopilot-ONBOARDING.md · docs/autopilot-backlog.md (slice registry)
│   #   docs/autopilot-invariant-catalog.md · docs/autopilot-parallel-scope-gate.md
│   #   docs/autopilot-manifests/ · docs/autopilot-templates/
│   # Chỉ move nhóm này ở PHASE RIÊNG high-risk (§6 P3b) kèm sửa 3 scripts + verify lệnh chạy.
│
└── templates/                   # ← từ root templates/  (doc/spec templates)
    ├── feature-spec-template.md
    ├── be-tech-spec-template.md
    └── feature-dev/
```

> **Numeric prefix (`00-start-here/`)**: chỉ áp cho nhóm có **thứ tự đọc** (start-here). Các nhóm còn lại dùng tên thuần cho dễ gõ/link. Nếu bạn thích tường minh thứ tự toàn bộ, có thể mở rộng `10-product/ 20-standards/ 30-features/…` — **cần bạn chốt** (Q1 §7).

---

## 4. Dedup & cleanup

| Mục | Hành động đề xuất |
|---|---|
| `design-tokens.md` (×3 — KHÔNG cùng loại, KHÔNG identical) | `docs/standards/design-tokens.md` = **nguồn Plexco thực**; `docs/web-app/design-tokens.md` = **overlap nhưng có token riêng của web** (vd `--bg-page`, `--bg-sidebar`, `--font-heading`, `--text-inverse`, `--transition-base`) → **merge token web-only vào standards TRƯỚC**, rồi thay web-app doc bằng 1 dòng trỏ về nguồn (KHÔNG xoá thẳng như duplicate). **`templates/design-tokens.md` là TEMPLATE GENERIC** (features/README §Template files trỏ tới) → **KHÔNG xoá**; rename `docs/templates/design-tokens-template.md` + update ref. |
| `feature-dependency-graph.md` (×2) | Nguồn duy nhất ở **`docs/standards/`**; bản trong `templates/feature-dev/` là template rỗng thì đổi tên `…-TEMPLATE.md` cho khỏi nhầm. |
| `messenger-channel-design.md` | Là feature spec chờ convert (README features đã ghi). Đề xuất: chuyển vào `channels/messenger/` hoặc convert thành `features/FE/feature_messenger_channel.md` khi tới P4.8 — **không để trong `research/`**. |
| `.DS_Store` | **Không tracked** (đã verify `git ls-files` = 0). Việc cần làm: **xoá bản local ignored** trên đĩa + **gộp 3 dòng `.DS_Store` trùng** trong `.gitignore` thành 1. (Không phải "xoá tracked".) |
| `progress.json` / `plexco-dashboard.html` / `linear-snapshot.json` | **Đã trả lời ở Q4 §8** — `progress.json` là **state versioned** (source-of-truth), `dashboard.html` là **projection** (nhúng EMBEDDED từ progress qua `sync-embedded.mjs`), `snapshot.json` **generated-nhưng-đang-versioned** bởi workflow. Move phải kèm sửa workflow + `__dir` (xem §6 P2). |
| `PR_TEMPLATE.md` | Chuyển `.github/PULL_REQUEST_TEMPLATE.md` (GitHub tự nhận). ⚠️ **Có reference**: `README.md` (L234) link `./PR_TEMPLATE.md`, `HANDOFF.md` (L98/L114) nhắc tên → update kèm (không phải "không đụng link"). |

---

## 5. Quy ước đặt tên (đề xuất chuẩn hoá dần)

- **Thư mục**: `kebab-case`, số nhiều theo loại (`features/`, `channels/`, `proposals/`).
- **File docs**: `kebab-case.md`. **Ngoại lệ giữ nguyên** (vì reference dày / tooling): `features/FE/feature_*.md`, `decisions.md`, `business-rules.md`, `BRD/PRD/TDD` (tên riêng quen thuộc).
- **File có ngày**: hậu tố `-YYYY-MM-DD` (đã dùng ở proposals — giữ).
- **Không** đổi tên hàng loạt trong `features/` ở đợt này (chi phí update link cao, rủi ro GitNexus/anchor). Chuẩn hoá naming là **đợt riêng**, sau khi cấu trúc thư mục ổn.

---

## 6. Kế hoạch migration theo phase (khi bạn duyệt — mỗi phase 1 PR)

1. **P1 — Cleanup nhẹ (rủi ro thấp, KHÔNG phải "no-link"):** xoá `.DS_Store` local ignored + gộp `.gitignore` (thao tác này no-link). Move `PR_TEMPLATE.md → .github/PULL_REQUEST_TEMPLATE.md` **KÈM update** `README.md` L234 + `HANDOFF.md` L98/L114.
2. **P2 — Gom root tooling Linear (phương án CHỐT: giữ data ở root):**
   - **GIỮ Ở ROOT** `progress.json`, `plexco-dashboard.html`, `linear-snapshot.json` (state versioned + workflow stage root path + `__dir` join). **KHÔNG move data đợt này.**
   - Chỉ khi muốn move **scripts** (`*.mjs`) → `tools/linear/`: vì `sync-embedded.mjs` dùng `join(__dir, "progress.json")`, phải **đổi resolve về repo-root** (không `__dir`) HOẶC hoãn move scripts. Nếu move scripts thì **update `.github/workflows/linear-sync.yml`** (`node linear-sync.mjs` → `node tools/linear/linear-sync.mjs`; phần `git add` root data giữ nguyên) + docs commands (README/AUTOMATION/ONBOARDING).
   - **Khuyến nghị đợt này:** chỉ gom `linear-import.csv` (input tĩnh) nếu muốn gọn, để nguyên scripts+data ở root cho tới khi có thời gian patch path-resolution + test workflow. (Rủi ro/độ lợi thấp → có thể bỏ P2.)
3. **P3a — Gom automation DOCS-thuần (an toàn):** `git mv` `EXECUTION-PLAYBOOK.md` (→ `playbook.md`), `AUTOMATION.md` (→ `automation-overview.md`), `ONBOARDING-AUTOMATION.md` (→ `onboarding.md`), `BACKLOG-P0-P3.md` (→ `product-backlog.md`) vào `docs/automation/`; viết `docs/automation/README.md` trỏ tới autopilot-kit. **KHÔNG động** các file scripts verify (autopilot-kit).
4. **P3b — (HIGH-RISK, phase riêng) Move autopilot-kit paths:** chỉ làm nếu thực sự cần. `git mv` `docs/autopilot-ONBOARDING.md`, `docs/autopilot-backlog.md`, `docs/autopilot-invariant-catalog.md`, `docs/autopilot-parallel-scope-gate.md`, `docs/autopilot-manifests/`, `docs/autopilot-templates/` **KÈM sửa** `scripts/autopilot-onboard.sh` (danh sách REQUIRED), `scripts/autopilot-scope-gate` (catalog+manifest path), `scripts/autopilot-backlog-reconcile` (`BL=`), rồi **chạy thử cả 3 lệnh verify pass**. Mặc định khuyến nghị: **GIỮ NGUYÊN**, bỏ qua P3b (Q5).
5. **P4 — Regroup docs buckets:** `core→product`, `appendices→research`, tạo `channels/` (gộp bot-*/web-app), `strategy/`, `00-start-here/` (HANDOFF + identity-model). **Update toàn bộ cross-link** + **`CLAUDE.md` pointer** (`docs/standards/HANDOFF.md` → `docs/00-start-here/HANDOFF.md`, `docs/standards/decisions.md` giữ nguyên).
6. **P5 — Dedup:** **merge token web-only** (`--bg-page`/`--bg-sidebar`/`--font-heading`/`--text-inverse`/`--transition-base`…) từ `docs/web-app/design-tokens.md` vào `docs/standards/design-tokens.md` **rồi mới** thay web-app doc bằng pointer (không xoá thẳng — 2 bản overlap, không identical); **rename** `templates/design-tokens.md` → `docs/templates/design-tokens-template.md` (KHÔNG xoá — template generic, update ref `features/README.md`); hợp nhất `feature-dependency-graph`; xử lý `messenger-channel-design`.
7. **P6 — (tuỳ chọn) Chuẩn hoá naming** đợt riêng nếu chốt Q2.

Mỗi phase: chạy link-checker + `git grep` path cũ để không sót reference; **sau mỗi phase có scripts/workflow** (P2, P3b) chạy thử lệnh liên quan; sau P4 **re-run GitNexus `analyze`** nếu có path code đổi (docs move không ảnh hưởng code-graph).

---

## 7. Rủi ro & lưu ý

- **Cross-reference dày** (đã thấy qua các round review DD-32/DD-33). `git mv` không tự sửa link trong nội dung Markdown → bắt buộc có **link-update pass** mỗi phase.
- **`CLAUDE.md` trỏ cứng** `docs/standards/HANDOFF.md` + `docs/standards/decisions.md`. Nếu chuyển HANDOFF ra `00-start-here/`, phải sửa CLAUDE.md cùng commit, nếu không mọi session mới đọc sai.
- **GitNexus** index theo path (`plexco-app`, 1873 symbols…). Move docs không ảnh hưởng code-graph, nhưng nếu sau này move trong `packages/` thì phải reindex + dùng `rename` tool (không find-replace) — **ngoài scope đợt docs này**.
- **Autopilot scripts = executable contract (đã verify).** `autopilot-onboard.sh` verify list REQUIRED gồm 6+ path docs; `autopilot-scope-gate` derive catalog + `--manifest docs/autopilot-manifests/…`; `autopilot-backlog-reconcile` hard-code `BL="$REPO/docs/autopilot-backlog.md"`. Move bất kỳ path nào trong nhóm này **KHÔNG kèm sửa script = gãy autopilot**. → tách **P3b high-risk** riêng.
- **GitHub Action `linear-sync.yml`** chạy `node linear-sync.mjs` và `git add`/stage **root** `progress.json`/`linear-snapshot.json`/`plexco-dashboard.html`. Move cụm Linear mà không sửa workflow ⇒ CI sync gãy.
- **`__dir`-relative resolve**: `sync-embedded.mjs` đọc `join(__dir, "progress.json")` + `plexco-dashboard.html`. Move script phải move **data cùng thư mục**, nếu không join sai.
- **`progress.json` là state versioned, KHÔNG phải cache** — xoá/gitignore nhầm sẽ mất source-of-truth dashboard (xem Q4).
- **Files reference lẫn nhau** ở root (Linear `.mjs`) — move nhóm phải move trọn cụm + update require/read path.
- Đây là repo có `.autopilot/*` gitignored (trừ `maturity-ledger.md`) — không đụng.

---

## 8. Quyết định cần bạn chốt (trước khi thực hiện)

| ID | Câu hỏi | Khuyến nghị |
|---|---|---|
| Q1 | Numeric prefix cho **mọi** nhóm docs (`10-product/…`) hay chỉ `00-start-here/`? | Chỉ `00-start-here/` (đủ rõ, ít noise) |
| Q2 | Có chuẩn hoá naming `features/FE/feature_*.md` → kebab không? | **Không** đợt này (chi phí link cao); để đợt riêng |
| Q3 | `messenger-channel-design.md`: đưa `channels/messenger/` hay convert thành `features/FE/feature_messenger_channel.md`? | `channels/messenger/` tới khi vào P4.8 rồi convert |
| Q4 | `progress.json`/`snapshot`/`dashboard` bản chất là gì? | **Đã tra được từ docs**: `progress.json` = **state versioned, source-of-truth** (giữ commit, KHÔNG gitignore); `plexco-dashboard.html` = **projection** (nhúng từ progress qua `sync-embedded.mjs`); `linear-snapshot.json` = **generated nhưng đang được workflow commit** (chỉ đổi thành gitignore nếu redesign flow sync). Còn lại: bạn chỉ cần chốt **có move khỏi root không** (nếu có → sửa workflow + __dir). |
| Q5 | Làm tới phase nào? | **P1, P2, P3a, P4, P5** an toàn (docs/tooling có kiểm soát). **P3b (move autopilot-kit) mặc định BỎ** — chỉ làm nếu bạn thực sự muốn, vì phải sửa 3 scripts + verify. P6 naming tuỳ. |

---

## 9. Tóm tắt "trước → sau" (một dòng)

- Root: từ **~20 file lẻ** → chỉ còn config chuẩn + `README/CLAUDE/AGENTS/CHANGELOG`; docs-business (GTM/automation/strategy) vào `docs/`. **Cụm Linear + `progress.json`/dashboard/snapshot GIỮ Ở ROOT** đợt này (`tools/linear/` chỉ là đích P2-optional, làm sau khi patch `__dir`/workflow).
- `docs/`: từ **file lẻ trộn thư mục + 3 folder channel 1-README** → 9 nhóm rõ mục đích, `channels/` gom kênh, thứ tự đọc qua `00-start-here/`. `automation/` chỉ gom **docs-thuần**; **autopilot-kit giữ nguyên path** (executable contract) trừ khi làm phase P3b high-risk.
- Hợp nhất 2 cặp docs overlap (`design-tokens`: **merge token web-only vào standards trước**, không xoá; `feature-dependency-graph`), dọn `.DS_Store` (local, không tracked), `PR_TEMPLATE → .github/` (kèm update README/HANDOFF).

> **✅ ĐÃ TRIỂN KHAI 2026-07-06** theo mặc định khuyến nghị: **P1 + P3a + P4 + P5** (git mv giữ history + update toàn bộ cross-link). **Bỏ P2** (Linear + `progress.json`/dashboard/snapshot giữ nguyên ở root). **Bỏ P3b** (autopilot-kit path giữ nguyên — scripts không đụng). Q1=chỉ `00-start-here/`; Q2=không đổi tên `feature_*.md`; Q3=`channels/messenger/`. Link-checker: 0 broken; các link companion Bestminton đã được chuẩn hoá sang GitHub URL ngày 2026-07-15. **Dọn thủ công trên máy bạn:** `rm -f .git/index.lock` (lock cũ do mount) + `rmdir docs/appendices` (thư mục rỗng) — git không track dir rỗng nên vô hại.
