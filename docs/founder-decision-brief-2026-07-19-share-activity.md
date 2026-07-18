# 📣 Founder Decision Brief — Share & Activity (2026-07-19)

> **Mục đích:** 6 quyết định chặn việc author spec cho cụm **DD-73..78**. **Đã chốt đủ 6 — file này nay là bản ghi quyết định, không còn là form chờ tick.**
> **Kết quả:** ✅ **CHỐT 2026-07-19** — cả 6 câu chọn phương án **(a)**; Q5 kèm **re-scope** (fence/guarded-view/grant migration → DD-12/marketplace). Cluster được ghi tại `standards/decisions.md` **v1.67**; sequencing được sửa tại v1.67; **current authority v1.67**: DD-73..78 → ✅, **DD-64 amended** (self-aggregate), **DD-12 mở rộng scope**. Phân tích: `dd-73-78-share-activity-analysis.md` v1.0.
> **Đọc thế nào:** mỗi mục giữ nguyên bảng đánh đổi để tra lại *vì sao* chốt như vậy; ô ☑ là phương án đã chọn.
> ⚠️ **Chốt xong ≠ mở build.** Chỉ **slice fence/guarded-view (nay thuộc DD-12)** và **DD-73** (route + OG + telemetry + ảnh session) được vào hàng đợi ngay. DD-74/75 chưa vào queue nhưng không bị social evidence gate chặn: sau dependency kỹ thuật + reprioritization bằng telemetry DD-73, chúng tạo activity baseline. **Chỉ DD-76/77** bị hard-gate bởi baseline/liquidity đó; ảnh activity DD-78 đi cùng DD-75. Vẫn còn chặn bởi: marketplace projector chưa implement · **DD-41 projection migration** · DD-42/47/48/50 · canonical-name report/takedown · USR-OQ-3 retention/legal SLA.

---

## ⛔ Không phải quyết định (đã bị HARD RULES quy định — chỉ ghi để bạn biết, không cần tick)

