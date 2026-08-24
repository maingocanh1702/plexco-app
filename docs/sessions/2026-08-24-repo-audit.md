# Repo Audit — Plexco · 2026-08-24

> **Loại doc:** derived / audit snapshot — KHÔNG phải authority. Khi lệch với `packages/db/schema.ts`,
> `docs/standards/decisions.md` hay HANDOFF thì các file gốc thắng.
> **Đo tại:** working tree 2026-08-24 ~19:20 ICT · `main@205769a` (local, **ahead 1** so với `origin/main`)
> · working tree có 8 file docs modified chưa commit + 4 file untracked.
> **Phương pháp:** đọc HANDOFF v1.37 · ROADMAP v3.7 · decisions.md v2.37 · BUILD-STATUS · CLAUDE.md/AGENTS.md,
> rồi **verify độc lập trên code thật** (grep/đếm trực tiếp trên `apps/` + `packages/`, git state, `.autopilot/`).
> Không chạy canonical runner (cần Postgres + máy owner) — trục Tests giữ số authority đã pin.

---

## 1. Kết luận nhanh (TL;DR)

Repo đang ở trạng thái **kỷ luật tài liệu rất cao, code nền rất chắc, nhưng sản phẩm dùng được = 0** và
toàn bộ launch scope (DD-113) đang bị chặn bởi **một quyết định duy nhất chưa được gỡ: lệnh FE PENDING 13/08**.
Tiến độ tự khai ~33% (theo thước slice-roadmap) là **trung thực** — audit này tái đo và không tìm thấy
lạm phát số liệu; ngược lại, hệ đo lường của repo tự bắt lỗi chính nó nhiều lần.

Ba việc đáng làm ngay, xếp theo (rủi ro ÷ chi phí):

1. **Commit + push khối docs 22–24/08** (697 dòng thay đổi gồm DD-113/114/115 — các quyết định GTM và
   phase-1 quan trọng nhất của project đang sống ngoài git history đã 2 ngày).
2. **Owner ra quyết định về FE PENDING và ghi vào `decisions.md`** — dù gỡ hay giữ. Hiện lệnh này vừa chặn
   toàn bộ launch scope, vừa nằm ngoài decision log (vi phạm chính luật DD-111 D4 của repo).
3. **Khởi động gate A3 legal (PII data-class matrix, cần luật sư VN)** — DD-114 đã nâng nó thành blocker
   phase-1, lead-time dài, không phụ thuộc code.

---

## 2. Trạng thái đo được (verify độc lập 24/08)

### 2.1 Git state — ⚠️ có rủi ro

| Hạng mục | Đo được | Ghi chú |
|---|---|---|
| Branch | `main@205769a`, **ahead 1** vs `origin/main` | Commit `205769a` (pin template feature-doc + unrot AGENTS.md, 24/08) **chưa push** |
| Modified chưa commit | **8 file docs, +697/−57 dòng** | HANDOFF v1.37 · ROADMAP v3.7 · decisions.md **v2.37** · BRD v3.9p · PRD v2.8o · gtm-strategy (rewrite) · native-app-strategy 2.1 · features/README — tức toàn bộ mirror chain DD-113/114 (22/08) **và** DD-115 (24/08) |
| Untracked | `design.pen` · `fe.pen` (cố ý — FE PENDING) · `docs/features/FE/feature_membership.md` + `BE/feature_membership_tech.md` (cặp spec DD-115, mới 24/08) | |
| Stash | 2 entry (`templates model terra->sol`, `park pre-ap25-merge`) | Đỗ lâu, nên xử lý hoặc drop có chủ ý |
| Worktrees | 2 worktree forensics `session-draft-lifecycle-commands`(--v2) hiển thị `prunable` | **Artifact của mount Cowork** — HANDOFF v1.35 đã ghi: đo `prunable` từ phiên Cowork là vô giá trị. **Không prune.** Forensics đã có bản archive prune-proof |
| `.autopilot/INFLIGHT.md` | **Rỗng** — 0 lane đang bay | Reservation mồ côi `--price-only` đã đóng 21/08 đúng quy trình |

### 2.2 Code reality — khớp với số tự khai của docs

Audit tái đo trực tiếp và **xác nhận** các con số HANDOFF/ROADMAP tự khai (không tìm thấy chênh):

