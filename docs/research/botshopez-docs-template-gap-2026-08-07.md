# BotShopez (Saas Bot tele) docs template → Plexco: gap analysis

> **Loại:** research / comparative analysis. **KHÔNG phải** review verdict hay build contract; không
> sửa spec nào; không authorize gì.
>
> **Ngày:** 2026-08-07 · **Baseline Plexco:** `main@7e21f65dc4eff0fb845448d8c9a974bcb64f7edb`
> **Input (external, non-authoritative):** 18 FE + 17 BE docs `Saas Bot tele/docs/Phase 1/{FE,BE}/`.
> **Phạm vi:** so **template/kỷ luật doc**, không so nội dung domain (khác `cross-project-standardization-2026-08-07.md`
> — proposal đó so code conventions/tooling/test-infra, không đụng doc template).
> **Bộ sweep cross-project 2026-08-07:** Sporta FE+BE (4 research files) · **BotShopez docs template (file này)**.
>
> **Cập nhật cùng ngày (decisions v2.18):** DD-99 P1 đã ✅ (owner-delegated) — 4 section là điều kiện FE Draft→Reviewed; các pattern §2 file này giữ trạng thái **optional** đúng như quyết định.

---

## 1. Verdict tổng

Template Plexco (FE 10-section + error-mapping i18n + UNPINNED/negative-scope/source-authority-SHA +
4 section Draft DD-99; BE contract/invariant/acceptance + gate máy `review:check`) **đã cover hoặc vượt
gần như mọi kỷ luật của BotShopez**. BotShopez mạnh về tính *thực dụng* (bảng, copy literal, checkbox);
Plexco mạnh về *chống drift* (SHA pinning, UNPINNED fail-closed, validator, decision log). Không có
section nào cần bê nguyên khối. Còn lại 4 pattern nhỏ đáng cân nhắc (§2) và một danh sách REJECT có
lý do (§4) để ai đọc BotShopez docs sau này không port nhầm.

Đối chiếu nhanh các điểm mạnh BotShopez → trạng thái Plexco:

| Điểm mạnh BotShopez | Plexco hiện tại | Verdict |
|---|---|---|
| Error codes 3 tầng + copy literal tiếng Việt | Error mapping per-surface: `status \| code \| visible state \| t(vi,en)` — literal + fail-closed row | ✅ đã có, mạnh hơn (thêm unknown-row + i18n en) |
| "Source of truth" pointer + Schema Diff appendix | Source authority + baseline SHA per doc; schema.ts/migrations AUTHORITATIVE (CLAUDE.md) | ✅ đã có, mạnh hơn (SHA pin) |
| "Definition of done for this spec" | Review gate máy: `REVIEW_POLICY_VERSION` + closure matrix + validator CI | ✅ đã có, mạnh hơn nhiều |
| Honest gap sections (`✅ RESOLVED (date)` / Known risks) | BUILD-STATUS + `Doc status ≠ Implementation status` header + OQ tables | ✅ đã có |
| "Critical Business Rules (Locked)" đánh số + effect matrix | Invariant INV-x + hard rules + decision tables per spec | ✅ đã có; effect-matrix là cách *trình bày* hay (§2.3) |
| Caching Strategy trong FE doc | Cố ý ngược lại: FE cấm cache person-self/money; caching thuộc BE contract | ❌ REJECT cho money/person surfaces (đúng chủ đích Plexco) |
| Multi-tenant app-level (`where shopId` + guard) | RLS fail-closed DB-level (HR) | ❌ REJECT — Plexco đúng hơn về bản chất |

## 2. 4 pattern nhỏ đáng cân nhắc (input cho DD-99 P1, không bắt buộc)

1. **State Coverage Matrix** (FE — `feature_bank_management.md` §12): bảng screen × {Loading·Ready·Error·Empty},
   ô N/A phải ghi N/A — công cụ audit 1-nhìn, chống "quên empty state" ở mức template. Plexco đã
   enumerate states per screen trong prose; matrix là dạng nén, hợp làm phần tuỳ chọn của AC section
   khi owner ratify DD-99 P1.
