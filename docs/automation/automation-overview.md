# 🤖 AUTOMATION — Break task · sync Linear ⇄ progress.json · auto-assign

Cơ chế tự chia nhỏ module thành sub-task, đẩy vào **Linear** + **progress.json**, tự assign, và mirror status từ Linear về tracker. Chạy theo 3 chế độ: **on-demand** (bạn gọi), **scheduled** (mỗi tuần), và **realtime** (GitHub/Linear).

> Vì sao cần LLM: "break task" thông minh = đọc BRD/PRD/TDD → suy ra DoD đúng ngữ cảnh, việc một script thuần không làm được. Nên "bộ não" là Claude; Linear MCP lo tạo issue + assign; `progress.json` + `sync-embedded.mjs` lo nguồn sự thật + dashboard.

---

## Quy ước (khoá đối chiếu)

| Khái niệm | Linear | progress.json |
|---|---|---|
| Module (epic) | issue title prefix `[M#]` + label `plexco-mvp` | `modules[].id` + `modules[].linearId` |
| Sub-task (DoD) | sub-issue (parentId = issue `[M#]`) | `modules[].subtasks[]` (`title`, `identifier`, `status`, `assignee`) |
| Assignee | `assignee` | `modules[].assignee` |
| Trạng thái | workflow state | enum `not_started/in_progress/in_review/done/blocked` |

Project: **Plexco MVP** (team `maingocanh1`). Khoá `[M#]` **không được đổi** — đó là cầu nối 2 nguồn.

---

## Chế độ 1 — On-demand (bạn gọi, kiểm soát từng lần)

Nói với Claude (trong Cowork, đã nối Linear):

- **"break M7"** → Claude: đọc docs cho M7 → sinh 5–8 sub-task DoD → tạo sub-issue trong Linear dưới `[M7]` (MNA-11), gắn label `plexco-mvp`, assign cho bạn → cập nhật `modules[M7].subtasks` với status `not_started` → chạy `sync-embedded.mjs` → báo cáo. **Không bật module `in_progress` khi chỉ mới break.**
- **"break P4"** → chọn module kế trong phase P4 còn trống; nếu đang có module dở thì **no-op** để giữ WIP=1.
- **"mark M2 done"** → chuyển issue `[M2]` (MNA-6) và các sub-issue liên quan sang Done trên Linear → chạy `linear-sync.mjs`/`sync-embedded.mjs` để `progress.json` khớp.
- **"refresh compare"** → chạy `compare-linear.mjs --write` (cần `LINEAR_API_KEY`) hoặc Claude đọc Linear qua connector → cập nhật `linear-snapshot.json`.

## Chế độ 2 — Scheduled (tự chạy mỗi tuần)

Một scheduled task chạy **mỗi Thứ 2** làm đúng vòng "break module kế":

0. **WIP GUARD (cứng):** nếu còn **module dở** (module non-postMVP có subtasks chưa all-done, hoặc status ∈ {in_progress, in_review}) → **NO-OP** + báo. Không break thêm.
1. Nếu rảnh: chọn **module kế trên critical path** đang `not_started` và `subtasks` rỗng (bỏ post-MVP).
2. Decompose thành DoD sub-task từ docs/core + BACKLOG.
3. Tạo sub-issue trong Linear dưới issue `[M#]`, **assign cho bạn**, label `plexco-mvp`.
4. Cập nhật `progress.json`: thêm `subtasks` (status `not_started`). **KHÔNG set module `in_progress`** — để roll-up tự lo khi bạn bắt đầu subtask. Chạy `sync-embedded.mjs`.
5. Gửi tóm tắt: module nào vừa break, mấy sub-task, link Linear.

> **WIP=1** được bảo vệ ở 2 lớp: (a) guard bước 0 không break khi còn module dở; (b) break không bật in_progress, nên module chỉ "đang làm" khi bạn thật sự branch một subtask.

---

## Scripts bảo trì

| Script | Việc | Khi nào chạy |
|---|---|---|
| `sync-embedded.mjs` | Ghi `progress.json` → khối `EMBEDDED` trong dashboard (hết drift) | **Sau mỗi lần sửa `progress.json`** |
| `linear-contract.mjs` | Shared validator cho module/subtask ID, status và title contract | `compare-linear`/`linear-sync` import tự động |
| `compare-linear.mjs [--write]` | Đối chiếu drift status/title/cấu trúc; `--write` xuất `linear-snapshot.json` | Exit 2 nếu lệch hoặc thiếu module/subtask (cần `LINEAR_API_KEY`) |
| `linear-sync.mjs [--check]` | Pull Linear → ghi status theo roll-up; dừng trước khi ghi nếu title/cấu trúc lệch | GitHub Action realtime hoặc chạy tay |
| `linear-reconcile.mjs --check\|--apply` | Push title/subtask/parent/project/label canonical từ `progress.json` → Linear; default read-only, apply explicit, idempotent | Khi `linear-sync` báo structural/title drift; chạy `reconcile-check` trước `reconcile-apply` trong workflow |
| `gen-linear-csv.mjs` | Sinh `linear-import.csv` (đường CSV, không cần OAuth) | Khi cần re-seed / seed nơi khác |