| Điều | Vì sao không phải lựa chọn |
|---|---|
| Marketplace/share/OG **chỉ đọc guarded public view** (`public_sessions` + denial-only fence), không bao giờ đọc `sessions`/base bằng `readonly` | Crawler không xác thực. Revoke current base SELECT, view chỉ project BL-DSC-1 + anti-join fence, biến HR2 + immediate privacy deny thành thuộc tính cấu trúc |
| Activity là **read model**, không có bảng `activities` | HR3 + §P6 — bảng mới = nguồn sự thật thứ hai, lệch ngay khi host sửa attendance |
| Snapshot do **projector** ghi, user chỉ ghi **ý định** | HR3 — user ghi thẳng vào bản public là multi-master |
| Publish chỉ do **verified Person-self** thực hiện và chỉ khi session đã kết thúc, player không bị huỷ/waitlist, attendance xác nhận có mặt | `players` là row theo membership, không phải bằng chứng người đang bấm là đúng Person; publish thiếu proof sẽ biến attendance tenant-private thành dữ liệu công khai ngoài ý muốn |
| Mỗi card có **deterministic source key + provenance**, không chỉ `person_id` | Một Person có thể chơi nhiều session/tenant; khoá theo Person không đủ chống duplicate, correction nhầm nguồn hoặc merge sai card |
| Phase-1 **không hiện tên co-participant** | Hai người cùng public card không chứng minh họ đồng ý được người kia tag tên; DD-48 USR-OQ-8 vẫn mở tới khi có consent tường minh |
| Phase-1 **không có caption/title free-text**; actor-name candidate chỉ từ previewed `persons.display_name` | DD-48 approve field nhưng chưa có accepted sanitation/report-takedown guarantee. Phải land contract đó trước public enablement; không dùng alias tenant để lách dual-consent tên CLB |
| Draft, audience, correction, revoke và erasure có lifecycle + `publication_version` monotonic riêng | Correction không boost feed; correction event chỉ wake reconcile, projector serialize theo source key rồi lock + re-read current multi-aggregate sources nên event cũ không resurrect revoke/downgrade; slug registry detach khỏi card rồi giữ minimal non-PII hash tombstone, còn card payload scrub/minimize/xoá theo USR-OQ-3/legal SLA |
| Tenant intent `published` **không đồng nghĩa đã có public URL** | API trả `PUBLISHING` + opaque operation ref; chỉ trả URL sau staged render + verify-current/CAS activation. Failure retry/DLQ + owner-visible retry/revoke, không public half-built card |
| Privacy-reducing mutation phải **deny ngay, không chờ projector** | Typed server functions derive/verify target; tenant không fence tenant khác/person-global, app không clear/read token. Read path deny global; đúng projector CAS-clear exact token sau convergence. Fence chỉ authz-deny, không ghi snapshot nên HR3 vẫn một content writer |
| Share-card renderer **tách namespace/credential/endpoint** khỏi media store DD-55; public URL đi qua guarded delivery/origin | Chat media nhận UGC private. Share object store không anonymous-readable/listable; mọi request kể cả cache hit được re-check current state/version **trước byte cache**, nên purge lỗi không làm hạ tầng Plexco tiếp tục serve ảnh đã revoke. Dùng chung grant ⇒ một lỗi phân quyền có thể rò DM ra internet |
| Share HTML/OG + image renderer dùng typed/context-escaped input; worker bundled-assets-only, **no egress/secrets/arbitrary filesystem**, raster PNG only | Canonical text vẫn user-controlled; sanitation không tự chặn HTML/SVG/CSS/URL injection. Server-built URL + context escaping + sandbox ngăn script/SSRF/cloud-metadata/secret read |
| Feed đọc **hoàn toàn trong global plane**, không UNION cross-plane | HR1 — đúng cảnh báo đã ghi ở DD-70 |
| Whitelist card lấy từ **BL-DSC-1**, không lấy DDL `0006` | DD-41 đã retire `skill_level` khỏi public |
| Feed/kudos chỉ mở sau **product-evidence gate** | Không dựng social graph và reaction surface trước khi telemetry DD-73 chứng minh share→join hoặc repeat-use có tín hiệu đủ mạnh |

---

## Q1 · Tên CLB có được xuất hiện trên activity card của player không?

**Vì sao là quyết định thật:** `public_sessions.club_display_name` an toàn vì **CLB tự publish chính nó**. Card **cá nhân** gắn tên CLB thì thế giới suy ra được *"người X là thành viên CLB Y"* — đó là **rò roster theo chiều ngược**, đúng thứ HR2 cấm. Nhưng đây cũng là chỗ CLB được marketing miễn phí, nên không phải cứ cấm là tối ưu.

| Phương án | Được | Mất |
|---|---|---|
| **(a) Phase-1 không gắn tên CLB** ✅ | Rẻ nhất, an toàn tuyệt đối, không cần setting/field/fence target nào | CLB mất free marketing trong phase-1; có thể mở lại bằng contract additive riêng |
| **(b) Dual-consent, default OFF** *(đích đến tương lai, KHÔNG phải phase-1)* | CLB được nhắc tên khi **cả hai** đồng ý (player opt-in **và** tenant bật `allow_club_attribution`) | Tốn 2 setting + 2 chỗ UI; phải test tổ hợp thiếu-một-phía |
| **(c) Player tự quyết một mình** | Đơn giản cho player | ❌ Rò roster ngược — CLB kín mất quyền kiểm soát danh sách thành viên |

> **Ghi chú thực thi:** (a) → (b) là additive. Nếu ship (b), tên chỉ lấy từ canonical moderated `club_display_name`, không raw tenant/membership alias/client text. Ngược lại (c) → (b) thì đã rò rồi, không thu hồi được.
> Kèo thuộc **personal tenant (DD-46)** luôn OFF ở mọi phương án (không có CLB thật).

