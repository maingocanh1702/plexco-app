# So sánh Template Docs: "FR/NFR User Story" vs Plexco/Sporta System

> **Ngày:** 2026-08-14 · **Sửa lần 2 + 2.1:** 2026-08-14 (sau vòng verify repo)
> **Mục đích:** Phân tích ưu nhược điểm giữa template trong screenshot (kiểu enterprise BRD chuẩn) và template system hiện tại Plexco/Sporta, rút ra điều tham khảo được.

> [!WARNING]
> **Giới hạn bằng chứng — đọc trước khi dùng bất kỳ kết luận nào ở dưới.**
>
> Phía screenshot: chỉ **§2.1 Yêu cầu Chức năng** được nhìn thấy. Ngay chân ảnh đã lộ tiêu đề
> **§2.2 Yêu cầu Phi chức năng**, nghĩa là §1, §3, §4… tồn tại nhưng **chưa từng được xem**. Trong
> BRD enterprise, DB schema · API contract · testing plan theo quy ước nằm ở **SDD/TDD anh em**,
> không nằm ở §2.1 BRD — đúng cách Plexco tách BRD → PRD → TDD. Vì vậy mọi phát biểu dạng
> "template kia **không có** X" trong bản v1 đã bị hạ xuống thành "**§2.1 không chứa** X".
>
> Phía Plexco: các claim đã verify chống repo (`docs/templates/*`, `docs/features/*`,
> `docs/product/BRD.md`, `docs/standards/decisions.md`) — xem §6 Evidence Log.

---

## 1. Template từ Screenshot — Đặc điểm

Phần nhìn thấy được là kiểu **BRD/PRD enterprise chuẩn**:

| Đặc điểm | Mô tả |
|-----------|-------|
| **Cấu trúc (phần thấy)** | §2.1 Yêu cầu Chức năng (FR) + §2.2 Yêu cầu Phi Chức năng (NFR) |
| **Format FR** | Bảng `ID \| User Story \| Tiêu chí chấp nhận (Acceptance Criteria)` |
| **User Story format** | "Là {role}, tôi muốn {action} để {benefit}" — chuẩn Agile |
| **Acceptance Criteria** | Kỹ thuật cụ thể, đo được: "File > 5MB tự chuyển Multipart", "sai route_type = 0%", "≤ 30 giây" |
| **Scope** | Payment HUB — backend-heavy, data pipeline, fintech domain |
| **Không quan sát được** | §1, §3+ và mọi doc anh em (SDD/TDD/test plan) nếu có |

**Ví dụ FR điển hình (trích nguyên văn):**

| ID | User Story | Acceptance Criteria |
|----|-----------|---------------------|
| FR01 | Là Maker, tôi muốn upload file Excel/CSV tới 50.000 dòng qua Multipart/Stream Upload để không phải chia nhỏ file thủ công. | File > 5MB tự động chuyển sang chế độ Multipart; Upload thẳng vào MinIO, không qua RAM của service; Trả về `file_url` + `bulk_id` trong ≤ 5s sau khi upload xong |
| FR07 | Là Payment HUB, tôi muốn nhận payload uỷ thác đẩy đủ danh sách chunk + chữ ký để xác thực toàn vẹn dữ liệu trước khi thực thi. | Payload phải pass HMAC-SHA256 signature check; sum(chunk_amount) phải bằng total_amount, sai lệch → reject 400 + mã lỗi cụ thể |

---

## 2. Template System Plexco/Sporta — Đặc điểm

### 2.1 Cấu trúc phân tầng

```
BRD.md (business scope + §8 NFR catalog) → PRD.md (user flows) → TDD.md (tech design + NFR metrics)
                                                       ↓
                                        FE/feature_{name}.md      (Product/UX spec — 7 sections, AC §6)
                                        BE/feature_{name}_tech.md (Backend tech spec — 6 sections)
                                                       ↓
                                        feature-dev/fe-spec-template.md
                                                  (FE Design spec — 11 sections, AC §10)
```

