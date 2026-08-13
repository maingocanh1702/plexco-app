# Rà soát docs — feature specs · design playbook · templates

> **Ngày:** 2026-08-13 · **Base:** `main@1fdba1d3ddb662f4106193b9265a93c6abacaba2` (= `origin/main`)
> **Phạm vi:** 26 Product spec (`docs/features/FE/`) · 25 BE tech spec (`docs/features/BE/`) ·
> 17 FE design spec (`docs/channels/web/FE/`) · 11 doc design/playbook (`docs/channels/web/`) ·
> 19 template (`docs/templates/`)
> **Loại:** doc audit + fix pass. **KHÔNG phải review/readiness verdict** — không authorize slice, code,
> migration hay enablement nào. Không DD nào đổi trạng thái ngoài DD-106 mới (🟡 proposal).

---

## 0. TL;DR

Bộ docs không thiếu nội dung — nó thiếu **cửa**. Ba tuần vừa rồi authoring chạy nhanh hơn quyết định và
nhanh hơn template, nên xuất hiện bốn lớp lỗi có cùng một hình dạng: **thứ đúng nằm sai chỗ.**

| # | Phát hiện | Lớp | Đã xử lý |
|---|---|---|---|
| 1 | Ba hợp đồng chưa chốt nằm trong spec **đã Reviewed**, một trong đó là đường tiền | Quy trình | 🟡 DD-106 + nhãn tại chỗ |
| 2 | `fe-spec-template.md` thiếu cả 4 section DD-99 ⇒ lỗi **sinh sản** | Template | ✅ v0.5 |
| 3 | Reorg `2e577c7` sửa BE, bỏ sót FE ⇒ 155 ref hỏng ở 26/26 file | Cơ học | ✅ 156 sửa |
| 4 | Hai doc design mới nhất bảo người đọc khởi công, ngược lệnh owner 13/08 | Chỉ thị mục | ✅ banner |
| 5 | `marketplace_discovery.md` mất heading §3, bảng edge case bị dính chữ | Hỏng file | ✅ khôi phục |
| 6 | `features/README.md` sai count, thiếu 1 spec, sai boundary DD-104 | Index | ✅ v2.64 |

---

## 1. Ba hợp đồng chưa chốt trong spec Reviewed → DD-106 🟡

`CLAUDE.md`: *"Quyết định chưa chốt → ghi vào `decisions.md` dạng proposal (🟡/⬜), KHÔNG viết vào spec đã
Reviewed."* Spec pass 12/08 (`692f9f2`, +2.022 dòng / 11 file) đi ngược điều này ở ba chỗ.

**Q1 — Pay-for-Buddy (đường tiền).** `feature_payment_reconcile.md` v1.13 §5/§7 (**Reviewed**) + BE v1.15:
bảng `buddy_payment_requests`, `payment_allocations.source='buddy'`, 5 endpoint, 6 error code, 3 use case,
8 edge case, 11 AC. Đối chiếu repo: `0003_payments_ledger.sql:85` =
`CHECK (source IN ('auto','manual','cash','waiver','reversal'))` — không có `'buddy'`, không có bảng đó,
0 hit trong `schema.ts`. Và DD-26 từng chốt *"không thêm model mới 'buddy'"* (lớp identity).

Đây là chỗ nghiêm trọng nhất vì nó chạm **HARD RULE "claim-có-tiền cần khoá mạnh"**: A trả hộ B nghĩa là
một người tạo nghĩa vụ tài chính gắn với charge của người khác. Không tự chốt được.

**Q2 — `chat_messages.embed_type/embed_ref_id/embed_snapshot`** (`feature_inapp_chat_tech.md:302-311`).
`0031_chat_schema_core.sql` **đã land 11/08** và không có ba cột này ⇒ đây là **expand một bảng vừa land**
(migration `0033+`, đủ gate), không phải spec cho bảng chưa tồn tại. `embed_snapshot` là bản sao dữ liệu
session nằm trong bảng chat ⇒ mặt lộ mới cho whitelist.

**Q3 — unified `SessionCard`** — contract hiển thị cross-surface, chưa có nguồn canonical.

**Xử lý:** không revert. Thêm **DD-106 🟡** (ba câu độc lập, chốt riêng được — khuôn DD-90) + gắn nhãn 🟡
**tại chỗ trong spec** để không ai đọc nhầm là đã chốt. Nội dung authoring giữ nguyên; owner chốt cái nào
thì gỡ nhãn cái đó. `decisions.md` → **v2.29**.