**Chốt (owner 2026-07-19):** ☑ **(a) Không bao giờ — phase-1** ☐ (b) Dual-consent, default OFF ☐ (c) Player tự quyết
**Ghi chú:** (b) giữ làm **đích đến**, bật sau bằng đường additive. Ở phase-1 (b) cho ra **đúng cùng hành vi** (mọi card OFF) nhưng tốn 2 setting + 2 UI + test tổ hợp thiếu-một-phía ⇒ cắt.

---

## Q2 · Một activity mới là draft hay tự động publish?

**Vì sao là quyết định thật:** `draft/published/revoked` là lifecycle; `followers/public` là audience sau khi publish. Trộn `private` vào cùng một enum vừa mơ hồ về ý định, vừa dễ làm projector hoặc renderer public hoá activity trước khi user xác nhận.

| Phương án | Được | Mất |
|---|---|---|
| **(a) Tạo `draft`; user chọn `followers` hoặc `public` khi publish** *(khuyến nghị)* | Consent rõ; model sạch; không ai bị bất ngờ; vẫn hỗ trợ share ra internet khi user chủ động | Thêm một bước publish và UI nhắc |
| **(b) Sau lần xác nhận đầu, cho opt-in auto-publish `followers`** | Giảm thao tác cho user đã hiểu tính năng; engagement tốt hơn mà vẫn có consent | Cần setting, audit và đường tắt/tắt dễ thấy; chỉ nên mở sau telemetry |
| **(c) Auto-publish `followers`/`public` mặc định** | Feed dày ngay | ❌ Dữ liệu hoạt động của người thật bị phát tán trước consent; rất khó lấy lại niềm tin |

> **Ghi chú:** các sản phẩm thể thao khác chỉ là tham chiếu cho mô hình audience theo từng activity, không phải bằng chứng để copy default. Feed density chưa phải bài toán vì follow graph (DD-47/48) mới build P4+.
> ⚠️ **(b) hiện KHÔNG có trong contract DD-75.** DD-75 chỉ định nghĩa `draft/published/revoked` + **confirm bắt buộc từng lần publish** ("không có auto-upgrade từ profile setting"; `followers→public` cần confirm mới). Auto-publish, kể cả opt-in, **mâu thuẫn với confirm-per-publish** ⇒ chọn (b) thì phải **amend DD-75** tường minh (định nghĩa setting, audit, đường tắt, và điều kiện telemetry để bật), không phải chỉ tick.

**Chốt (owner 2026-07-19):** ☑ **(a) Draft + chọn audience lúc publish** ☐ (b) Opt-in auto-publish ☐ (c) Auto-publish mặc định
**Ghi chú:** (b) mâu thuẫn confirm-per-publish của DD-75; muốn mở sau phải **amend DD-75** tường minh, không suy ra từ chốt này.

---

## Q3 · Comment dưới activity card: ship cùng kudos hay defer?

**Vì sao là quyết định thật:** DD-55 đã nâng **block + report + rate-limit** thành *hard enablement gate* cho open-DM. Comment công khai có bề mặt lạm dụng **rộng hơn DM**: người lạ, hiển thị cho bên thứ ba, khó gỡ.

**Điểm cần biết:** **không doc nào đang sở hữu moderation cho comment công khai.** CHT-OQ-2 chỉ hỏi quyền host trong **club channel** — surface tenant-scoped **có chủ sở hữu rõ ràng**. Card sống ở **global plane, không có host nào sở hữu**: ai xoá, ai nhận report, ai chịu trách nhiệm khi có nội dung xấu — chưa có câu trả lời. Ship comment nghĩa là phải mở và đóng một open question mới, không phải dựa vào cái sẵn có.

| Phương án | Được | Mất |
|---|---|---|
| **(a) Chỉ kudos, defer comment** *(khuyến nghị)* | Kudos **không có free-text** ⇒ không cần content moderation; vẫn bắt buộc block, rate-limit, undo và abuse handling | Tương tác nông hơn; vẫn có chi phí safety/abuse |
| **(b) Ship cả comment** | Tương tác sâu hơn | Phải dựng moderation/report/takedown cho surface không-có-host **trước** khi bật; đi ngược chính gate vừa dựng ở DD-55 |