| Trục | Đo 24/08 | Khớp docs? |
|---|---|---|
| Migrations | 33 file, `0000`–`0032` | ✅ |
| Test files | 38 (workspace) | ✅ |
| API routes | 10 + `healthz` (8 auth — **còn 2 route Telegram-era** + 2 onboarding); **0 route nghiệp vụ** | ✅ |
| FE | **1 `page.tsx`, 0 màn nghiệp vụ**; `apps/web` **chưa có manifest/service worker** (chưa được gọi là PWA theo DD-113 D2) | ✅ |
| BE nghiệp vụ | `session-service.ts` (933 dòng): đúng 3 command `createSession` · `publishSession` · `announceSession`; là **thư viện** — chưa surface nào gọi từ ngoài | ✅ |
| `authorizeTenantAction` | Có production caller (publish + announce đường suspension re-check dưới lock) — hết code-dark | ✅ |
| DD-29 entitlements | **0 dòng TS đọc `entitlements`/`capabilities`** ngoài schema/test — code dark từ 07/08, nay là **hard dependency phase-1** | ✅ (vẫn dark) |
| `public_projection_fences` | **0 hit** trong code/migrations — nợ 8a của DD-12 chưa land | ✅ (chưa có) |
| Chat | DB root `0030`–`0032` có thật, **0 service/API/UI**, 0 TS production đọc `chat_*` | ✅ |
| Outbox | Dispatcher/queue/preflight merged, `OUTBOX_DISPATCH_SCHEDULE_ENABLED` mặc định OFF, delivery vẫn stub fail-closed | ✅ |
| Tests (runner) | Authority vẫn **854 workspace + 30 validator @ `93f1e93` (15/08)** — chưa chạy lại; static 835 @ `a151b15`. Code không đổi từ `a151b15` ⇒ hợp lệ mang sang, nhưng đã 9 ngày | ⚠️ nên re-run |

### 2.3 Chất lượng code — điểm mạnh thực sự

Spot-check `apps/web/lib`, `packages/db/src`, `packages/core/src` cho thấy kỷ luật cao đồng đều:
route auth có rate-limit theo IP + error envelope `err()/ok()` chuẩn DD-60; i18n `t(vi,en)` đúng HARD RULE 5;
**0 TODO/FIXME/HACK** trong toàn bộ TS; tỉ lệ test/code rất cao (vd `migrate.test.ts` 3.613 dòng,
`rls-invariants.test.ts` 4.092 dòng, 5 file invariant class); các pattern fail-closed nhất quán
(suspension re-check dưới row lock, DB clock cho time-guard, SECURITY DEFINER read-only). CI đã có
concurrency/timeout hygiene sau sự cố cạn phút Actions 08/2026.

---

## 3. Vấn đề tìm thấy

### 🔴 P0 — chặn tiến độ hoặc rủi ro mất dữ liệu quyết định

**V1. Khối quyết định 22–24/08 chưa commit, HEAD chưa push.**
DD-113 (GTM re-sequencing), DD-114 (phase-1 = 7 nhóm), DD-115 (Membership proposal) + toàn bộ mirror
chain (7 file) đang chỉ tồn tại trong working tree của một máy. Đây là các quyết định định hình toàn bộ
kế hoạch launch. Repo có nguyên tắc "bản ghi bền thắng lời khai hội thoại" (DD-111 D4) — nhưng bản ghi
chưa vào git thì chưa bền. *Đề xuất: commit theo 2 commit tách bạch (docs: DD-113/114 mirror · docs: DD-115
membership proposal + spec pair) rồi push cả `205769a`.*

**V2. FE PENDING — nghịch lý governance đang chặn launch.**
DD-113 chốt launch = PWA + Zalo bot song song với 5 khối FE, nhưng cố ý không gỡ lệnh FE PENDING 13/08
⇒ **launch scope hiện không khởi động được**, và không lane FE nào được phép mở. Đồng thời chính lệnh
PENDING **chưa từng được ghi thành một mục trong `decisions.md`** — nguồn duy nhất là
`next-lanes-2026-08-13-RUN.md` rồi mirror đi (DD-113 D5 đã flag đúng điều này nhưng chỉ flag, không sửa).
Trạng thái chặn quan trọng nhất của project đang sống ngoài decision log. *Đề xuất: một DD mới (DD-116?)
do owner ký, hoặc (a) gỡ PENDING + authorize lane FE đầu tiên của 5 khối, hoặc (b) giữ PENDING kèm điều
kiện gỡ nhị phân. Cả hai đều tốt hơn hiện trạng.*

**V3. A3 legal (PII data-class matrix) — blocker phase-1 chưa khởi động.**
DD-114 D5 nâng từ lead-time item thành blocker (phase-1 có settings/privacy + bank memo trên đường tiền).
Cần luật sư VN ⇒ thời gian chờ dài, chi phí khởi động thấp, không phụ thuộc code. Mỗi tuần chưa bắt đầu
là một tuần cộng thẳng vào critical path.