> **Cơ chế sinh lỗi đáng giữ:** pass gộp hai lượt "tham chiếu Playo" vào một commit — 6/10 file nhảy **hai**
> version cùng lúc, hai dòng changelog cùng ngày, version trung gian chưa từng tồn tại trên đĩa. Khi một
> spec pass thêm **entity/cột/endpoint** chứ không chỉ sửa câu chữ, nó đã vượt khỏi "editorial".

---

## 2. `fe-spec-template.md` — lỗi sinh sản, đã có nạn nhân

DD-99 P1 (owner ratify **07/08**) đặt 4 section — Analytics · State Machine · Acceptance Criteria ·
Testing — làm **điều kiện** để FE spec đi Draft→Reviewed. Template v0.4 có **0/4**.

Hệ quả đo được: `8af9601` ngày **11/08** — bốn ngày sau khi gate được chốt — tạo 5 FE design spec mới
(`booking_funnel` · `club` · `club_assistant` · `session_organize` · `tournament`), **cả 5 đều 0/4**, tức
không đủ điều kiện lên Reviewed **từ ngày sinh**. Không doc nào ghi nhận điều đó.

DD-99 có nói "sửa gate/template là docs-only slice riêng, chưa schedule" — 5 spec kia là hoá đơn của việc
hoãn. Đã sửa template lên **v0.5**: thêm §8–§11 kèm câu giải thích tại sao không được xoá, sửa
`Source authority` path `../../` → `../../../` (v0.4 trỏ sai, 17 spec thật đều dùng `../../../`), và tách
bảng Responsive thành 2 lớp surface theo **DD-99 OQ-1 (a)** — 768px chỉ cho dashboard-shell, player-facing
pin 375 + desktop và cấm tự đặt số trung gian.

**Còn nợ (không làm trong pass này):** backfill 4 section cho 5 spec kia, hoặc ghi vào `decisions.md` rằng
chúng cố ý không promote được.

---

## 3. Reorg `2e577c7` chỉ sửa một nửa cây — 156 ref hỏng

Commit tự mô tả là "reorg + **reconcile links repo-wide**". Thực tế: BE spec được rewrite sang `../../`,
**26/26 FE spec thì không** — 155 ref hỏng (`../standards/` 66 · `../product/` 46 · `../decisions/` 24 ·
`../research/` 8 · `../proposals/` 5 · `../channels/` 3 · `../probes/` 2 · `../strategy/` 1).

Đáng chú ý: trong đó có con trỏ `../standards/BUILD-STATUS.md` ở **header của cả 26 file** — tức con trỏ
tới authority quyết định *"Doc status ≠ Implementation status"* không resolve được ở đúng mọi spec.

Đã sửa 155 + 1 ở `BE/auth-security-invariant-table.md` (`../FE/…_tech.md` → `./…_tech.md`; tech spec nằm
trong `BE/`, không phải `FE/`). Verify: 311/312 path resolve; **1 còn lại là file thật sự thiếu** —
`BE/feature_share_activities_tech.md`, xem §6.

```bash
# tái tạo kiểm tra — portable (KHÔNG dùng readlink -m: cờ đó GNU-only, macOS BSD không có)
for f in docs/features/FE/*.md docs/features/BE/*.md; do
  d=$(dirname "$f")
  for p in $(grep -ohE '\.{1,2}(/\.\.)*/[A-Za-z0-9._/-]+\.md' "$f" | sort -u); do
    [ -e "$d/$p" ] || echo "BROKEN $f -> $p"
  done
done
```

> 🔧 **Sửa 14/08 (lane docs-debt bắt được).** Bản đầu dùng `readlink -m`, là **cờ GNU-only** — máy owner
> (macOS, BSD readlink) không có `-m`. Đo lại giúp lane: hướng hỏng là **báo động giả, không phải sạch
> giả** — `readlink -m` lỗi ⇒ `$t` rỗng ⇒ `[ -e "" ]` false ⇒ in `BROKEN` cho **mọi** path. Phân biệt này
> quan trọng: false-clean sẽ khiến mọi kết quả "sạch" cũ đáng nghi; false-alarm thì không. Con số
> **311/312 resolve** của bản audit gốc đo trong sandbox Linux (nơi `readlink -m` chạy đúng) nên vẫn đứng.
> Bản portable ở trên đo lại tại `1fdba1d` + Lane D: **318 ref, 0 broken** — ref lệch cuối cùng
> (`BE/feature_share_activities_tech.md`) đã đóng vì file nay tồn tại.

---

## 4. Hai doc design mới nhất ngược lệnh owner 13/08

Lệnh owner 13/08 (`next-lanes-2026-08-13-RUN.md:7`): DD-81 / M0.3 / M4 và **mọi việc FE** treo lại —
không track `.pen`, không mở page/component.

