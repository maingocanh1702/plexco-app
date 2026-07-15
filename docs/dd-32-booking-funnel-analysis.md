# 🪝 DD-32 Analysis — Channel-first booking funnel (link → book-in-chat → app)

> **Mục đích:** chốt phễu tăng trưởng + **ranh giới tiền/identity** (A vs C). Ground vào canonical.
> **Ngày:** 2026-07-13 · **Canonical:** `feature_channel_booking_funnel.md` (Draft, DD-32 source) · `feature_cross_club_join(.md/_tech)` (guest open-join tạo charge :106) · `feature_identity` (ID-UC-2) · DD-01 (merge key) · DD-26 (confirm money-adjacent) · DD-29 (acquisition-first) · DD-33/DD-14 (provider login). Ghi → `decisions.md` DD-32.

---

## 0. TL;DR — ✅ Option A (phễu MỀM)
- **Guest vẫn book — KỂ CẢ kèo CÓ PHÍ** (open-join đã tạo `charge` guest, `feature_cross_club_join_tech:106`). Link account **chỉ mở thêm giá trị** + CTA. **KHÔNG** thu hẹp guest-join.
- **Tách rõ 3 việc (không lẫn):**
  1. **Tạo guest booking/charge** → **được** theo A (không cần link).
  2. **Claim/merge một membership ĐÃ CÓ TIỀN** (nhận nợ/lịch sử người khác) → đi nguyên contract `feature_identity`: verified evidence phù hợp (OTP/phone/email/CK provenance hoặc authorized owner evidence), conflict checks, explicit confirmation + audit. **DD-26 chỉ chặn persist alias/name/claim-suggestion khi chưa confirm; KHÔNG tự nó là bằng chứng sở hữu.**
  3. **"Linked" cho hook** = OTP `/link` confirmed **đủ** (lịch sử xuyên club, nhắc, magic-link app).
- **Thứ tự bật social login:** **DD-33 (FB) trước** (Messenger MVP), rồi **DD-14 (Zalo)**. Chưa bật → OTP `/link` thủ công.
- **⚠️ Nếu founder muốn paid-booking BẮT BUỘC web-auth → đó là Option C, phải ĐỔI quyết định** (hiện = A).

---

## 0.1 Correction log
| Rev trước (SAI) | Sự thật |
|---|---|
| "web-auth đầy đủ chỉ bắt buộc ở nhánh có tiền" | Đó là điều kiện của **Option C**. Dưới A, guest **được** tạo paid booking (charge). Strong-proof chỉ cho **claim/merge membership có tiền**, không phải tạo booking. |

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| Funnel doc = **Draft, nguồn quyết định DD-32**; mặc định khuyến nghị phễu MỀM | `feature_channel_booking_funnel.md` |
| **Guest open-join tạo `players`+`charges`** (paid session vẫn book được không cần link) | `feature_cross_club_join_tech:106` |
| ID-UC-2: join tenant lần đầu → membership idempotent (channel identity gắn Person tự động) | `feature_identity.md` |
| CCJ-UC-1: open-join tạo guest membership on-the-fly | `feature_cross_club_join.md` |
| Claim/merge money-bearing membership cần verified evidence + conflict checks + explicit confirmation/audit | `feature_identity.md` §3 · `feature_identity_tech.md` §5–6 · DD-01/13/26 |
| DD-26 chỉ govern alias/name/claim-suggestion confirm-before-persist; không thay identity evidence | DD-26 |
| "linked" cho FB/Zalo phụ thuộc DD-33/DD-14 (chưa bật → OTP `/link`) | DD-33/14 · identity-model §7 |

---

## 2. Phương án (A chọn)
| Option | Guest book | Paid booking | Ghi chú |
|---|---|---|---|
| **A — MỀM (CHỌN)** | ✅ | ✅ guest book được (charge) | link chỉ mở giá trị + CTA; strong-proof chỉ khi claim/merge membership có tiền |
| B — gate cứng | ❌ phải link trước | ❌ | thu hẹp guest-join |
| C — gate có điều kiện | ✅ free | ❌ paid cần link/web-auth | chỉ nếu founder chọn |

## 3. Contract "linked" (3 mức)
1. **guest** (channel identity, không link) → book (incl paid) + CTA link.
2. **linked-lite** (OTP `/link` confirmed) → hook: lịch sử xuyên club, nhắc, magic-link, giữ slot nhanh.
3. **web-auth đầy đủ** (`accounts`+`account_identities` verified) → một nguồn verified identity cho app/deep actions; **không bắt buộc để tạo booking và không tự nó đủ để claim một membership cụ thể có tiền**. Claim/merge luôn theo evidence matrix + conflict checks + confirmation/audit của `feature_identity`.

## 4. Money/identity invariants
- Tạo guest booking (paid) = **money-write bình thường** dưới tenant RLS (DD-05/CCJ) — A không nới/không siết.
- **Claim/merge money-bearing membership** = HR4 → verified evidence theo `feature_identity_tech` §6 + conflict checks + explicit confirmation/audit. DD-26 chỉ bảo vệ persist soft-key; không nâng soft-key thành proof. Không auto-link chéo (FB PSID ≠ web-auth subject — DD-33).
- Book-in-chat KHÔNG lộ venue trước join (DD-06), không lộ nợ/roster người khác (HR2).

## 5. Dependencies
- **DD-33** (Facebook Login) — bật trước; **DD-14** (Zalo Login) — sau (spike).
- **`feature_identity`/`_tech` + DD-01/DD-13** định nghĩa verified evidence và conflict checks cho claim/merge; **DD-26 chỉ thêm confirm-before-persist + audit/parity**, không đứng một mình làm proof.
- **DD-05/06** guest join + venue.
- **DD-29** acquisition-first (lý do chọn A).

## 6. Propagation (khi build, chỉ khi promote Draft)
`feature_channel_booking_funnel(.md/_tech)` (promote Draft + CBF-UC + edge#9 = A); `feature_zalo_channel` + Messenger design (post-book CTA/deep action); `feature_identity(.md/_tech)` (ba mức guest/linked-lite/web-auth và evidence matrix); `feature_web_auth_onboarding` (DD-33/DD-14 provider paths). `feature_cross_club_join(.md/_tech)` chỉ thêm acceptance test **guest vẫn book free/paid**, không thay guest path hay dựng linked-tier gate. **Đã cập nhật:** funnel doc status → ✅ A; edge#9 → A.

## 7. Test fixtures
guest book free→OK · guest book **paid**→OK (charge, không cần link) · CTA link hiện sau guest-book · linked-lite (OTP)→hook features · **claim membership có nợ → verified evidence + conflict checks + explicit confirmation/audit theo identity policy** · alias/name confirm đơn thuần không đủ proof · FB PSID không auto-link web-auth · book-in-chat không lộ venue/nợ.

## 8. Quyết định (đã chốt)
Option A phễu mềm; guest paid-book được; claim/merge money-bearing membership defer nguyên evidence/confirmation/audit contract của identity; DD-33 trước DD-14. *(Paid-booking-cần-web-auth = C → đổi quyết định nếu muốn.)* Ghi `decisions.md` DD-32 ✅.

**Nguồn:** `feature_channel_booking_funnel.md` · `feature_cross_club_join_tech:106` · `feature_identity.md` (ID-UC-2) · DD-01/26/29/33/14 · identity-model §7.