> **Ba tầng, không phải hai.** Ngoài cặp Product/UX + BE tech còn một tầng thứ ba:
> `docs/templates/feature-dev/fe-spec-template.md` — FE **Design** spec, 11 section
> (§2 User Flows · §9 State Machine · **§10 Acceptance Criteria** · §11 Testing Notes), header khai
> `Source authority: features/FE/feature_{name}.md` nên nó là **downstream** của Product/UX spec.
> Hiện mới có template, **chưa instance nào được viết** (nhất quán với việc FE/UI chưa tới lượt dev).

### 2.2 Feature Doc FE (7 sections)

1. Mô tả + Bất biến
2. Use Cases + Edge Cases (≥8 UC, ≥10 edge, 4+ categories)
3. Screens & States (ASCII wireframe + 4-state matrix)
4. Domain Model (shared ground truth)
5. Analytics Events
6. Acceptance Criteria (4 nhóm: Functional/States/UI-UX/Analytics)
7. Open Questions / Changelog

### 2.3 Feature Doc BE (6 sections)

1. Tổng quan triển khai
2. Database Schema + Edge Cases (DDL thật + ≥12 edge cases)
3. API Contract (endpoints + idempotency + rate limit + error codes + form field specs)
4. Chi tiết triển khai (state machine, scenarios by status, timeout, caching)
5. Testing Plan (≥20 unit tests, ≥4 integration tests)
6. Rollout Plan + Changelog

### 2.4 NFR — đã có catalog tập trung

Không phải gap. Hai tầng, đều có ID và metric:

- **`BRD.md` §8** — NFR-S1..S7 (bảo mật/cô lập tenant), NFR-P1..P3 (riêng tư/PII), NFR-PF1..PF3
  (hiệu năng/quy mô), NFR-R1..R4 (tin cậy/toàn vẹn).
- **`TDD.md`** — bảng `NFR-1..NFR-6` có cột **Metric** đo được: `≤ 5s P99`, `sync-lag p95 ≤ 3s / p99 ≤ 10s`,
  `0 rò rỉ cross-tenant`.

Gap thật (nếu có) là **feature doc không ref ngược `NFR-xx`**, không phải thiếu catalog.

---

## 3. So sánh Chi tiết

### 3.1 Điểm MẠNH của phần §2.1 (FR/NFR chuẩn)

| # | Điểm mạnh | Tại sao hay | Plexco hiện thiếu? |
|---|-----------|-------------|---------------------|
| 1 | **User Story format chuẩn** — "Là {role}, tôi muốn {action} để {benefit}" | Buộc tác giả nghĩ từ góc nhìn user, gắn motivation rõ ràng. Stakeholder non-tech đọc hiểu ngay. | ⚠️ **Đúng là gap.** Plexco dùng `ID \| Actor \| Hành động \| Kết quả` (4 cột) — thiếu cột "để… (benefit)". **25/26** FE doc dùng y hệt format này (ngoại lệ: `feature_notifications_reminders.md`). |
| 2 | **FR + AC song hành cùng 1 dòng** | Mỗi yêu cầu chức năng gắn liền acceptance criteria cụ thể → dev biết ngay "xong" nghĩa là gì. | ⚠️ **Đúng là gap.** Plexco tách UC (§2) khỏi AC (§6 Product/UX · §10 FE Design) → không trace 1:1. |
| 3 | **Acceptance Criteria kỹ thuật rất cụ thể** | "HMAC-SHA256", "Redis SETNX TTL 24h", "Time-to-Interactive ≤ 3s" — đo được, không mơ hồ. | ✅ Ngang nhau. Plexco AC cũng testable (`touch target ≥ 44px`), BE AC ở tech doc §5 Testing Plan. |
| 4 | **NFR tách riêng section** | Requirements phi chức năng tập trung 1 chỗ, dễ audit. | ✅ **Không phải gap** — `BRD.md` §8 + bảng NFR của `TDD.md` đã làm đúng việc này, còn kỹ hơn (có cột Metric). Xem §2.4. |
| 5 | **Bảng phẳng, scan nhanh** | PM/lead scan 11 FR trong 2 phút, biết scope toàn bộ. Tốt cho kickoff, sprint planning. | ❌ **Đúng là gap.** Feature doc dài 907 dòng (Session Management FE), không có bản 1-page. |
| 6 | **ID numbering liên tục (FR01–FR11)** | Cross-reference dễ: "FR07 blocked bởi FR05". | ✅ Ngang nhau. Plexco dùng `{FT}-UC-n` (SES-UC-1, CLB-UC-1). |