`fe-spec-to-design-playbook.md` và `designer-docs-guide.md` là **hai file duy nhất** trong
`docs/channels/web/` không có một chữ nào về ranh giới gate — và cả hai ra đời cùng `8af9601`, tức chúng là
**mới nhất** trong bộ. Trong khi đó chúng bảo người đọc: *"Vẽ Screens — chiếm 70% effort"*,
*"Ghi canonical path trong .pen: exact page/frame/node ID"*. `designer-docs-guide.md` còn tự mô tả là gói
bàn giao cho designer, tức file dễ bị forward ra ngoài nhất.

Đây là loại lỗi tệ hơn số đếm mục: **một chỉ thị mục vẫn thi hành được.** Ai làm đúng theo nó là đang đi
ngược lệnh owner.

Đã thêm banner 🔴 ở đầu cả hai, nói rõ khác biệt **HOLD-chờ-gate** (làm xong gate là đi tiếp) vs
**PENDING-theo-lệnh** (gate không còn là thứ chặn). Kèm sửa 9/11 link hỏng của playbook — nó viết như thể
file nằm sâu hơn một cấp, nên cả bảng "Liên kết tài liệu" chết — và gỡ link `file:///Users/…/.gemini/…`
(đường dẫn máy cá nhân, ngoài repo) trong guide.

Cũng ghi tại chỗ hai chỗ playbook **không còn khớp contract**: breakpoint 375/768/1440 áp cho mọi screen
(ngược DD-99 OQ-1 (a) — spec thắng), và bảng thứ tự ưu tiên §0.4 tự khai "theo `designer-kickoff.md §3B`"
nhưng không khớp §3B và không phản ánh thứ tự P2→P4→P3 owner đã chốt.

---

## 5. `marketplace_discovery.md` — file bị hỏng, không chỉ thiếu heading

`692f9f2` xoá `## 3. Screens & States`. Không chỉ mất heading: dòng cuối bảng edge case bị **dính** vào
heading kế tiếp —

```
| 20 | Privacy | … | Chỉ trả `member_count` aggregate ### Web — Marketplace browse
```

— mất dấu `|` đóng bảng, và ~390 dòng nội dung màn hình mồ côi dưới §2. Đây là FE spec **Reviewed** duy
nhất gãy template 7-section của chính nó. Đã khôi phục heading + blockquote gốc + tách lại dòng bảng.
Kiểm: `grep '^## '` nay trả đủ §1–§7 theo thứ tự.

---

## 6. `features/README.md` — index sai ở 4 chỗ

Đã lên **v2.64**:

1. **Count** 25 → **26 Product + 25 BE**.
2. **`FE/feature_share_activities.md`** (v1.0, thêm 12/08) **chưa từng có dòng trong bảng nào** — đã thêm
   section riêng. Nó cũng **chưa có BE companion**: spec trỏ tới `BE/feature_share_activities_tech.md`,
   file không tồn tại, trong khi spec FE định nghĩa 2 bảng (`player_activity_shares` tenant-scoped/RLS,
   `person_activity_cards` global-protected) với chi tiết cột/constraint vốn thuộc BE spec — **không có
   chủ**. Đây là cặp lệch duy nhất, không phải product-only có chủ ý.
3. **Boundary DD-104 khai ngược:** README ghi "vẫn 🟡 đề xuất, 4 blocker mở"; thực tế owner đã chốt D0–D4
   decision-level 13/08 (`decisions.md` v2.27) và **cả 4 blocker resolved**, chỉ *slice* là DEFERRED.
4. **46/51 ô version stale.** **Không sửa tay** — chính file này quy định *"inventory/count được derive từ
   disk, không hand-maintain tại đây"*. Sửa 46 ô hôm nay chỉ để stale tiếp tuần sau là đi ngược chính sách
   của nó. Thay vào đó ghi rõ **đĩa là authority** + lệnh tái tạo.

---

## 7. Sạch — kiểm rồi, không phải bỏ qua