**Chốt (owner 2026-07-19):** ☑ **(a) Kudos trước, defer comment** ☐ (b) Ship cả comment
**Ghi chú:** comment cần (i) safety stack DD-55 + (ii) một OQ moderation mới cho surface global-plane không-có-host.

---

## Q4 · Amend DD-64 để card v2 có số liệu trận đấu?

**Vì sao là quyết định thật:** DD-64 đã chốt **"không project organize sang public"**. Card v2 có `matches_played`/`sets_won` **chính là** organize đi ra ngoài. Đây không phải chỗ để lách bằng cách "doc thấp hơn chưa cập nhật" — phải amend tường minh hoặc không làm.

**Ngoại lệ đề xuất (hẹp nhất có thể):** chỉ **aggregate của chính actor**, do **chính actor publish**; **không** tên đối thủ/đồng đội, **không** chi tiết từng set, **không** sơ đồ sân. Board organize và mọi read cross-player vẫn tenant-private nguyên vẹn.

| Phương án | Được | Mất |
|---|---|---|
| **(a) Chấp nhận ngoại lệ self-aggregate** *(khuyến nghị)* | Card v2 có nội dung đáng khoe (số trận, tỉ lệ thắng) — thứ làm người ta share | Phải sửa DD-64 + test chứng minh ngoại lệ không nới ra cross-player |
| **(b) Không amend** | DD-64 giữ nguyên tuyệt đối | Không có match stats được phép public; giữ nguyên v1 scheduled fields và bỏ khái niệm v2 cho tới khi có aggregate khác được duyệt |

> **Lưu ý:** DD-61..64 build **post-P4**, nên câu này không chặn việc gì trước mắt — nhưng chốt sớm để biết có cần thiết kế contract "additive v1→v2" hay không. Chọn (b) thì DD-74 đơn giản hẳn.

**Chốt (owner 2026-07-19):** ☑ **(a) Amend, ngoại lệ self-aggregate** ☐ (b) Không amend
**Ghi chú:** accept-in-principle theo idiom DD-61..64 — exact field v2 chốt tại build time, không thiết kế trước. DD-64 đã ghi amendment.

---

## Q5 · DD-73 (share link + ảnh preview) có tách thành slice riêng ship sớm không?