> **Chốt:** trong 6 điểm, chỉ **#1, #2, #5** là gap thật của Plexco. #3, #4, #6 là hoà.

### 3.2 Những gì §2.1 KHÔNG chứa

> ⚠️ Đây là quan sát về **một section**, không phải kết luận về bộ doc. Với BRD enterprise,
> phần lớn các mục dưới đây **được kỳ vọng nằm ở doc khác** — thiếu ở §2.1 là đúng thiết kế,
> không phải khuyết tật. Cột phải ghi Plexco đặt chúng ở đâu, để đối chiếu chứ không để chấm điểm.

| # | Không có trong §2.1 | Plexco đặt ở đâu | Ghi chú |
|---|---------------------|------------------|---------|
| 1 | Edge cases | FE §2 (≥10, 4+ cat) · BE §2 (≥12, 6 cat) | Khác biệt thật đáng học **theo chiều ngược lại** — nhưng chưa loại trừ khả năng BRD kia có §edge riêng |
| 2 | State machine diagram | BE §4 (match DDL CHECK) | ⚠️ §2.1 **có ám chỉ state**: FR05 ghi `FAILED_DEBIT` |
| 3 | Screen & 4-state matrix | FE §3 | FR10 có chạm UI (Virtual Scrolling, TTI ≤ 3s) nhưng không có state matrix |
| 4 | API contract đầy đủ | BE §3 | ⚠️ §2.1 **có mảnh contract**: FR07 = HMAC-SHA256 + `reject 400` + mã lỗi |
| 5 | DDL / index / migration | BE §2 | ⚠️ §2.1 **có quyết định storage**: FR11 = MongoDB TTL Index + JDBC Batch Insert size 1000 |
| 6 | Testing plan | BE §5 (≥20 unit, ≥4 integration) | FR03 có ghi "unit test bắt buộc" — có ý thức test, không có plan |
| 7 | Analytics events | FE §5 | Không quan sát được |
| 8 | Versioning / changelog | FE §7 · BE §6 | Không quan sát được (thường ở §1 doc control của BRD) |
| 9 | Phân tách FE/BE concern | 2 file riêng | §2.1 gộp UI (FR10) + BE (FR07) cùng bảng — đây là **đặc tính BRD**, không phải lỗi |
| 10 | Domain model / ERD | FE §4 | Không quan sát được |

**Đọc lại đúng:** ba dòng có ⚠️ cho thấy §2.1 nhét *mảnh* của state/contract/storage vào AC. Đó là
điểm yếu thật và **quan sát được** — AC đang gánh việc của tech spec, sẽ drift khi tech spec đổi.
Đây là bài học dùng được, khác hẳn với "họ không có tech spec" (không chứng minh được).

### 3.3 Điểm MẠNH của Plexco/Sporta System

| # | Điểm mạnh | Chi tiết |
|---|-----------|----------|
| 1 | **Depth** | Cover edge cases, state machine, scenarios by status, timeout spec, caching, security checklist |
| 2 | **FE/BE split rõ ràng** | Product/UX spec cho designer/FE dev, Tech spec cho BE dev — 2 audience khác nhau |
| 3 | **Self-audit checklist** | 6 categories audit (Schema/Query/Security/Cross-ref/Completeness/Money) trước khi deliver |
| 4 | **Gate 3 chiều** | Spec claim ↔ code snippet ↔ live code phải khớp — anti-drift |
| 5 | **ASCII wireframe** | Layout + hierarchy trong git-diffable text — tốt hơn Figma link chết |
| 6 | **Decision traceability** | Mọi quyết định ref DD-xx trong `decisions.md` |
| 7 | **Anti-pattern catalog** | Doc writing rules liệt kê anti-patterns + fix — học từ review rounds thực tế |
| 8 | **Risk-based review gate** | Feature money/auth/PII bắt buộc decision table + abuse cases, không chỉ đếm dòng |
| 9 | **NFR có metric** | `TDD.md` gắn số đo cho từng NFR, không dừng ở phát biểu định tính |