- **Validator:** `node scripts/check-review-readiness.mjs --all` → PASS, 40 doc, 46 verdict block, exit 0.
- **Luật ngôn ngữ:** mọi khối ```` ```text ```` trong `docs/templates/` + `docs/workflow/` không có ký tự
  tiếng Việt — đúng ranh giới agent-facing English.
- **Token:** active (Indigo + Outfit/Inter) vs target (Candidate C Energetic Orange + Sora/Inter) nhất quán
  ở mọi doc; WCAG 3.118:1 FAIL / 5.874:1 PASS khớp nhau. FE spec không có hex literal nào.
- **DD-104 strip `DeleteSession`:** sạch cả 2 spec Session; chỉ còn changelog audit row có nhãn
  `(RÚT 2026-08-13)`. Không có `DELETE /api/sessions/:id` ở đâu.
- **Cấu trúc spec:** `feature-spec-template.md` khớp verbatim 17/26 FE; `be-tech-spec-template.md` khớp
  19/25 BE; template có đủ mọi subsection `README.md:16` bắt buộc.
- **Review template ↔ gate:** 21 field token trùng tên và trùng thứ tự, `REVIEW_POLICY_VERSION: 1.3` cả hai.

---

## 8. Còn nợ (không làm trong pass này)

| Việc | Vì sao chưa làm | Điều kiện đóng |
|---|---|---|
| Owner chốt DD-106 Q1/Q2/Q3 | Quyết định của owner, đặc biệt Q1 chạm HARD RULE tiền | 3 câu ✅ hoặc ⬜ trong `decisions.md` |
| Backfill 4 section DD-99 cho 5 `_fe.md` | Nội dung design, không phải sửa cơ học | 5 file 4/4, hoặc DD ghi cố ý không promote |
| ~~`BE/feature_share_activities_tech.md`~~ | — | ✅ **ĐÓNG 14/08** — lane docs-debt viết v0.1, đủ **5 bảng** (không phải 2: FE §4 khai 5) |
| ~~Entry Points vào 2 template + README~~ | — | ✅ **ĐÓNG 14/08** — là **subsection của §1**, không phải section top-level thứ 8 ⇒ count 7/6 giữ nguyên |
| ~~4 spec thiếu Entry Points~~ | — | ✅ **ĐÓNG 14/08** — `club` · `home` · `inapp_chat` (FE) · `club_tech` (BE); toàn repo nay **50 spec** có bảng |
| ~~Gate §11.2 vào `review-doc-plan-session-template.md`~~ | — | ✅ **ĐÓNG 14/08** — port thành §5.1, header 1.2→1.3; `REVIEW_POLICY_VERSION` **giữ 1.3** đúng như §11.2 tự quy định |

> 🔧 **Hai citation sai trong chính bản audit này, lane docs-debt bắt được — đã sửa ở bảng trên:**
> (1) §11.2 nằm ở `review-code-readiness-gate.md` **dòng 384-413**, không phải 150-179 (150-179 là bảng
> acceptance-criteria B2/B3). (2) "mandatory-section list" của `features/README.md` là mục
> **Document Convention (~dòng 31)**, không phải 12-16 — 12-16 nằm trong chính khối 🔴 LIVE-TRUTH mà bản
> audit vừa thêm. Cả hai số chép lại từ báo cáo subagent mà **không tự mở file kiểm** — đúng cái bẫy
> "chế độ author thì suy ra, chế độ review thì kiểm".
| `README.md §2 Screen Map` được khai canonical nhưng thiếu 17 route, còn ghi "QR" mà kickoff đã rút | FE PENDING — không sửa doc FE lúc này | Khi FE mở lại |
| 3 cặp template trùng `docs/templates/` vs `docs/workflow/` | Chưa có ai khai bản nào canonical | Một dòng khai canonical |

---

## 9. File đã sửa trong pass này

```
docs/standards/decisions.md                          +DD-106 🟡, v2.28 → v2.29
docs/features/FE/feature_payment_reconcile.md        nhãn 🟡 DD-106 Q1 + 8 link
docs/features/BE/feature_payment_reconcile_tech.md   nhãn 🟡 tại CHECK constraint
docs/features/BE/feature_inapp_chat_tech.md          nhãn 🟡 DD-106 Q2 tại 3 cột embed
docs/features/FE/feature_channel_booking_funnel.md   nhãn 🟡 DD-106 Q3
docs/features/FE/feature_marketplace_discovery.md    khôi phục §3 + sửa dòng bảng dính
docs/features/FE/*.md  (26 file)                     155 ref ../ → ../../
docs/features/BE/auth-security-invariant-table.md    1 ref ../FE/ → ./
docs/features/README.md                              v2.63 → v2.64
docs/templates/feature-dev/fe-spec-template.md       v0.4 → v0.5 (+§8–§11, path, breakpoint)
docs/channels/web/fe-spec-to-design-playbook.md      v1.0 → v1.1 (banner + 9 link)
docs/channels/web/designer-docs-guide.md             banner + đính chính bảng "chưa có FE spec"
```

Tất cả **chưa commit** — git-write chạy trên máy owner.

---

_Rà soát 2026-08-13 · base `1fdba1d` · không phát hành verdict, không authorize slice._
