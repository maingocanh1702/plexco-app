# Runbook — gỡ khối uncommitted và mở lại hàng đợi (2026-07-29)

> Soạn tại `main` = `origin/main` = `3d75c90`. Working tree bẩn **88 file** (86 docs + `.env.example`
> + `README.md`) + 4 untracked. Runbook này **chỉ chạy trên máy owner** — sandbox không git-write
> được trong repo mount.
> Chạy tuần tự. Mỗi bước có điều kiện dừng riêng; đừng gộp bước bằng `;`, dùng `&&`.

---

## §0. Vì sao phải khoá trước khi commit

`.githooks/pre-commit` **từ chối mọi commit trên `main` từ root working copy** nếu caller không giữ
root lock. Đó không phải nghi thức: sự cố 2026-07-22 (`eba1c27`) là hai session Cowork cùng identity
chia nhau một `.git/index`, một bên `git commit` trong khi file của bên kia đang staged — commit nuốt
nội dung của session khác dưới subject của mình rồi push.

Khối 88 file này là **nhiều lớp phiên việc chồng lên nhau**, đúng điều kiện sinh ra sự cố đó. Giữ khoá
suốt cả loạt commit, thả một lần ở cuối.

```bash
cd ~/Projects/Plexco\ app && \
  scripts/autopilot-root-lock status
```

```bash
cd ~/Projects/Plexco\ app && \
  scripts/autopilot-root-lock acquire --owner docs-unblock-0729
```

**Bắt buộc — export trong ĐÚNG shell sẽ commit:**

```bash
export PLEXCO_COMMIT_OWNER='docs-unblock-0729'
```

Không phải tuỳ chọn. `.githooks/pre-commit:46` đọc `PLEXCO_COMMIT_OWNER` và HALT
`ROOT_COMMIT_NO_OWNER` nếu lock đang giữ mà biến chưa set — giữ lock thôi không đủ. Mở tab terminal
mới là mất biến; export lại.

Thả ở **§4**, không thả giữa chừng.

> **⚠️ `fatal: Unable to create '.git/index.lock': File exists` ở commit đầu tiên — kiểm owner trước
> khi hoảng.** Session Cowork đọc repo bằng `git status` từ sandbox sẽ **lấy** `.git/index.lock` rồi
> **không unlink được** (mount không cho sandbox xoá file), nên lock 0-byte nằm lại vĩnh viễn và chặn
> mọi git write. Đây **không** phải commit dở dang.
>
> ```bash
> cd ~/Projects/Plexco\ app && ls -la .git/index.lock
> ```
>
> ⚠️ **Đừng dùng owner của file làm dấu hiệu.** Mount map UID hai chiều: cùng file đó, nhìn từ sandbox
> là `compassionate-friendly-brown`, nhìn từ terminal máy là `maingocanh staff`. Từ phía anh, owner
> **luôn** là anh kể cả khi lock do sandbox tạo — test đó vô dụng ở đây.
>
> Hai dấu hiệu dùng được từ terminal máy: **size 0** (commit thật đang chạy để lại index có nội dung)
> · **mtime cũ hàng chục phút**. Cộng thêm một phép kiểm process:
>
> ```bash
> ps aux | grep "[g]it " | grep -v fsmonitor
> ```
>
> Trống ⇒ không có git nào đang chạy ⇒ `rm -f .git/index.lock` an toàn. `fsmonitor--daemon` là daemon
> dài hạn và **không** giữ index.lock, nên lọc nó ra.
>
> **⚠️ zsh, không phải bash.** Mọi lệnh `grep -r` dưới đây dùng `--include='*.md'` **có nháy đơn**.
> Bỏ nháy thì zsh cố glob `*.md` trong thư mục hiện tại, không khớp, và abort cả lệnh với
> `zsh: no matches found` — nếu lệnh có `| wc -l` phía sau thì nó vẫn in ra `0`, trông y hệt "không
> tìm thấy gì". Bash bỏ qua glob không khớp nên cùng lệnh đó chạy được; đừng chép lệnh giữa hai shell.

---

## §1. Ba lỗi phải sửa TRƯỚC khi commit — ✅ ĐÃ SỬA 2026-07-29

> **Trạng thái: cả ba đã sửa trong working tree.** Phần dưới giữ lại nguyên phần chẩn đoán + lệnh
> verify để đối chiếu; đừng sửa lại. Chạy khối verify ở cuối §1 để xác nhận trước khi commit.
> Working tree từ 88 → **98 entry** sau khi sửa (thêm `CLAUDE.md`, `HANDOFF.md`, `ONBOARDING.md`,
> `level3-handoff.md` — bốn file trước đó sạch, nay bẩn vì fix `KIT_VERSION`; xem §2 commit 0).

Sửa trước, vì commit rồi thì phải sửa bằng commit thứ hai và bản ghi authority sẽ mang một trạng thái
sai trong khoảng giữa.

### 1.1 `AUTHORITY_SHA` mâu thuẫn giữa hai artifact DD-32 — chặn commit Theme B

Hai file cùng một phiên, cùng một initiative, khai hai authority khác nhau:

```bash
cd ~/Projects/Plexco\ app && \
  grep -n "AUTHORITY_SHA" docs/issues/session-management-acceptance-checklist.md docs/decisions/analysis/dd-32-booking-funnel-analysis.md
```

Kỳ vọng thấy: checklist khai `2dc9b8c…`, analysis khai `784bc8d…`. Khối readiness trong checklist là
**mới thêm trong working tree** (bản committed không có khối nào), nên `2dc9b8c` là giá trị chép sót,
không phải pin lịch sử cần giữ. Sửa checklist cho khớp analysis.