### 3.4 Điểm YẾU của Plexco/Sporta System

| # | Điểm yếu | Hệ quả | Mức độ |
|---|----------|--------|--------|
| 1 | **Quá dài, khó scan nhanh** | Không có executive summary 1-page. **Nhưng phân bố lệch:** trong 907 dòng của `feature_session_management.md`, §3 Screens & States chiếm dòng 121–720 = **599 dòng (66%)**; 6 section còn lại cộng lại ~300 dòng. Nguyên nhân là wireframe phình, **không phải** cấu trúc 7-section. | 🔴 Cao |
| 2 | **UC thiếu "motivation/benefit"** | 4 cột `Actor \| Hành động \| Kết quả` → reviewer khó challenge "UC này có cần không?" | 🟡 Trung bình |
| 3 | **AC tách xa UC** | UC ở §2; AC ở **§6** (Product/UX spec) và **§10** (FE Design spec) → không trace 1:1. Dev implement UC-5 phải tự tìm AC nào match. | 🟡 Trung bình |
| 4 | **Feature doc không ref ngược NFR-xx** | Catalog NFR có ở `BRD.md` §8 nhưng feature doc không trỏ tới → audit NFR compliance phải đọc thủ công. *(v1 ghi "không có catalog NFR" — sai, đã sửa.)* | 🟢 Thấp |
| 5 | **Onboarding cost cao** | Contributor mới cần đọc playbook + convention + doc-writing-rules + self-audit checklist + template | 🟡 Trung bình |

> **Đã gỡ khỏi v1:** mục "template overhead cho feature nhỏ → nên cho phép skip section". Xem §4.2 #6.

---

## 4. Điều Tham Khảo Được (Actionable Takeaways)

### 4.1 Nên Áp Dụng

| # | Cải tiến | Cách áp dụng | Effort |
|---|---------|--------------|--------|
| **T1** | **Thêm cột "Để… (benefit)" vào UC table** | `feature-spec-template.md` §2 Use Cases: `ID \| Actor \| Hành động \| Kết quả` → `ID \| Actor \| Hành động \| Để… \| Kết quả`. Doc đang Reviewed không phải sửa hồi tố; áp cho doc mới + doc sửa tiếp. | 🟢 Low |
| **T2** | **§0 Tóm tắt 1 trang** | Bảng FR-style gom UC chính + AC chính trong ≤15 dòng, đặt trước §1. Stakeholder scan 1 page biết scope + done criteria. | 🟡 Medium |
| **T3** | **AC gắn gần UC** (pilot 1 feature trước) | Option A: thêm cột `AC ref` vào UC table. Option B: group AC theo UC cluster trong §6. Thử trên 1 doc, đo có giảm review round không rồi mới roll out. | 🟡 Medium |
| **T6** | **Đẩy wireframe chi tiết xuống tầng FE Design spec** | 66% khối lượng nằm ở §3. **Cơ chế đã có sẵn** — `feature-dev/fe-spec-template.md` chính là tầng chứa Screens & States chi tiết, chỉ là chưa instance nào được viết. Vậy fix không phải "tạo file mới" mà là **luật phân tầng**: §3 của Product/UX spec giữ state matrix + wireframe rút gọn; wireframe đầy đủ thuộc FE Design spec khi FE tới lượt dev. **Đây mới là fix gốc cho §3.4 #1**; T2 chỉ chữa triệu chứng. | 🟡 Medium |
| **T7** | **Cột `NFR ref` trong AC** | Thay vì tạo file NFR mới, cho AC trỏ `NFR-S2`, `NFR-PF3`… về `BRD.md` §8. Đóng đúng gap §3.4 #4 mà không dựng catalog song song. | 🟢 Low |

### 4.2 KHÔNG Nên Áp Dụng