```bash
# vòng cập nhật điển hình sau khi đổi cấu trúc/status
node sync-embedded.mjs        # dashboard offline khớp progress.json
LINEAR_API_KEY=lin_api_xxx node compare-linear.mjs --write   # snapshot để dashboard so sánh
LINEAR_API_KEY=lin_api_xxx node linear-sync.mjs --check       # dry-run: Linear status sẽ đổi gì?
LINEAR_API_KEY=lin_api_xxx node linear-reconcile.mjs --check  # dry-run structure progress → Linear
LINEAR_API_KEY=lin_api_xxx node linear-reconcile.mjs --apply  # explicit mutation + post-verify
```

---

## Nguyên tắc ownership theo field (để compare có nghĩa)

- **Linear sở hữu status**: `subtasks[].status` lấy theo identifier Linear; `module.status` được roll-up từ subtask nếu module có subtask, còn module chưa break thì lấy issue cha `[M#]`.
- **progress.json sở hữu cấu trúc**: roadmap, gate, invariant, điểm, assignee map, `linearId`, và title module/subtask. Khi break/assign, Claude ghi cấu trúc vào cả Linear lẫn `progress.json` để hai bên khởi điểm khớp. `compare-linear`/`linear-sync` fail-closed nếu title lệch hoặc issue bị thiếu.
- `compare-linear.mjs` chỉ **đọc** và báo drift. `linear-sync.mjs` ghi status từ Linear về `progress.json`; `linear-reconcile.mjs` đi chiều ngược lại **chỉ cho structure/title canonical** và chỉ mutate khi có `--apply` explicit.

---

## Chế độ 3 — Realtime auto-status (KHÔNG cần nhắc) — kích hoạt khi có repo GitHub

> Truyền tín hiệu thật → tự flip trạng thái. "Đang làm" được suy từ **hoạt động git**, không phải bạn bấm tay.
> Lưu ý: cần repo Plexco trên GitHub (dựng ở M1). File dưới đây đã sẵn trong folder, drop vào repo là chạy.

**Luồng realtime:**

```
bạn tạo branch maingocanh/mna-63-... / mở PR
        │  (Linear×GitHub native, server-side, tức thì)
        ▼
Linear issue MNA-63 → In Progress / In Review / Done
        │  (Linear webhook → repository_dispatch: linear-changed)
        ▼
GitHub Action linear-sync.yml → node linear-sync.mjs
        │  pull Linear → ghi progress.json + linear-snapshot.json + sync-embedded
        ▼
commit "chore: sync progress from Linear [skip ci]"  → dashboard khớp
```

**Cài 1 lần (khi repo GitHub tồn tại):**

1. **Bật Linear × GitHub** (Linear → Settings → Integrations → GitHub): link repo Plexco. Bật auto-move:
   - *branch created* → In Progress · *PR opened* → In Progress/In Review · *PR merged* → Done.
   - Mỗi issue đã có sẵn branch name (vd `maingocanh/mna-63-...`) — dùng đúng tên đó khi `git checkout -b`.
2. **Thêm secret** `LINEAR_API_KEY` vào GitHub repo (Settings → Secrets → Actions). Lấy ở Linear → Settings → Security & access → Personal API keys.
3. **Drop file** `linear-sync.mjs` (root) + `.github/workflows/linear-sync.yml` vào repo (đã có sẵn trong folder này).
4. **(Realtime đúng nghĩa — tùy chọn)** Linear → Settings → API → Webhooks: tạo webhook **Issue** trỏ tới một relay nhỏ (Cloudflare Worker/Vercel) gọi GitHub `repository_dispatch {event_type:"linear-changed"}`. Không làm bước này thì Action vẫn chạy khi **push** + **cron 10 phút** (near-realtime).

**Hai chiều:**
- *Code → status*: branch/PR của **sub-issue** (vd `maingocanh/mna-63-...`) flip sub-issue tức thì → `linear-sync` **roll-up** lên module cha → ghi progress.json. Không cần đụng issue `[M#]`.
- *Linear UI → status*: bạn kéo sub-issue (hoặc issue cha khi module không có subtask) → webhook/cron → roll-up → progress.json tự đổi.
- **Ownership:** Linear sở hữu `status` (module + subtask); progress.json sở hữu cấu trúc (gate/invariant/roadmap/module + subtask title/khoá). Title Linear phải mirror canonical; lệch hoặc thiếu issue làm gate fail-closed. Đừng sửa `status` tay khi realtime đã bật.
- **Roll-up rule:** module có subtasks → status = (all done→done · any blocked→blocked · any in_progress→in_progress · any in_review→in_review · any done→in_progress · else not_started); không có subtasks → status issue cha.

**Trước khi có repo:** dùng tạm Chế độ 1/2 (on-demand "mark M7 done" / scheduled weekly). `linear-sync.mjs` cũng chạy tay được ngay nếu có `LINEAR_API_KEY`:

```bash
LINEAR_API_KEY=lin_api_xxx node linear-sync.mjs          # pull Linear → ghi progress.json
LINEAR_API_KEY=lin_api_xxx node linear-sync.mjs --check  # dry-run, exit 2 nếu có thay đổi
```