> ⚠️ Sau khi commit Theme B, **cả hai** phải re-pin lần nữa: chính commit đó là thứ đóng closure row 12
> (*"current pack is uncommitted working-tree state"*). Đây là hai bước có chủ đích, không phải sửa hai lần.

### 1.2 `784bc8d` đang được gọi là "current HEAD" ở 32 file — chặn commit Theme E

```bash
cd ~/Projects/Plexco\ app && \
  grep -rl "784bc8d" --include='*.md' docs/ README.md | wc -l && \
  grep -n "Current HEAD" docs/standards/BUILD-STATUS.md
```

Kỳ vọng: `32`, và `BUILD-STATUS.md:7` khai `**Current HEAD `main`** = `784bc8dd…`` kèm
`migrations **0000–0024** (25 file)`.

`784bc8d` là commit thật, nhưng nó **không còn là HEAD** kể từ `3d75c90` (5 commit sau: `49fd155`,
`1747b8c`, `ed38106`, `ae9bc37`, `3d75c90`). Hai lối, chọn một:

- **(a) Re-pin sang `3d75c90`** — đúng nhất. Năm commit xen giữa đều là autopilot-kit/HANDOFF docs
  nên **không** khẳng định thực chất nào đổi; nhưng `0025` merged trong `3d75c90` nên **tail migration
  đổi `0024`→`0025` và test count `537`→`561`**. Re-pin thì phải sửa cả hai con số đó, ở mọi file khai chúng.
- **(b) Đổi cách diễn đạt** từ *"current HEAD"* thành *"authority snapshot pinned at `784bc8d`"* —
  rẻ hơn, và đúng bằng cách `HANDOFF.md` đã diễn đạt. Nhưng vẫn phải sửa tail/test count ở đâu khai.

**Khuyến nghị (b) cho phần diễn đạt + sửa tay hai con số tail/test.** Lý do: `784bc8d` là snapshot mà
các verdict trong khối đã đo trên đó; re-pin sang `3d75c90` biến chúng thành khẳng định chưa được đo.

### 1.3 `KIT_VERSION 10` stale ở 4 chỗ — sửa kèm, rẻ

Kit thật đã là **11**; `HANDOFF.md` changelog v1.28 tự ghi *"kit KIT_VERSION 11 (`ed38106`)"* nhưng
chính dòng nó nói là đã sửa vẫn đọc `10`.

```bash
cd ~/Projects/Plexco\ app && \
  awk '/^# KIT_VERSION:/{print "installed = "$3; exit}' scripts/autopilot-scope-gate && \
  grep -rn "KIT_VERSION 10" --include='*.md' docs/ CLAUDE.md
```

Kỳ vọng `installed = 11` và **7 hit**, trong đó **4 hit là stale thật** cần sửa thành `11`:
`docs/autopilot-ONBOARDING.md:14` · `docs/00-start-here/HANDOFF.md:29` ·
`docs/autopilot-templates/level3-handoff.md:22` · `CLAUDE.md:60`.
Ba hit còn lại nằm trong **chính file runbook này** — chúng trích lại giá trị stale để mô tả nó,
**giữ nguyên**. Ghi rõ vì "grep ra 7, sửa 4" trông như sót nếu không nói trước.

### Verify §1 đã đóng

```bash
cd ~/Projects/Plexco\ app && \
  grep -n "^AUTHORITY_SHA" docs/issues/session-management-acceptance-checklist.md docs/decisions/analysis/dd-32-booking-funnel-analysis.md && \
  grep -rn "KIT_VERSION 10" --include='*.md' docs/ CLAUDE.md | grep -v runbook-unblock; \
  echo "--- nếu dòng KIT_VERSION trống là sạch ---" && \
  node scripts/check-review-readiness.mjs && pnpm format:check
```

Kỳ vọng: hai `AUTHORITY_SHA` **cùng** `784bc8dd…` · không hit `KIT_VERSION 10` nào ngoài runbook ·
`review-readiness: PASS (… 26 active verdict block(s))` · prettier sạch.

**Cách sửa 1.2 đã dùng (lối b, đã áp dụng):** `BUILD-STATUS.md:7` đổi *"Current HEAD"* →
*"Authority snapshot"* và thêm một dòng **delta snapshot → live** ghi rõ 5 commit xen giữa, trong đó 4
cái là kit/HANDOFF docs (không đổi khẳng định nào) và `3d75c90` đổi đúng hai thứ: tail `0024`→`0025`,
suite `537`→`561`. `HANDOFF.md:6` sửa số trực tiếp vì nó khai *"PASS trên current HEAD"*: 537→**561**
(DB 219→**243**), tổng 550→**574**; số **file** giữ **32** vì test mới vào hai file đã có
(`rls-invariants.test.ts`, `migrate.test.ts`) — đúng scope manifest của slice, không phải suy đoán.