| # | Đề xuất bị loại | Tại sao |
|---|-----------------|---------|
| 1 | Gộp FE+BE concern trong 1 bảng FR | Plexco đã tách FE/BE tốt — gộp lại mất clarity cho 2 audience |
| 2 | Bỏ edge cases | Edge cases là asset quý nhất |
| 3 | Bỏ state machine | Feature phức tạp (session lifecycle, payment) bắt buộc cần |
| 4 | Bỏ versioning | Doc không version = drift không phát hiện được |
| 5 | Flat FR list thay Use Case table | UC table giữ actor/hành động/kết quả rõ hơn cho multi-actor features |
| 6 | ~~**T4** — tạo `NFR-requirements.md` riêng~~ | **Loại.** `BRD.md` §8 + bảng NFR `TDD.md` đã là catalog tập trung. Tạo file thứ ba = bảng song song với khái niệm đã có, đúng thứ `CLAUDE.md` cấm. Thay bằng **T7**. |
| 7 | ~~**T5** — "lite template", cho feature nhỏ skip section~~ | **Loại.** `feature-docs-playbook.md` (mục 5) đã có luật ngược, viết ra sau một sự cố thật: *"Phase sau không được mỏng hơn phase trước — đặc biệt Security và Caching. (Sporta Phase 2 bỏ 2 section này đúng ở các feature thanh toán.) **Feature nhỏ thì section ngắn, không phải section biến mất.**"* T5 = chính xác "section biến mất". |

---

## 5. Kết Luận

| Dimension | §2.1 Screenshot | Plexco/Sporta |
|-----------|-----------------|---------------|
| **Scanability** | ⭐⭐⭐⭐⭐ — 1 page scan xong | ⭐⭐ — 907 dòng, cần thời gian |
| **Depth** | *không chấm được* — mẫu 1 section, không thấy doc anh em | ⭐⭐⭐⭐⭐ — edge cases, state machine, security, testing |
| **Traceability** | ⭐⭐⭐ — FR ID rõ; không quan sát được link tới decision log | ⭐⭐⭐⭐⭐ — DD-xx ref, gate 3 chiều, changelog |
| **Stakeholder friendly** | ⭐⭐⭐⭐⭐ — non-tech đọc được ngay | ⭐⭐⭐ — tech-heavy, cần background |
| **Dev actionability (từ riêng doc này)** | ⭐⭐⭐ — biết "làm gì", "làm thế nào" nằm ở doc khác | ⭐⭐⭐⭐⭐ — DDL, API contract, test plan sẵn trong cặp doc |
| **Overhead/Effort viết** | ⭐⭐⭐⭐⭐ — nhanh, ít effort | ⭐⭐ — effort cao, learning curve dốc |
| **Separation of concerns** | ⭐⭐ — AC gánh mảnh tech spec (FR05/FR07/FR11) → drift risk | ⭐⭐⭐⭐⭐ — mỗi tầng sở hữu đúng câu hỏi của nó |

> [!TIP]
> **Hành động đề xuất, theo thứ tự:**
> 1. **T1 + T7** — effort thấp, sửa template một lần, đóng 2 gap.
> 2. **T6** — fix gốc của "doc quá dài" (66% khối lượng ở §3).
> 3. **T2** — chữa triệu chứng scanability, vẫn đáng làm.
> 4. **T3** — pilot 1 doc, đo trước khi roll out.

> [!IMPORTANT]
> Template screenshot **phù hợp cho context khác**: enterprise fintech, team lớn, stakeholder non-tech
> cần approve nhanh — và gần như chắc chắn có SDD/TDD anh em mà ta chưa thấy. Plexco/Sporta template
> phù hợp cho **solo founder + AI agent** cần depth để reduce review rounds.
> **Không nên thay thế — nên cherry-pick, và chỉ cherry-pick những gì quan sát được.**

---

## 6. Evidence Log

Mọi claim về Plexco ở trên verify chống repo, không suy từ trí nhớ. Base: working tree 2026-08-14.

> ⚠️ **Không pin số dòng.** Trong lúc soát bản này, `feature-spec-template.md` và
> `be-tech-spec-template.md` bị một lane khác sửa (mtime 01:31, `git status` = ` M`) làm **mọi số dòng
> lệch 12–13**. Evidence log vì thế neo bằng **section + chuỗi trích**, không bằng số dòng.

