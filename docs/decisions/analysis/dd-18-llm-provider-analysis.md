# 🤖 DD-18 Analysis — Provider embedding/LLM + privacy/ToS (Club Assistant)

> **Mục đích:** chốt HƯỚNG provider cho trợ lý + ranh giới privacy/pháp lý. **Chặn GO-LIVE, KHÔNG chặn build.** P7 post-MVP.
> **Ngày:** 2026-07-13 · **Canonical:** `proposals/club-ai-bot-knowledge-base.md` §7.2 · DD-16..28 (assistant ✅) · DD-21 (grounding KB-only) · DD-17 (pgvector) · HANDOFF §P7 · BRD §8 (privacy). Ghi → `decisions.md` DD-18.

---

## 0. TL;DR — ⬜ Mở (hướng ✅, chặn GO-LIVE)
- **Hướng:** MVP trợ lý dùng **API hosted-first** (tốc độ) đặt **sau interface swappable** `EmbeddingProvider`/`ChatProvider` trong `packages/core` (adapter mỏng, không khoá vendor).
- **Chặn GO-LIVE (không chặn build):** **provider cụ thể + review ToS/DPA/khu vực dữ liệu** phải xong trước khi bật trợ lý cho user thật (P6 Harden). Giữ ⬜ vì open item pháp lý.
- **Bất biến:** grounding **CHỈ KB** (DD-21) — **không** nối `charges`/nợ/PII/ledger vào LLM (HR2). Gửi doc nội bộ CLB tới LLM bên thứ 3 = **xử lý dữ liệu tenant** → phải có DPA + công bố Privacy/ToS.

---

## 1. Canonical hiện trạng
| Sự thật | Nguồn |
|---|---|
| Assistant scope + KB đã chốt (DD-16..28) — **P7 post-MVP** | DD-16..28 |
| Vector store = **pgvector tenant-private** dưới RLS (DD-17) | DD-17 |
| Grounding **chỉ KB**, không ledger/PII (DD-21, HR2) | DD-21 |
| `embedding` dim theo model; đổi model ⇒ reindex (P12 expand→contract) | proposal §7 |
| Interface `EmbeddingProvider`/`ChatProvider` swappable ở `packages/core` | proposal §7.2 |

---

## 2. Contract
- **Interface-first:** mọi provider gọi qua `EmbeddingProvider.embed()` / `ChatProvider.complete()` — code trợ lý **không** phụ thuộc vendor cụ thể.
- **Provider pick (chưa chốt):** cân **chất lượng tiếng Việt · chi phí/câu · độ trễ · privacy/khu vực dữ liệu**. Hosted API (tốc độ MVP) vs self-host (privacy tối đa). Đề xuất hosted-first, self-host là đường lùi nếu DPA không đạt.
- **Legal gate (chặn go-live):** ToS/DPA/data-region của provider + công bố Privacy/ToS Plexco (data-subject, retention) — P6.
- **Reindex:** đổi model → `embedding` dim đổi → **reindex P12** (expand→contract, không mất KB).

## 3. Privacy invariants (HR2)
- Grounding **chỉ KB** (DD-21) — **KHÔNG** gửi `charges`/nợ/`pay_code`/SĐT/email/roster/PII vào prompt/embedding.
- KB gửi tới LLM = doc CLB (có thể chứa thông tin CLB) → **cần DPA + tenant-consent/公 bố**. Nếu DD-34 (global KB) bật → platform-KB (non-PII) an toàn hơn để gửi.
- pgvector tenant-private (DD-17) — RLS giữ KB không rò cross-tenant kể cả khi provider ngoài.

## 4. Dependencies
- **DD-16/17/19/21/23/28** (assistant/KB/grounding/retrieval — đã ✅).
- **DD-34** (global KB) — nếu bật, giảm rủi ro gửi tenant-doc.
- **P6 Harden** (ToS/Privacy/DPA), **P12** reindex.
- Không chặn build assistant (interface cố định); chặn **go-live**.

## 5. Propagation (khi chốt provider, P7)
`proposals/club-ai-bot-knowledge-base.md` §7.2 → `feature_club_assistant(.md/_tech)` (provider adapter + reindex), Privacy/ToS docs (P6), `decisions.md` DD-18 → ✅ khi provider + legal xong.

## 6. Test / verify
interface swap provider không đổi call-site · reindex khi đổi model (KB không mất) · grounding không chứa PII/ledger (scanner) · KB không rò cross-tenant qua provider · legal: DPA/ToS/data-region ký trước go-live.

## 7. Quyết định
Hướng hosted-first swappable interface (build được); **provider cụ thể + DPA/ToS/data-region CHẶN GO-LIVE** (P6). Giữ ⬜. Ghi `decisions.md` DD-18.

**Nguồn:** `proposals/club-ai-bot-knowledge-base.md` §7.2 · DD-16/17/21/34 · HANDOFF §P7 · BRD §8.