**Vì sao không phải sửa 19 file khác khai `0000–0024`:** đo rồi — phần lớn BE tech doc **đã de-pin**
tail từ slice `docs-migration-tail-0018-to-0020-sweep` (*"verify tail hiện hành tại
`packages/db/migrations/`, không hard-pin số"*), nên chúng miễn nhiễm với chuyện này. Chỉ hai chỗ khai
**currency** thật là `BUILD-STATUS.md:7` và `HANDOFF.md:6`. Đây là ví dụ de-pin trả lãi: một sweep làm
trước đó đã chặn 17 file khỏi việc phải sửa hôm nay.

---

## §2. Tám commit (0–7), đúng thứ tự

> **Tiến độ thực thi 2026-07-29** — cập nhật khi chạy, không phải kế hoạch.
>
> | # | SHA | File | Trạng thái |
> |---|---|---|---|
> | 0 | `66c8d02` | 3 | ✅ `KIT_VERSION` 10→11 |
> | 1 | `d86a85e` | 10 | ✅ Theme A — live substrate + DD-91 payment truth |
> | 2+3 | `adf5eff` | 27 | ✅ Theme B+C — DD-32 Option D + DD-45a fence |
> | 3.5 | `3acb315` | 2 | ✅ Re-pin hai artifact DD-32 → `adf5eff`, closure 9/12→10/12 |
> | 4 | `e441901` | 14 | ✅ Theme D — FE governance (FE giữ HOLD, `design.pen` cố ý chưa track) |
> | 5 | `3225f3f` | 38 | ✅ Theme E — Chat plan v1.8 mirror + `784bc8d` thành authority snapshot |
> | 6 | `1ca97b1` | 2 | ✅ task contract + runbook này |
> | 7 | `8582444` | 2 | ✅ backlog reconcile + Verdict 27 + đóng capacity-chk tại `adf5eff` |
> | 8 | — | 2 | ⬜ **phát sinh:** sửa `pnpm lint` đỏ có sẵn trên main |
>
> **Commit 3.5 là bước phát sinh trong lúc chạy, không có trong kế hoạch v0.1** — §1.1 chỉ nói "sửa
> `AUTHORITY_SHA` cho khớp", nhưng sau khi Theme B land thì chính commit đó đóng closure row 12, nên
> hai artifact phải re-pin sang SHA mới. Kế hoạch gốc có ghi *"đây là hai bước có chủ đích"* nhưng
> không cấp cho nó một số commit; nay có.
>
> Tổng đã land: **94 file**. Còn lại 4 entry — 2 cho commit 7, 1 cho commit 6 (`runbook` + `task
> contract` = 2 file), và `design.pen` + `docs/archive/email-hoi-provider-2026-07-23.md` cố ý để ngoài.

**Ràng buộc phải biết trước:** 29 file mang changelog row của 2–3 lớp phiên khác nhau, nên **không tách
sạch theo file được**. Runbook này dùng lối "mỗi file đa-lớp rơi vào theme cuối cùng của nó" — commit
sau sẽ mang theo nội dung lớp trước, và đó là chủ ý, không phải lỗi.

Hai file đặc biệt: `docs/autopilot-backlog.md` và `docs/slice-readiness-verdicts.md` mang **cả lớp cũ
lẫn reconcile 29/07**, và trong `slice-readiness-verdicts.md` hai changelog row (`v2.5` của lớp cũ,
`v2.6` của hôm nay) nằm **kề nhau trong cùng một hunk** — tách chỉ được bằng `git add -p` cắt hunk.
Không đáng. Cả hai file đi vào **commit 7**.

### Commit 0 — fix `KIT_VERSION` stale (3 file, độc lập mọi theme)

Ba file này trước §1 **hoàn toàn sạch** và không thuộc theme nào, nên tách được sạch. Đi đầu vì
`CLAUDE.md` là project instruction: mọi phiên sau đọc nó trước.

```bash
cd ~/Projects/Plexco\ app && \
  git add CLAUDE.md docs/autopilot-ONBOARDING.md docs/autopilot-templates/level3-handoff.md && \
  git diff --cached --stat && \
  git commit -m "docs(autopilot): correct the stale KIT_VERSION 10 pin to the installed 11"
```

> `docs/00-start-here/HANDOFF.md` **không** vào commit này: nó cũng mang fix test-count của §1.2, thuộc
> cùng câu chuyện live-truth với `BUILD-STATUS.md`. Nó đi ở **commit 5**.

### Commit 1 — Theme A (27/07: DD-91 payment truth + live substrate)

```bash
cd ~/Projects/Plexco\ app && \
  git add docs/features/feature_billing_lifecycle.md docs/features/BE/feature_billing_lifecycle_tech.md \
          docs/features/feature_connector_onboarding.md docs/features/feature_security_operations.md \
          docs/features/BE/feature_user_settings_tech.md docs/archive/session-service-reslice-analysis.md \
          docs/standards/core-db-architecture-principles.md docs/probes/probe-strict-cookie-completion-hop.md \
          docs/research/auto-debt-reconciliation-regional-availability-2026-07-27.md .env.example && \
  git diff --cached --stat
```

Kiểm danh sách staged rồi mới commit:

```bash
cd ~/Projects/Plexco\ app && \
  git commit -m "docs: reconcile the live substrate 0019-0024 and split DD-91 payment truth from regional availability"
```

### Commit 2+3 — Theme C gộp vào Theme B (DD-32 Option D)

Theme C (DD-45a waitlist fence) **không có file riêng** — nó sống trong 4 file của theme khác. Tách nó
ra đòi cắt hunk trong `feature_session_management.md`/`_tech.md`. Gộp, và ghi rõ trong message.

Sửa §1.1 trước, rồi:

```bash
cd ~/Projects/Plexco\ app && \
  git add docs/00-start-here/identity-model.md docs/features/feature_channel_booking_funnel.md \
          docs/features/BE/feature_channel_booking_funnel_tech.md \
          docs/features/feature_identity.md docs/features/BE/feature_identity_tech.md \
          docs/features/feature_cross_club_join.md docs/features/BE/feature_cross_club_join_tech.md \
          docs/features/feature_zalo_channel.md docs/features/BE/feature_zalo_channel_tech.md \
          docs/channels/messenger/ docs/channels/zalo/ docs/probes/pre-code-open-items-2026-07-16.md \
          docs/features/feature_session_management.md docs/features/BE/feature_session_management_tech.md \
          docs/features/feature_marketplace_discovery.md docs/features/BE/feature_marketplace_discovery_tech.md \
          docs/features/feature_player_messenger.md docs/features/BE/feature_player_messenger_tech.md \
          docs/features/feature_web_auth_onboarding.md docs/features/BE/feature_web_auth_onboarding_tech.md \
          docs/features/feature_payment_reconcile.md docs/features/BE/feature_payment_reconcile_tech.md \
          docs/decisions/analysis/dd-32-booking-funnel-analysis.md docs/decisions/analysis/dd-45-waitlist-analysis.md \
          docs/decisions/analysis/dd-73-78-share-activity-analysis.md docs/issues/session-management-acceptance-checklist.md && \
  git diff --cached --stat
```

```bash
cd ~/Projects/Plexco\ app && \
  git commit -m "docs(dd-32): replace Option A with Option D link-or-verified-pay funnel; carry the DD-45a waitlist-position fence"
```

> Commit này cũng land deliverable của backlog task `docs-session-capacity-chk-landed-reconcile`
> (`feature_session_management_tech.md:123`/`:390`/`:400`). **Không mở slice mới cho nó.**

### Commit 4 — Theme D (FE governance) — cần một quyết định trước

`design.pen` (562 KB, untracked, mtime 22/07) được **20 file** tham chiếu, và DD-58/DD-81 vừa biến
pipeline Pencil thành **delivery gate bắt buộc**. Commit theme này mà không quyết `design.pen` =
kích hoạt một cổng không ai qua được.

```bash
cd ~/Projects/Plexco\ app && \
  ls -la design.pen && grep -rl "design.pen" --include='*.md' docs/ | wc -l && \
  { git check-ignore -v design.pen || echo "(không bị gitignore)"; }
```

Quyết **track** hay **không track**; nếu không track thì ghi lý do vào `docs/channels/web/README.md`
trong cùng commit. Rồi:

```bash
cd ~/Projects/Plexco\ app && \
  git add docs/standards/frontend-architecture.md docs/standards/design-tokens.md \
          docs/standards/design-tokens-benchmark.md docs/standards/token-needs-matrix.md \
          docs/channels/web/ docs/templates/feature-dev/ && \
  git diff --cached --stat && \
  git commit -m "docs: activate DD-57/58/59/81 FE governance and the Pencil delivery gate (FE stays HOLD)"
```

### Commit 5 — Theme E (re-pin authority) + live-truth delta

Quét toàn bộ `docs/` + `README.md` còn lại. `git add -A -- docs/` sẽ cuốn luôn `HANDOFF.md` và
`BUILD-STATUS.md` (đã mang fix §1.2) — đúng ý.

```bash
cd ~/Projects/Plexco\ app && \
  git add -A -- docs/ README.md && \
  git reset -- docs/autopilot-backlog.md docs/slice-readiness-verdicts.md docs/autopilot/contracts/autopilot-deps-security-bump.md docs/archive/runbook-unblock-2026-07-29.md docs/archive/email-hoi-provider-2026-07-23.md && \
  git diff --cached --stat
```

`git reset` ở trên giữ hai file đa-lớp lại cho commit 7, hai file mới của hôm nay cho commit 6, và
**loại `docs/archive/email-hoi-provider-2026-07-23.md`**. File cuối là bẫy: `-A` cuốn cả untracked, mà file đó
là **orphan** — 151 dòng, đề 23/07 (cũ hơn lớp mới nhất 5 ngày), **zero inbound reference** trong toàn
bộ `docs/`. Nội dung là ba email hỏi provider để mở countdown cho các enablement gate. Nó sẽ lặng lẽ
đi nhờ commit 5 dưới một subject không liên quan nếu không chặn. Quyết riêng ở §2 commit 7 ghi chú.

Kiểm danh sách staged rồi:

```bash
cd ~/Projects/Plexco\ app && \
  git commit -m "docs: mirror the Chat plan v1.8 PLAN_READY at 90d292d; reframe the 784bc8d pin as an authority snapshot"
```

### Commit 6 — task contract + runbook hôm nay

```bash
cd ~/Projects/Plexco\ app && \
  git add docs/autopilot/contracts/autopilot-deps-security-bump.md docs/archive/runbook-unblock-2026-07-29.md && \
  git commit -m "docs(autopilot): Level 3 task contract for deps-security-bump and the 0729 unblock runbook"
```

### Commit 7 — reconcile hàng đợi + Verdict 27

```bash
cd ~/Projects/Plexco\ app && \
  git add docs/autopilot-backlog.md docs/slice-readiness-verdicts.md && \
  git commit -m "docs(autopilot): Verdict 27 records 0025 merged; reconcile the queue to zero stale entries"
```

Sau commit 7, working tree phải còn đúng hai thứ chưa quyết: `design.pen` (§2 commit 4) và
`docs/archive/email-hoi-provider-2026-07-23.md`. Kiểm:

```bash
cd ~/Projects/Plexco\ app && git status --short
```

Với file email: hoặc commit kèm **một inbound reference** từ chỗ đang theo dõi các provider gate
(`docs/autopilot-backlog.md` block `email-provider-c7-evidence` là chỗ tự nhiên), hoặc để ngoài. Đừng
commit nó không tham chiếu — một doc không ai trỏ tới là doc không ai đọc lại.

---

## §3. Verify trước khi push

Cả bốn phải xanh. Bất kỳ cái nào đỏ là **hard stop**, không push.

```bash
cd ~/Projects/Plexco\ app && \
  node scripts/check-review-readiness.mjs && \
  scripts/autopilot-backlog-reconcile --check && \
  pnpm format:check && \
  pnpm lint
```

Kỳ vọng: `review-readiness: PASS (… 26 active verdict block(s) …)` · `No stale entries` ·
`All matched files use Prettier code style!` · lint sạch.

> **⚠️ `pnpm lint` ĐỎ ở lần chạy đầu (2026-07-29) — và nó có sẵn, không do 8 commit docs.**
> 11 × `'process' is not defined` trong `scripts/autopilot-review-readiness.mjs`.
>
> **Chẩn đoán, không phải phỏng đoán:** `eslint.config.mjs` ignore `"*.mjs"` nhưng pattern đó **chỉ
> khớp root** — đúng cái bẫy mà comment trên entry `.probe/**` trong chính file đó đã ghi lại một lần
> rồi. Nên `scripts/*.mjs` VẪN bị lint, và file kit dùng `process` trần thì đỏ. File anh em
> `scripts/check-review-readiness.mjs` pass chỉ vì nó tình cờ `import process from "node:process"`.
> Lỗi land cùng kit v11 (`ed38106`, đã trên origin) ⇒ **CI job `lint` đỏ trên main từ lúc đó**;
> `git diff --name-only 3d75c90..HEAD -- scripts/` trống nên 8 commit docs không liên quan.
>
> **Sửa ở `eslint.config.mjs`, KHÔNG sửa file script.** `autopilot-review-readiness.mjs` là kit pack
> file giữ byte-identical với `Claude template` và được `autopilot-update.sh` refresh — thêm import
> vào đó sẽ **bị ghi đè im lặng** ở lần sync kit tới, đúng lớp lỗi với drift `autopilot-backlog-reconcile`
> ghi ở §5. `eslint.config.mjs` là file repo tự sở hữu nên fix sống sót, và nó vá cả lớp
> `scripts/**/*.{mjs,js}` thay vì một file.
>
> **Bài học quy trình:** ba gate hẹp (`review-readiness`, `backlog-reconcile`, `prettier`) xanh
> **không** có nghĩa CI xanh. CI chạy `pnpm -w lint` toàn repo (`ci.yml:59`). Chạy đúng lệnh CI chạy,
> đừng chạy phiên bản hẹp của nó rồi suy ra.

Sau đó chạy nốt phần nặng (cần `DATABASE_URL_TEST`):

```bash
cd ~/Projects/Plexco\ app && \
  pnpm typecheck && pnpm build && pnpm test
```

Baseline test count là **561** (core 132 · db 243 · web 146 · bot 40). Lệch số ⇒ điều tra, không nghiệm thu.

```bash
cd ~/Projects/Plexco\ app && \
  git log --oneline -10 && git push origin main
```

---

## §4. Thả khoá

```bash
cd ~/Projects/Plexco\ app && \
  scripts/autopilot-root-lock release --owner docs-unblock-0729 && \
  scripts/autopilot-root-lock status
```

---

## §5. Sửa cơ chế — để lỗi status-stale không quay lại lần thứ ba ✅ ĐÃ LÀM 2026-07-29

> **Đã gắn vào `scripts/ap-merge.sh` bước 8b.** Chi tiết thiết kế:
>
> - **Chạy SAU `git push`, không thể trước.** `autopilot-backlog-reconcile` giải `merged_probe` bằng
>   `git show origin/<default>`. Đặt trước push thì probe chưa có trên origin, nó báo *"genuinely
>   pending"* và không flip gì — một bước trông như đã chống lỗi nhưng thật ra là no-op.
> - **Commit riêng, không blind-chain.** In diff, rồi commit với message cố định. Chính script này ra
>   đời từ sự cố "chuỗi nhiều bước có tác dụng phụ chạy nửa vời" (`eba1c27`), nên nó không được tái
>   phạm cái nó chữa.
> - **Phân biệt hai loại thất bại.** Nếu commit hỏng (thường thiếu root-lock / `PLEXCO_COMMIT_OWNER`),
>   nó in đậm rằng **merge + push ĐÃ thành công** và phần thiếu chỉ là bookkeeping, kèm đúng bốn lệnh
>   để đóng. Không có câu đó thì người đọc `exit 1` sẽ tưởng merge hỏng và chạy lại `ap-merge` → commit
>   trùng trên `main`.
> - **Nhánh không `--push`** cũng in nhắc, vì đó là lối duy nhất còn lại mà reconcile không tự chạy.
>
> Phần dưới giữ nguyên phần chẩn đoán gốc, gồm hai lỗ mà bước 8b **không** bịt được.

`scripts/ap-merge.sh` **không** gọi `autopilot-backlog-reconcile`. Đó là lý do backlog rot sau merge:
25/07 bảy slice, 29/07 một slice, cùng một nguyên nhân. Thêm dòng nhắc vào docs sẽ không sửa được —
cái sửa được là gắn vào bước merge.

```bash
cd ~/Projects/Plexco\ app && \
  grep -n "reconcile" scripts/ap-merge.sh || echo "→ chưa gọi, đúng như chẩn đoán"
```

Thêm vào cuối `ap-merge.sh` (sau khi merge thành công, trước khi push):
`scripts/autopilot-backlog-reconcile --fix` rồi `git add docs/autopilot-backlog.md` nếu có thay đổi.

**Một biến thể `--check` không bắt được, phải xử lý bằng quy ước chứ không bằng script:** slice loại
`owner-evidence-gate` (vd `enable-google-login-safari-measurement`) đóng bằng **bằng chứng**, không
bằng commit — không có `merged_probe` nào hit được, nên nó chỉ hiện ra dạng `? no merged_probe` và nằm
im ở `ready`. Với loại đó, `ready` phải đọc là *"còn phép đo phải chạy"*, không phải *"sẵn sàng launch"*.

Một lỗ thứ hai cùng họ: `deps-security-bump` mở follow-up từ design-probe của slice khác, và follow-up
đó **chỉ sống trong transcript một ngày** vì `autopilot-backlog.md` nằm ngoài manifest scope của
worktree. Slice từ chối ghi ngoài scope là đúng kỷ luật — nhưng nghĩa là kit cần một đường phát
follow-up hợp lệ mà không nới scope của chính slice. Chưa có; ghi lại ở đây để không quên.

---

## §6. Prompt cho các phiên tiếp theo

> **Cập nhật 2026-07-29 cuối ngày — §6 cũ đã stale và được viết lại toàn bộ.** Bản v0.1 soạn khi hàng
> đợi có 0 `ready` và một quyết định owner chưa chốt; nay **cả ba slice đều `ready`**, quyết định đã
> chốt, và hai mục cũ (`promote db-undeclared…`, `đóng docs-session-capacity-chk…`) **đã làm xong**.
> Giữ prompt cũ sẽ dụ phiên sau đi hỏi lại thứ đã trả lời.

### 6.1 `deps-security-bump` — từ 2026-07-30

> Authority: `docs/autopilot-manifests/deps-security-bump.json` (đọc `_owner_decision` TRƯỚC TIÊN) +
> `docs/autopilot/contracts/autopilot-deps-security-bump.md` (task contract Level 3 §3 — lưu ý §"Quyết định owner (chẩn
> đoán gốc)" là bản CŨ, đã bị chính phép đo bác; phần đúng nằm ở khối ✅ phía trên nó).
>
> **Scope đã thu hẹp: chỉ `next` + `postcss`.** `brace-expansion` **ra khỏi slice** — nó đóng qua
> `eslint-10-migration`. `DSB-2b` bắt hai dòng `brace-expansion` trong `pnpm-lock.yaml` phải
> **byte-unchanged**; lệch một ký tự nghĩa là bạn đã trôi vào package bị loại ⇒ HALT, đừng nghiệm thu.
>
> **Đừng thử ép `brace-expansion@1` lên v5.** Nó không chỉ là major bump — v1 export một hàm
> (`module.exports = expandTop`), v5 CJS export một object (`exports.expand`), mà consumer duy nhất
> `minimatch@3.1.5` gọi nó như hàm. `pnpm install` resolve sạch, lint chết lúc gọi. Đã đo 29/07.
>
> **Còn đúng một thứ CHƯA ai đo — item (c):** `next` có cần override không, hay `apps/web` đã khai
> range chứa `15.5.21` nên chỉ cần refresh lock. Đo thật, đừng chép phỏng đoán của manifest.
>
> **Bẫy đã đo, đừng đo lại nhưng phải kiểm chứng:** override `postcss` nằm ở **HAI** chỗ —
> `package.json` `pnpm.overrides` (`^8.5.10`) và `pnpm-workspace.yaml` `overrides`
> (`postcss@<8.5.10: 8.5.16`). Nâng một chỗ bỏ chỗ kia thì transitive `postcss` vẫn hạ cánh xuống
> `8.5.16` — đúng bản đang bị advisory — trong khi `package.json` trông đã vá. `DSB-4` tồn tại vì thế.
>
> Publish date: `npm view <pkg> time --json`, đọc **đúng key version**, KHÔNG `time.created`
> (nó trả 2011 cho `next`). Mở worktree từ tip `origin/main` thật, register scope-gate
> (`build-config`), viết `.autopilot/state/deps-security-bump/design-probe.md` rồi **STOP** chờ
> founder confirm trước khi sửa file nào. Kết ở `READY | AWAIT | HALT`. P1 ⇒ 2 vòng codex clean +
> 1 vòng security. Owner merge.

### 6.2 `eslint-10-migration` — từ 2026-07-31, TRƯỚC 2026-08-06

> Authority: `docs/autopilot-manifests/eslint-10-migration.json`. Đọc `_design_probe_findings` —
> ba câu hỏi compat **đã đo và đã đóng**, không cần hỏi lại, nhưng `_evidence_rules` vẫn bắt đo lại.
>
> **Deadline cứng từ bên ngoài: ESLint v9.x EOL 2026-08-06.** Đây là lý do chính của slice; việc nó
> đồng thời gỡ `brace-expansion@1` chỉ là hệ quả miễn phí. Không được hoãn qua ngày đó.
> `minimumReleaseAge` 7 ngày ⇒ v10.8.0 (publish 24/07) đủ tuổi từ **31/07**. Chọn bản **eligible mới
> nhất**, không phải bản mới nhất.
>
> **Rủi ro số một, và nó trông như thành công:** v10 đổi thuật toán tìm config sang bắt từ thư mục của
> từng file thay vì cwd. Repo là pnpm workspace (`apps/*`, `packages/*`), nên tập file được lint có thể
> **hẹp đi âm thầm** — `pnpm lint` vẫn xanh trong khi kiểm ít hơn, một cổng xanh đã thôi gác. `E10-2`
> vì thế so **hash danh sách file** chứ không so exit code. Baseline 29/07: **81 file**
> (apps 46 · packages 31 · scripts 3 · `eslint.config.mjs` 1), sha256 prefix `3c99372c73e87ab4`.
> Re-derive con số này ở probe; nếu nó đã đổi thì nói rõ và dùng số mới.
>
> **Điều khoản dễ vi phạm do thiện chí:** v10 cập nhật `eslint:recommended`. Nếu bộ rule mới sinh lỗi,
> **báo cáo và HALT** — không sửa code, không tắt rule. Sửa lint là slice khác; làm ở đây thì diff lẫn
> "upgrade" với "sửa lỗi mới lộ" và không ai tách lại được.
>
> **Không nâng `typescript-eslint`** — `8.62.1` đã khai `peer eslint: ... || ^10.0.0`. Nâng nó là lén
> đưa một thay đổi chưa đo vào slice. **Giữ nguyên block `scripts/**/*.{mjs,js}`** trong
> `eslint.config.mjs`: nó vá `no-undef` cho kit script, không liên quan v10.
>
> **Một lỗ thật phải đóng:** `package.json` khai `engines: {node: ">=22"}` — dải đó nhận 22.0–22.12 mà
> eslint 10 từ chối (`^20.19.0 || ^22.13.0 || >=24`). `E10-5`.

### 6.3 `db-undeclared-check-constraints-schema-mirror` — P2, chạy lúc nào cũng được

> Authority: `docs/autopilot-manifests/db-undeclared-check-constraints-schema-mirror.json`.
> Owner đã chốt: khai theo `_chk` + **một migration `RENAME CONSTRAINT`**, không phải lối
> "không migration" mà backlog ban đầu đề xuất — lý do ở `_owner_decision`.
>
> **Đây là chiều NGƯỢC LẠI của `0025`, đừng lẫn.** `0025` đổi tên constraint sống cho khớp tên
> `schema.ts` khai. Slice này thêm khai báo cho constraint sống chưa được mô tả. Đo cũng đã bác chiều
> thứ ba: **0** constraint được khai mà không tồn tại.
>
> **Bẫy nguy nhất khi viết test (`UCC-4`):** 4/6 dùng chung enum 6 giá trị
> `connecting|registered|active|drift|error|revoked`, nhưng **hai cái còn lại khác hẳn** —
> `channel_identities_status` là `(active|inactive)`, `oauth_transactions_provider` chỉ `'sepay'`.
> Một test coi cả 6 như nhau sẽ **xanh trong khi sai về hai cái**.
>
> **`oauth_transactions` KHÁC `auth_oauth_transactions`** — bảng Sepay-only cũ vs bảng login
> Google/Facebook (vốn đã khai đủ và đúng tên). Đọc cả hai định nghĩa, đừng khớp theo tên.
>
> Chép predicate từ `pg_get_constraintdef`, không từ trí nhớ. `UCC-9` bắt migration có **zero**
> `DROP CONSTRAINT`/`ADD CONSTRAINT` — chỉ `RENAME`. Đừng tin ba con số trong `_problem`: chúng đo
> 28/07 trước khi `0025` merge, và repo này đã sinh ba phép đếm constraint sai liên tiếp (27 → 47 → 40
> mới đúng), mỗi cái đọc như dữ kiện vì nó cụ thể.

### 6.4 Việc owner tự chạy, không cần session

> - **Ba repo khác lên kit v12** — `Trum-Bia-Hoi`, `bestminton-club-chatbot`,
>   `Bestminton-Club-Payment-check-bot`. Trong mỗi repo:
>   `bash "$HOME/Projects/Claude template/autopilot/parallel/autopilot-update.sh"`.
>   Chúng đang ở v11 và mang đúng lỗi lint `process` mà Plexco vừa vấp.
> - **Dọn:** 2 stash cũ (`templates model terra->sol`, `park pre-ap25-merge`), orphan container
>   `plexco-queue-provision-1` (`docker compose -f infra/docker-compose.yml up -d --remove-orphans`).
> - **`design.pen`** — quyết khi thực sự bắt đầu FE; xem ghi chú trong `docs/channels/web/README.md`.

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 29/07/2026 | v1.0 | **Đóng runbook: §6 viết lại toàn bộ, hàng đợi 0 → 3 `ready`.** §6 bản v0.1 soạn khi còn 0 `ready` và một quyết định owner chưa chốt — giữ nguyên sẽ dụ phiên sau đi hỏi lại thứ đã trả lời, và hai mục cũ (`promote db-undeclared…`, `đóng docs-session-capacity-chk…`) **đã làm xong ngay trong phiên**. Bản mới có 4 mục khớp thực tế: `deps-security-bump` (30/07, scope thu về `next`+`postcss`) · `eslint-10-migration` (31/07, trước EOL 06/08) · `db-undeclared-check-constraints-schema-mirror` (P2, `_chk` + migration RENAME) · việc owner tự chạy. Mỗi prompt mang theo **bẫy đã đo** thay vì mô tả chung: `DSB-2b` byte-unchanged, `E10-2` so hash danh sách file (81, `3c99372c73e87ab4`), `UCC-4` hai predicate lệch khỏi enum chung. |
| 29/07/2026 | v0.9 | **§5 thực thi: `ap-merge.sh` bước 8b.** `autopilot-backlog-reconcile --fix` nay chạy tự động sau `git push` trong `ap-merge.sh`, commit riêng, và khi commit hỏng thì phân biệt rõ *merge+push đã xong, chỉ thiếu bookkeeping* với *merge hỏng* — không có câu đó thì `exit 1` sẽ dụ người ta chạy lại `ap-merge` và tạo commit trùng trên `main`. Điểm thiết kế bắt buộc: **sau** push chứ không trước, vì probe giải theo `origin/main`. Kèm kit v12 (`autopilot-backlog-reconcile` nay nằm trong sync pack nên mọi repo consumer đều có `--fix`) và de-pin `KIT_VERSION` khỏi prose ở 4 doc. |
| 29/07/2026 | v0.8 | **Commit 0–7 land; §3 verify phát hiện `pnpm lint` ĐỎ — có sẵn trên main, không do docs.** 11 × `no-undef` trên `process` trong `scripts/autopilot-review-readiness.mjs`; nguyên nhân là `ignores: ["*.mjs"]` **chỉ khớp root**, đúng bẫy mà comment `.probe/**` trong cùng file đã ghi. Land cùng kit v11 `ed38106` ⇒ CI job `lint` đỏ trên main từ lúc đó. Sửa ở `eslint.config.mjs` (repo-owned, sống sót `autopilot-update.sh`) chứ không sửa file kit (byte-identical template, sẽ bị ghi đè im lặng) → commit 8. `eslint .` exit 0. Bài học: ba gate hẹp xanh ≠ CI xanh. |
| 29/07/2026 | v0.7 | **Commit 0 LAND `66c8d02`** (3 file, 3+/3−, hook pass). Sửa một khẳng định sai của v0.6: dùng **owner của `.git/index.lock`** làm dấu hiệu phân biệt lock-của-sandbox là vô dụng — mount map UID hai chiều, cùng file đó sandbox thấy `compassionate-friendly-brown` còn terminal máy thấy `maingocanh staff`, nên từ phía owner nó LUÔN là chính họ. Thay bằng hai dấu hiệu dùng được thật (**size 0** + **mtime cũ**) cộng `ps aux \| grep "[g]it " \| grep -v fsmonitor` trống. |
| 29/07/2026 | v0.6 | **Thêm cảnh báo `.git/index.lock` vào §0** sau khi commit 0 chết ngay lần chạy đầu với `fatal: Unable to create index.lock: File exists`. Lock do **chính session Cowork** để lại: `git status` từ sandbox lấy index.lock rồi không unlink được (mount cấm sandbox xoá) → lock **0 byte, owner = user sandbox**, treo 41 phút, chặn mọi git write. Không phải commit dở. Ghi ba dấu hiệu phân biệt lock chết với commit đang chạy, và ngưỡng an toàn để `rm -f`. |
| 29/07/2026 | v0.5 | **Soát tay toàn bộ lệnh `git` trong runbook sau lỗi v0.4** — tìm thêm hai bẫy. (1) Commit 5 dùng `git add -A -- docs/`, mà `-A` **cuốn cả untracked**: `docs/archive/email-hoi-provider-2026-07-23.md` (orphan, zero inbound reference, đề 23/07) sẽ lặng lẽ đi nhờ dưới subject Chat-plan không liên quan — đúng hình dạng sự cố `eba1c27`. Thêm nó vào `git reset` + một bước kiểm `git status --short` sau commit 7. (2) `git log --oneline -8` không đủ để thấy hết 8 commit mới → `-10`. |
| 29/07/2026 | v0.4 | **`git status --short --staged` không phải option hợp lệ** — git trả `error: unknown option 'staged'`. Có ở **5 chỗ** (commit 1, 2+3, 4, 5, và commit 0 vừa thêm); đổi hết sang `git diff --cached --stat`. Cùng họ với hai lỗi trước: lệnh viết ra mà không chạy thử. Đáng chú ý là cách nó ẩn — khi test lại thấy `exit=0` vì `head` mới là lệnh cuối trong pipe, đúng cơ chế đã làm `\| wc -l` in `0` ở v0.2. Sửa kèm: §2 "Bảy commit"→"Tám commit (0–7)", commit 0 "4 file"→**3 file** (`HANDOFF.md` đi commit 5). |
| 29/07/2026 | v0.3 | **§1 đã thực thi** — cả ba lỗi sửa xong trong working tree, thêm khối verify. 1.1 checklist `AUTHORITY_SHA` `2dc9b8c`→`784bc8d` khớp `dd-32-booking-funnel-analysis.md`. 1.2 dùng lối (b): `BUILD-STATUS.md:7` *"Current HEAD"*→*"Authority snapshot"* + dòng delta snapshot→live; `HANDOFF.md:6` sửa số vì nó khai *"PASS trên current HEAD"* (537→561, DB 219→243, tổng 550→574, file giữ 32). **Đo được rằng 17 file khác khai `0000–0024` KHÔNG cần sửa** — chúng đã de-pin từ slice `docs-migration-tail-0018-to-0020-sweep`; chỉ 2 chỗ khai currency thật. 1.3 bốn chỗ `KIT_VERSION 10`→`11`. Thêm **commit 0** cho 3 file kit-pin (trước đó sạch, tách được sạch); `HANDOFF.md` chuyển sang commit 5 vì mang cả fix §1.2. Working tree 88→98 entry. |
| 29/07/2026 | v0.2 | **Sửa hai lỗi của v0.1 do owner phát hiện khi chạy thật.** (1) Lệnh `grep -r --include=*.md` viết theo lối bash; **zsh** cố glob `*.md` trong cwd, không khớp, abort cả lệnh với `zsh: no matches found` — và vì có `\| wc -l` phía sau nên nó vẫn in `0`, **trông hệt như "không tìm thấy gì"**. Đã quote `'*.md'` ở cả 4 chỗ và thêm cảnh báo shell ở §0. (2) §0 thiếu `export PLEXCO_COMMIT_OWNER` — `.githooks/pre-commit:46` HALT `ROOT_COMMIT_NO_OWNER` nếu giữ lock mà biến chưa set, nên runbook như cũ sẽ chết ngay ở commit 1. Đo lại số thật: `784bc8d` xuất hiện ở **32** file (v0.1 ghi "~30"); `KIT_VERSION 10` grep ra **7** hit nhưng chỉ **4** là stale thật, 3 hit còn lại là chính runbook trích lại. |
| 29/07/2026 | v0.1 | Soạn tại `main@3d75c90`. 7 commit + 3 lỗi phải sửa trước (AUTHORITY_SHA mâu thuẫn DD-32, `784bc8d` gọi nhầm là current HEAD, `KIT_VERSION 10` stale), verify gate, sửa cơ chế `ap-merge.sh`, prompt cho 3 phiên tiếp theo. Ghi rõ ràng buộc không tách sạch theo file được: 29 file đa-lớp, và `v2.5`/`v2.6` trong `slice-readiness-verdicts.md` nằm kề nhau cùng hunk. |