**V4. Hai hard dependency phase-1 chưa có slice nào trên đường ray.**
(a) **DD-29 entitlement reader đầu tiên** — registry dark từ 07/08; DD-114 yêu cầu billing P5 +
`payment_reconcile_auto` là capability đầu tiên được enforce thật. (b) **`public_projection_fences` (8a,
nợ DD-12)** — kèo chuyển private/cancel hiện vẫn lộ trên `public_sessions` tới khi projector async chạy;
toggle public/private của nhóm 5 chỉ được mở sau fence. Cả hai chưa có packet/lane active
(INFLIGHT rỗng). *Đề xuất: đưa vào next-lanes làm 2 BE lane kế tiếp — không đụng FE PENDING nên chạy được ngay.*

### 🟡 P1 — nợ nhất quán / vệ sinh governance

**V5. `decisions.md` bảng tổng hợp thiếu hàng DD-110/111/112** (thân bài có đủ; caveat đã ghi trong file
nhưng chưa sửa). Version ledger từng under-report (v2.34→v2.35 gánh 2 DD). Cách đọc an toàn hiện là
`grep -nE '^## DD-1[0-9][0-9]'` — nên backfill 3 hàng cho bảng hết lệch.

**V6. `BUILD-STATUS.md` live-truth dừng ở 14/08 (`93f1e93`)** — thiếu AnnounceSession (15/08), đóng
reservation mồ côi (21/08), DD-113/114/115. HANDOFF và ROADMAP được mirror đều còn BUILD-STATUS bị bỏ
lại ⇒ mirror chain không đối xứng. Ai đọc mỗi BUILD-STATUS sẽ thiếu 10 ngày sự kiện.

**V7. Floor UC lệch giữa template và gate vẫn chưa sửa gốc:** `feature-spec-template.md` ghi
"Minimum 8 use cases", review gate ở `features/README.md` v2.33 đòi ≥10. CLAUDE.md đã ghi workaround
("lấy ≥10") — nhưng lỗi nằm sẵn trong khuôn thì mỗi spec mới là một lần dẫm lại. Sửa 1 dòng template là xong.

**V8. 2 route auth Telegram-era vẫn sống** (`/api/auth/telegram/state|callback` + `telegram-login.ts`)
dù DD-37 loại Telegram từ 10/07. Có rate-limit, rủi ro thấp, và đã có kế hoạch gỡ (sau email order-4
bundle) — nhưng bundle đó chưa nhúc nhích từ nhiều tuần. Ghi nhận là nợ đang trôi, không phải phát hiện mới.

**V9. Canonical runner chưa chạy lại từ 15/08.** Số authority 854+30 vẫn hợp lệ (code không đổi từ
`a151b15`), nhưng chuỗi bằng chứng càng dài càng mỏng. Một lần `pnpm test` full trên máy owner sẽ re-pin
trục Tests và tiện thể xác nhận CI matrix xanh (OSV đã GREEN 11/08, các workflow khác chưa re-verify từng cái).

**V10. Ba open question Tier C đang treo trước các slice sắp tới:** DD-112 (đổi capacity khi đã có
charges — chưa có owner đứng sau), DD-114 OQ (public để làm gì khi phase-1 không có discovery — 3 phương
án chưa chọn), DD-115 với 10 MBS-OQ (đặc biệt OQ-1 ngày bắt đầu, OQ-7 vượt capacity chạm HARD RULE).
Không cần chốt ngay, nhưng slice nào chạm là AWAIT — nên chốt theo thứ tự slice sẽ chạm.

### 🟢 P2 — nhỏ

**V11.** `progress.json` / `plexco-dashboard.html` / bộ `linear-*.mjs` đứng ở 10/08 — mirror Linear phụ
thuộc CI cron 6h; sau khi push nên xác nhận linear-sync còn chạy đúng.
**V12.** `.DS_Store` xuất hiện ở root (macOS artifact) — kiểm `.gitignore` đã cover chưa.
**V13.** Trong quá trình audit, thư mục **`_to_delete/`** được tạo ở root repo (chứa 1 tarball tạm
`_audit_src.tgz` và 2 file `git-index.lock` mồ côi do sandbox Cowork không xoá được file). **Xoá cả thư
mục này được, không mất gì.** Lưu ý vận hành: chạy lệnh git ghi-index từ phiên Cowork sẽ để lại
`index.lock` mồ côi — nếu gặp lỗi `index.lock exists` trên máy thật, xoá file đó đi.

---

## 4. Tiến độ hiện tại — đọc theo thước của chính repo

```
TỔNG (slice roadmap đã merge)      ~33%   — không đổi từ 22/07, và lý do là thật:
  ├─ Nền móng core + db/RLS        ~90%   ✅ 33 migration, invariant 5 file, runner 854 PASS
  ├─ Auth (lane Google)            ~80%   🟢 merged + Safari/iOS đo PASS · ⛔ chưa go-live (owner decision)
  └─ Feature nghiệp vụ              ~5%   3 command thư viện · 0 route nghiệp vụ · 0 màn FE
Sản phẩm host dùng được:             0    — chưa surface nào chạy; North Star metric = 0
```