2. **AC checkbox truy vết BRD `FR-x.y`** (`feature_dashboard.md` §10): AC section (DD-99) hiện trace
   về § nội bộ; thêm quy ước "trace về BRD FR khi feature map trực tiếp FR" giúp đo coverage BRD.
3. **Effect matrix cho transition đa domain** (`feature_ctv_management_tech.md` §7.7 — `Order State ×
   Stock/Quota/Debt`): cách trình bày đáng dùng khi author spec có transition chạm nhiều domain
   (session × charge × waitlist là ứng viên tự nhiên). Authoring pattern, không phải section bắt buộc.
4. **"Deprecated/Forbidden" appendix có đánh số + "Violation = bug"** (`feature_products_tech.md`
   Appendix B): Plexco đã có negative scope per-doc + DD-98; điểm học được là *đánh số* (F1..Fn) để
   review/test cite chính xác từng lệnh cấm. Áp tự nguyện khi author spec mới.

Ngoài ra 1 mục cho channel docs (không thuộc DD-99): **bot copy block nguyên văn** (`feature_bot_engine.md`
§3 — tin nhắn Telegram literal kèm edge-case table). Plexco channel docs không đồng đều: messenger có
`messenger-channel-design.md` chứa template, Zalo (`channels/zalo/` chỉ README, `feature_zalo_channel.md`
không có literal copy block). Khi build bot display slices (CBF §3 design-input đã có), literal copy
block là spec khả thi nhất cho conversational surface — ghi nhận làm authoring pattern.

## 3. Điểm BotShopez tự thú mà Plexco nên coi là bài học xác nhận (không cần hành động)

- "Idempotency **không được giải quyết bằng docs** — audit endpoint thực tế" (`feature_bot_engine_tech.md:362`)
  — trùng khớp nguyên tắc Plexco "docs/contract không phải runtime proof" (CLAUDE.md #9). Hai codebase
  độc lập cùng rút ra một bài — tín hiệu nguyên tắc đúng.
- Template hai thế hệ trộn lẫn không hoà giải (front-matter 2 kiểu, đánh số cứng phải đẻ Appendix chèn
  giữa) — đúng lý do Plexco cần DD-99 P1 ratify một bộ section thay vì để mỗi doc tự tiến hoá.

## 4. REJECT — không port (kèm lý do, chống port nhầm về sau)

| Pattern BotShopez | Lý do không port |
|---|---|
| API JSON schema copy vào FE doc (nguồn sự thật thứ hai) | Plexco đã giải đúng bằng exact-response-path + `UNPINNED — omit`; copy schema là cách tạo drift |
| Rollback = `DROP TABLE` | Plexco migration monotonic + expand-contract; drop-table rollback mất dữ liệu tiền |
| Cron + fire-and-forget cho async (không queue/DLQ) | DD-89/90 đã có job foundation lease/DLQ; fire-and-forget mất event |
| Tenant isolation chỉ app-level guard | HR1: RLS fail-closed DB-level bắt buộc |
| Test quota ("≥20 unit tests") không map file thật | Con số trang trí; Plexco yêu cầu lệnh chạy thật làm bằng chứng |
| Caching section trong FE doc cho person/money surface | Ngược fence "không cache person-self DTO" |
| `Status: ✅ Done` không ngày/owner | Plexco dùng version footer + changelog + BUILD-STATUS |
| Hardcode copy 1 ngôn ngữ trong bảng error | Plexco bắt buộc `t(vi, en)` |

## 5. Hành động session 2026-08-07 (vòng BotShopez template)

| # | Hành động | Trạng thái |
|---|---|---|
| 1 | Research doc này (template FE+BE — 35 files khảo sát) | ✅ |
| 2 | §2 ghi làm input cho DD-99 P1 (owner cân nhắc khi ratify) — KHÔNG sửa DD-99 body | ✅ đúng chủ đích |
| 3 | Không DD mới, không sửa spec nào, không đổi gate/template | ✅ |