| Claim | Nguồn (anchor, không phải số dòng) | Kết quả |
|-------|-----------------------------------|---------|
| FE 7 sections / BE 6 sections | `docs/features/README.md` Document Convention — khai đúng 7/6; edit 01:31 thêm `### Entry points` là **subsection §1**, README v2.65 ghi rõ "count 7/6 không đổi" | ✅ Khớp |
| UC table 4 cột, thiếu benefit | `feature-spec-template.md` §2, hàng `\| ID \| Actor \| Hành động \| Kết quả \|` + **25/26** file `docs/features/FE/*.md` | ✅ Đúng là gap |
| Floors ≥8 UC / ≥10 FE edge / ≥12 BE edge / ≥20 unit / ≥4 integration | Blockquote `Minimum {n} …` trong `feature-spec-template.md` §2 · `be-tech-spec-template.md` §2/§5 | ✅ Đúng cả 5 |
| Session Management 907 dòng, §3 = 599 dòng (66%) | `docs/features/FE/feature_session_management.md`, §3 `Screens & States` → §4 `Domain Model` | ✅ Đo trực tiếp |
| NFR catalog tập trung **đã tồn tại** | `docs/product/BRD.md` §8 (NFR-S1..S7/P/PF/R) · `docs/product/TDD.md` bảng `NFR-1..NFR-6` có cột Metric | ❌ **v1 claim SAI** → đã sửa, T4 bị loại |
| "AC ở §6/§10" | **Hai template khác nhau:** `feature-spec-template.md` (Product/UX, AC §6) và `feature-dev/fe-spec-template.md` (FE Design, 11 section, **AC §10**) | ✅ **v1 claim ĐÚNG** — bản v2 từng "sửa" thành §6, đó mới là lỗi; đã hoàn nguyên |
| Luật cấm bỏ section cho feature nhỏ | `docs/templates/feature-docs-playbook.md` mục 5: *"Feature nhỏ thì section ngắn, không phải section biến mất"* | ✅ Tồn tại → T5 bị loại |

**Chưa verify được (và không được claim):** mọi thứ về doc anh em của template screenshot. Bằng chứng
duy nhất là một ảnh chụp §2.1.

> [!NOTE]
> **Bài học rút từ chính vòng sửa này:** v2 bác "§6/§10" sau khi kiểm **một** template rồi kết luận cho
> **cả** hệ — trong khi repo có hai FE template ở hai tầng. Cùng đúng cơ chế đã tạo ra lỗi NFR ở v1:
> kiểm một nguồn, phát biểu như toàn bộ. Trước khi bác một claim, đếm xem khái niệm đó có **mấy** hiện
> thân trong repo.

---

## Changelog

| Ngày | Version | Thay đổi |
|------|---------|----------|
| 2026-08-14 | v1 | Bản đầu — so sánh 2 template, 5 takeaway T1–T5 |
| 2026-08-14 | v2 | Verify chống repo. **Sửa 2 claim sai:** NFR catalog (đã có ở `BRD.md` §8 + `TDD.md`) · "template overhead feature nhỏ" (đã có luật ngược trong `feature-docs-playbook.md`). **Loại T4, T5; thêm T6, T7.** Hạ §3.2 từ "không có X" xuống "§2.1 không chứa X" + ghi rõ giới hạn bằng chứng. Bổ sung §2.4, §6 Evidence Log. Sửa nguyên nhân "doc dài" từ cấu trúc → wireframe (66%). Sửa trích dẫn sai FR07. |
| 2026-08-14 | v2.1 | **Hoàn nguyên một "sửa" sai của v2.** v2 bác claim "AC ở §6/§10" là bịa — thực tế repo có **hai** FE template ở hai tầng: Product/UX (AC §6) và `feature-dev/fe-spec-template.md` FE Design 11 section (AC §10); claim v1 đúng. Bổ sung tầng thứ ba vào §2.1, viết lại T6 theo cơ chế phân tầng sẵn có thay vì đề xuất file mới. Sửa "20/20 FE doc" → **25/26**. Gỡ mọi số dòng khỏi Evidence Log sau khi 2 template bị lane khác sửa giữa phiên (số dòng lệch 12–13). |