**Vì sao là quyết định thật:** cụm này phục vụ **hai bài toán khác nhau**. DD-73 = **acquisition** (link kèo lan ra Zalo/Messenger → discovery, thẳng hàng KPI *"% player join qua discovery"* ở BRD §4.2 và gate #2 của DD-69). DD-74..77 = **retention** (gate #1). Gộp làm một slice thì phần rẻ và có giá trị sớm bị kẹt sau phần đắt.

| Phương án | Được | Mất |
|---|---|---|
| **(a) Tách slice riêng, ship ngay sau khi projector land (P4.3)** *(khuyến nghị)* | Không chờ DD-42/47/48; kèm join revalidation + funnel telemetry để đo acquisition và gate DD-69/DD-76/77; là phần **rẻ nhất về rủi ro/quyết định** của cụm | **Không còn là slice “chỉ thêm một route”** — cần fence table + guarded view + narrow functions + `public_projection_version` + migration chuyển mọi consumer marketplace khỏi base table, **và** chờ **DD-41 projection migration** (whitelist BL-DSC-1 chưa có trong `public_sessions`) |
| **(b) Gộp cả cụm sau P4** | Một lần thiết kế, một lần review | Mất kênh acquisition trong suốt giai đoạn cần nó nhất |

> ⚠️ "Ship sớm" ở đây nghĩa là **ngay sau khi marketplace projector (DD-12, phase **P4.3**) hoạt động** — projector hiện **chưa implement**, nên đây là thứ tự ưu tiên, không phải lịch. DD-73 không thể sớm hơn blocker của nó.
> ⚠️ **Blocker thứ hai, mới nhận ra:** whitelist BL-DSC-1 (`title`, `session_type`, `level_*`, `gender_restriction`, `age_min/max`) **chưa tồn tại trong `public_sessions`** — migration cột của DD-41 chưa implement. Trước khi nó land, card chỉ render được tập con field thực có; **không** được bù bằng cách đọc `sessions`. Điều này không đổi khuyến nghị (a), nhưng làm nó rẻ ít hơn bạn nghĩ.

**Chốt (owner 2026-07-19):** ☑ **(a) Tách slice riêng — kèm RE-SCOPE** ☐ (b) Gộp cả cụm
**Ghi chú:** *safety fence + guarded view + narrow functions + `public_projection_version` + grant migration* **chuyển về DD-12/marketplace** (marketplace đang thiếu đường deny tức thì, cần dù không có share). DD-73 đúng nghĩa = route `/s/<id>` + OG card + funnel telemetry.

---

## Q6 · Ảnh share: chỉ template mặc định, hay cho upload luôn?

**Bối cảnh:** bạn đã yêu cầu *"ảnh mặc định từ Plexco"*. Cần chốt thêm là phase-1 **có mở upload không**. Lưu ý Plexco **không có nguồn ảnh cá nhân hợp lệ nào** hiện tại: không track GPS (nên không có bản đồ route như Strava), và **DD-48 đã chốt `avatar` excluded** tới khi có model.

| Phương án | Được | Mất |
|---|---|---|
| **(a) Một template system có variant theo môn + preview draft xác thực** *(khuyến nghị)* | Không upload/caption nên không cần media-moderation pipeline mới · không EXIF/storage abuse/rủi ro ảnh người khác; ảnh deterministic, cache tốt, brand nhất quán; user xem trước được mà chưa public object | Cá nhân hoá bằng dữ liệu/variant thay vì ảnh thật; canonical text vẫn cần sanitation + report/takedown |
| **(b) Cho upload ảnh riêng phase-1** | Cá nhân hoá, ảnh thật hấp dẫn hơn | **EXIF chứa toạ độ GPS chính xác của sân → phá thẳng DD-06** (`area`-only). Thêm: moderation ảnh **công khai** (khó hơn ảnh trong DM), quota/malware/takedown, rủi ro ảnh có mặt người khác |

> Phase-2 mở upload **chỉ khi** đã có đủ media safety stack DD-55 **và** một quyết định riêng cho ảnh công khai: EXIF strip bắt buộc, moderation trước hiển thị, takedown path. Không suy ra từ DD-55.

**Chốt (owner 2026-07-19):** ☑ **(a) Template system + sport variants + draft preview** ☐ (b) Cho upload phase-1
**Ghi chú:** upload mở lại chỉ khi có media safety stack DD-55 **và** quyết định riêng cho ảnh công khai (EXIF strip, moderation trước hiển thị, takedown).

---

## Đã làm sau khi chốt · và còn lại gì

**Đã làm (19/07):**

1. ✅ Ghi vào `standards/decisions.md` **v1.67** — DD-73..78 → ✅; **DD-64 amended** (self-aggregate); **DD-12 mở rộng scope** (nhận khối fence/guarded-view theo Q5).
2. ✅ `ROADMAP.md` Next Actions: thêm **(8a)** immediate-deny path cho public read model *(thuộc DD-12)* → **(8b)** DD-73 route + OG + telemetry + ảnh session. DD-74/75 chưa vào hàng đợi ngay; DD-76/77 bị hard-gate bởi activity baseline; DD-78 đi cùng consumer.
3. ✅ Analysis `dd-73-78-share-activity-analysis.md` v1.0 + §12 nay là bản ghi 6 chốt và sequencing không vòng lặp.

**Còn lại (chưa làm):**

4. ⬜ Author spec cho **DD-74..77** — vẫn còn **một engineering allocation pin**: (a) cặp mới `feature_activity_share(.md/BE/_tech)` *(khuyến nghị)* hay (b) mở rộng `feature_user_settings`. Chốt lúc DD-42/50 sẵn sàng và telemetry DD-73 được review; DD-74/75 tạo baseline, còn DD-76/77 chỉ mở sau baseline/ngưỡng owner.
5. ⬜ **DD-73 không tạo file mới** — viết thành section trong `feature_marketplace_discovery(.md/_tech)`. **DD-78 (ảnh)** đi vào cả marketplace lẫn doc ở (4); renderer/contract viết một lần rồi tham chiếu.
6. ⬜ Neo `USR-OQ-4`; **giữ `USR-OQ-8` mở**. Ghi ngoại lệ self-aggregate vào `feature_session_organize` *(DD-64 đã ghi)*.
7. ⬜ BL mới ở `standards/business-rules.md` cho whitelist card + revoke.
8. ⬜ `schema.ts` + migration **monotonic tại thời điểm mở slice** (không hardcode số) + DBML + ERD.
9. ⬜ ⚠️ **CI invariant test phải land TRƯỚC khi bật projector** — enablement gate, không phải việc dọn sau.
10. ⬜ Đóng `USR-OQ-3` (retention/erasure SLA) + legal review **trước** public activity enablement.
11. ⬜ Blocker riêng của DD-73: **DD-41 projection migration** (whitelist BL-DSC-1 chưa có trong `public_sessions`).

---

## Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 19/07/2026 | v1.1 | **Sequencing correction (decisions v1.64 / analysis v1.0).** Gỡ vòng lặp evidence: DD-73 acquisition trước; DD-74/75 sau dependency + reprioritization để tạo activity baseline; chỉ DD-76/77 hard-gated bởi liquidity; DD-78 đi cùng từng consumer. Q1 no-attribution cũng đồng nghĩa không dựng target/function/flag attribution phase-1. |
| 19/07/2026 | v1.0 | **ĐÃ CHỐT (owner 2026-07-19).** Cả 6 câu chọn phương án (a); Q5 kèm re-scope đưa fence/guarded-view/grant migration về DD-12/marketplace. Ghi vào `decisions.md` v1.60: DD-73..78 → ✅, DD-64 amended (self-aggregate), DD-12 mở rộng scope. Sequencing wording của entry này được corrected ở v1.1. |
| 19/07/2026 | v0.4 | Đồng bộ authority v1.56/analysis v0.7. Thêm per-surface/target denial-only fence để privacy transition deny trước eventual projector; guarded view thay base read. Pin `publication_version` + reconcile-current-source, DB↔renderer staging/CAS, opaque ref + pre-cache auth/private origin, renderer sandbox no-egress raster-only và retention owner đúng. Sửa claim quá mức về DD-48 sanitation/UGC. Bổ sung CI gates fence/multi-source/order/render/injection/retention/cache. |
| 19/07/2026 | v0.3 | Audit fixes: Q2 thêm cảnh báo **(b) chưa có trong contract DD-75** (mâu thuẫn confirm-per-publish ⇒ phải amend, không chỉ tick); "Sau khi bạn tick" khôi phục 3 mục bị rơi so với analysis §10 — BL business-rules, schema/migration/DBML/ERD, và **CI invariant test phải land trước khi bật projector** — cộng USR-OQ-3 retention gate. Authority → v1.55. |
| 19/07/2026 | v0.2 | Recheck code-aware: Person-self + ended/present; scheduled fields + canonical sanitized name, không caption/co-participant; lifecycle≠audience; deterministic source + hash-only slug tombstones; followers/draft không public object; correction/revoke/erasure + retention gate; surface-specific money whitelist; evidence gate; kudos abuse controls; one template system + sport variants + protected preview. Đồng bộ authority v1.53/analysis v0.5. |
| 19/07/2026 | v0.1 | Khởi tạo — 6 quyết định của cụm DD-73..78 (club attribution · default visibility · comment · amend DD-64 · tách slice DD-73 · upload ảnh), mỗi mục có khuyến nghị + đánh đổi + ô tick. |
