# 📞 DD-14 / DD-15 Analysis — Zalo Login gating + Bot `from.id` stability (SPIKE)

> **Mục đích:** đây **KHÔNG phải quyết định nội bộ** — cần **spike xác minh với Zalo**. File này = **spike plan** (cần verify gì, cách, tác động). Không chặn build (link_codes bao ca xấu nhất).
> **Ngày:** 2026-07-13 · **Canonical:** `00-start-here/identity-model.md` §3/§5/§7 · `link_codes` (merge/link contract) · DD-32 (funnel — nhánh Zalo) · DD-01 (merge key). Ghi → `decisions.md` DD-14/DD-15.

---

## 0. TL;DR — ⬜ SPIKE (không phải decision)
- **DD-14:** Zalo Login (Social API) có **bị chặn bởi cửa đăng ký OA verified** (đang pending) không, hay độc lập? → **verify với developers.zalo.me**.
- **DD-15:** Zalo Bot `from.id` có **ổn định xuyên nhiều bot** (id toàn cục theo user Zalo) hay **scoped-per-bot**? (Messenger PSID đã xác nhận page-scoped.) → **verify với Zalo Bot Platform**.
- **KHÔNG chặn build:** transactional one-time `link_codes` đã bao **ca xấu nhất** (mỗi CLB link một lần). Kết quả spike chỉ ảnh hưởng mức auto-match + linked-state Zalo cho DD-32.

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| Zalo có nhiều bề mặt tách biệt (Bot Open API · Mini App · OA OpenAPI · Social/Login) | identity-model §7 |
| Plexco đa-bot (mỗi host/CLB một bot) | ROADMAP · identity-model |
| `link_codes` (OTP) = đường link/merge cross-channel — bao ca xấu nhất | identity-model §3/§5 |
| Messenger PSID = **page-scoped** (đã xác nhận) | messenger-channel-design |
| DD-32 funnel: "link ↔ Zalo" phụ thuộc DD-14 (chưa bật → transactional `/link` code) | DD-32 |

---

## 2. DD-14 — Spike plan (Zalo Login gating)
- **Câu hỏi:** Zalo Login yêu cầu đăng ký app trên developers.zalo.me — có **buộc phải có OA verified** (thứ đang pending) không, hay độc lập?
- **Cách verify:** đọc docs developers.zalo.me (Social/Login) + thử tạo app Login sandbox (không cần OA) → xem có bật được không.
- **Kết quả → tác động:**
  - **Độc lập** → có thể bật Zalo Login **trước** OA → làm cầu **auto-match "Zalo login ↔ Zalo bot"** (giảm friction, thay SĐT). Ảnh hưởng **DD-32/provider-link path** (KHÔNG phải DD-13 — đã fence Google/email).
  - **Phụ thuộc OA verified** → chờ OA; phễu Zalo tạm dùng transactional `/link` code.

## 3. DD-15 — Spike plan (Bot `from.id` cross-bot)
- **Câu hỏi:** cùng một người ở hai bot khác nhau: `from.id` là **id toàn cục theo user Zalo** hay **scoped-per-bot**?
- **Cách verify:** cùng một tài khoản Zalo nhắn 2 bot khác nhau (2 app) → so `from.id`.
- **Kết quả → tác động:**
  - **Ổn định xuyên bot** → giảm số lần link cần thiết (auto-match rộng hơn).
  - **Scoped-per-bot** → mỗi CLB link một lần (như hiện tại). **Không chặn** — `link_codes` đã bao.

## 4. Invariants (bất kể kết quả spike)
- **Không auto-link chéo** dựa suy đoán — debt-bearing claim vẫn cần verified account email hoặc transactional one-time `link_code` theo DD-50.
- `link_codes` là đường an toàn mặc định; auto-match chỉ là tối ưu friction, **không** thay khoá merge.
- Token/PII Zalo lộ = giới hạn 1 CLB messaging, không chạm DB/tiền (AUDIT).

## 5. Dependencies
- **DD-32** (funnel nhánh Zalo — chờ DD-14).
- **DD-01/`feature_identity`** (merge key — auto-match không thay).
- **identity-model §7** (provider/channel phase matrix).

## 6. Hành động
- **Giao 1 spike** (dev) xác minh DD-14 + DD-15 với Zalo **trước khi** phụ thuộc auto-match hoặc bật nhánh Zalo của DD-32.
- Ghi kết quả vào `decisions.md` DD-14/DD-15 (chuyển ⬜ → kết luận) + `identity-model §7`.

## 7. Quyết định
**Không chốt được từ nội bộ** — cần spike. Giữ ⬜. `link_codes` bao ca xấu nhất → không chặn build. Ghi `decisions.md` DD-14/DD-15 = SPIKE.

**Nguồn:** `identity-model.md` §3/§5/§7 · `link_codes` · DD-32/01 · messenger-channel-design (PSID page-scoped) · AUDIT.