Diễn giải: 5 tuần liên tiếp (22/07→24/08) thanh % không tăng **không phải vì không có việc land** —
đã land job substrate, chat DB root, capability registry, 3 session command, AnnounceSession — mà vì
thước của repo (luật 5: trục yếu nhất thắng) chỉ cộng khi có **hành vi product** thật. Điểm gãy hiện tại
rõ ràng: mọi thứ dừng đúng ở ranh giới "thư viện đã có, surface chưa được phép build" — tức chính V2.

Phase-1 (DD-114, 7 nhóm) so với hiện trạng: nhóm 1 (auth Google) ~80%, nhóm 6 (session mgmt) có 3/N
command BE và 0 UI; nhóm 2·3·4·5·7 = 0 code (spec coverage cao). Launch subset (DD-113, 5 khối) = 0 khối
khởi động được do V2.

---

## 5. Next steps đề xuất (thứ tự ưu tiên)

| # | Việc | Vì sao trước | Ai quyết |
|---|---|---|---|
| 1 | **Commit + push** khối docs 22–24/08 (V1), kèm 2 spec membership untracked | 2 ngày quyết định GTM/phase-1 đang ngoài git; chi phí 10 phút | dev |
| 2 | **DD cho FE PENDING** — gỡ (kèm authorize lane FE đầu tiên) hoặc giữ (kèm điều kiện gỡ nhị phân), ghi vào `decisions.md` (V2) | Đang chặn 100% launch scope; đồng thời đóng lỗ governance DD-111 D4 | **owner** |
| 3 | **Khởi động A3 legal** — liên hệ luật sư VN, khoanh scope PII matrix (V3) | Lead-time dài nhất, chi phí khởi động thấp nhất | owner |
| 4 | **2 BE lane không đụng FE, chạy được ngay:** (a) DD-29 entitlement reader đầu tiên; (b) `public_projection_fences` + guarded view + CAS-clear + grant migration (8a) (V4) | Cả hai là hard dependency phase-1 owner-final; INFLIGHT đang rỗng | dev (packet theo Level 3) |
| 5 | Nếu #2 = gỡ: **lane FE #1 của 5 khối launch** — dựng shell PWA (manifest + SW + installable) + signin/signup nối 8 route auth có sẵn | Khối 1 là khối duy nhất BE đã ~80%; cũng là điều kiện dùng chữ "PWA" theo DD-113 D2 | dev |
| 6 | **Vòng vệ sinh đo lường:** chạy canonical runner re-pin Tests (V9) · backfill 3 hàng bảng DD (V5) · refresh BUILD-STATUS (V6) · sửa floor 8→10 trong template (V7) | Gom một phiên "reconcile" là xong cả bốn | dev |
| 7 | Chốt dần OQ theo thứ tự slice sẽ chạm: DD-114 OQ public → DD-112 → DD-115 MBS-OQ (V10) | Tránh AWAIT giữa lane | owner |
| 8 | Nợ trôi dài hạn: email order-4 bundle → gỡ Telegram routes (V8); quyết định go-live Google login | Đã có kế hoạch sẵn, chỉ cần xếp hàng | owner + dev |
| 9 | Dọn `_to_delete/` (V13), xử lý 2 stash, xác nhận linear-sync (V11) | Vệ sinh | dev |

---

## 6. Nhận xét chung

Điểm khác thường của repo này — theo cả hai chiều — là **hệ governance tự phản tỉnh**: measurement
contract 6 trục + 5 luật chống lạm phát, live-truth block có đính chính lỗi đo của chính nó, HALT
forensics được archive thay vì xoá. Audit độc lập này không bắt được docs khai sai một con số nào —
điều hiếm. Chi phí của hệ đó cũng nhìn thấy được: khối lượng docs lớn (decisions.md 600KB, ROADMAP 133KB),
mirror chain 5–7 file mỗi DD, và tốc độ feature chậm — 5 tuần thanh % đứng yên trong khi nền ngày càng dày.
Rủi ro lớn nhất hiện tại không phải kỹ thuật mà là **trình tự quyết định**: launch đã được định nghĩa
sắc nét (DD-113/114) nhưng cả bốn cửa vào nó (FE PENDING · A3 · entitlement reader · fence) đều đang
đóng, trong đó ba cửa mở được bằng một chữ ký owner hoặc một lane BE bình thường. Mở đúng thứ tự
#2→#4 ở bảng trên thì thanh ~33% sẽ nhúc nhích lần đầu sau 5 tuần.
