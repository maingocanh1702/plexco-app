# Autopilot slice — Auth D0/D1 implementation packet (docs-only)

> **Slug:** `docs-auth-d0-d1-implementation-packet`
> **Risk:** P2 docs-only · `manual_only` · STOP_AT_READY · 1 FULL-base Codex clean round
> **Canonical framework:** `autopilot-prompt-GENERIC` v0.6.0
> **Authority:** DD-80 (`standards/decisions.md` v1.77) · `b0-auth-credential-lifecycle-design-probe.md` (✅ owner-approved 2026-07-19) · `features/BE/feature_web_auth_onboarding_tech.md` v2.8 (acceptance D0-1..10 / D1-1..15) · `slice-readiness-verdicts.md` v0.3 (Verdict 3 D0 = CODE_READY · Verdict 4 D1 = PLAN_READY)
> **Manifest:** `docs/autopilot-manifests/docs-auth-d0-d1-implementation-packet.json`

## Task

```text
Author ONE new file docs/auth-d0-d1-implementation-packet.md: a copy-paste-grade implementation packet for the
two auth slices (D0 revoke-core, D1 google-adapter) so the founder's ATTENDED P0 session can implement with
zero design decisions left.

Everything is DRAFT TEXT inside that one markdown file. Do not create or modify anything under packages/ or
apps/. Do not edit Reviewed specs, decisions.md, or the verdicts file. This packet is traceability/preparation,
not build authorization: P0 auth code remains founder-attended manual workflow.
```

## Canonical read order (HARD RULE — read before writing anything)

1. `packages/db/schema.ts` + `packages/db/migrations/*.sql` (đặc biệt `0012_auth_functions.sql`) — live truth.
2. `docs/probes/b0-auth-credential-lifecycle-design-probe.md` — toàn bộ; §3/§3.2/§4/§4.1/§5/§5.2/§6/§8/§9/§10 là contract đã owner-approve (DD-80).
3. `docs/features/BE/feature_web_auth_onboarding_tech.md` v2.8 — §3 endpoints, §4, acceptance matrix D0/D1.
4. `docs/features/BE/feature_identity_tech.md` v1.10 §4–§5 (lock hierarchy giao nhau với `link_codes`).
5. `docs/standards/review-code-readiness-gate.md` v1.1 (nguyên tắc: không tự phát minh rule).

Mọi mâu thuẫn giữa các nguồn trên → dừng section đó, ghi exact mâu thuẫn vào `HALT-AUTHORITY_AMBIGUOUS.txt`
(kèm file/line hai phía). Không tự chọn một phía.

## Required packet structure (all sections mandatory)

| § | Nội dung | Điều kiện PASS |
|---|---|---|
| A1 | **Draft DDL `0015_auth_revoke_account.sql`** — fenced SQL: internal `auth_revoke_account_sessions(p_account_id uuid)` (KHÔNG grant `app`/`app_worker`); public wrapper derive account từ `p_token_hash` current session (không nhận account_id); grants/revokes theo access pattern 0012; audit `logout_all` cùng transaction; lock order `accounts` → `web_sessions` (B0 §5.2/§6) | Mọi function/grant match B0 §6.1/§6.2 từng câu; header comment ghi EXPAND-ONLY + rollback = DROP/REVOKE |
| A2 | **Schema mirror §9(a)** — fenced TypeScript draft cho `auth_login_nonces`/`auth_login_state`/`rate_limit_hits` trong `schema.ts`, đúng DDL live 0012, zero behavior change | Column-by-column khớp `0012_auth_functions.sql` thật (đọc file, không nhớ) |
| A3 | **Route + test skeleton D0** — `/api/auth/logout-all` handler outline (CSRF → resolve → wrapper → 401-on-replay) + bảng map D0-1..D0-10 → tên test file/case cụ thể | Đủ 10/10 case, mỗi case có expected result nguyên văn từ acceptance matrix |
| B1 | **Draft DDL `0016_oauth_transactions.sql`** — `auth_oauth_transactions` columns/type/constraints theo B0 §4.1 (state single-use claim, PKCE ciphertext `bytea` + key-version text, expiry, provider enum) | Match B0 §4.1 + tech v2.8 §4; single-use claim là DB constraint/CAS, không app-only |
| B2 | **Google adapter outline** — JWKS/proof matrix checks (§2), collision transaction 8-cell (§4) dạng decision table + function signature; route skeletons state/callback (Lax binding, KHÔNG `sameOriginRequest()`) | 8/8 cell có expected outcome nguyên văn; negative scope (email-change, auto-merge) ghi rõ |
| B3 | **Test skeleton D1** — map D1-1..D1-15 → test file/case | Đủ 15/15 |
| C | **DD-38/39 readiness packet** — từ `feature_user_settings*`/`feature_inapp_chat*` specs: liệt kê expand-only schema surface cần migration (gender/pricing settings + chat tables), dependency (trước dd41), draft closure-matrix 12 dòng ở trạng thái hiện tại (không verdict) | Chỉ liệt kê từ spec đã có, src-trace từng dòng; KHÔNG thiết kế bảng mới |
| D | **Self-check table** — mỗi § ở trên: nguồn đã đọc (file+section), PASS/GAP | Không GAP mới được ghi completion marker |

Cuối file khi mọi section PASS, thêm đúng một dòng marker:

```text
AUTH_D0_D1_PACKET_COMPLETE
```

## Rules

- Draft phải copy-paste-grade nhưng sống DUY NHẤT trong packet doc. Tạo/sửa bất kỳ file nào ngoài manifest
  scope là scope breach → HALT.
- Không claim runtime/code-ready thêm; verdicts v0.3 là trạng thái duy nhất được nhắc lại nguyên văn.
- Không đổi/downgrade bất kỳ floor nào (Argon2id, rate limit, cookie policy) — packet chỉ transcribe DD-80.
- Thiếu evidence trong canonical (ví dụ spec DD-38/39 không đủ để liệt kê schema surface) → ghi GAP trong §C
  + `AWAIT-FOUNDER-dd3839-scope.txt`, KHÔNG suy diễn.

## Deterministic outcome

| Trạng thái | Kết quả bắt buộc |
|---|---|
| Mọi section PASS, self-check không GAP | Marker `AUTH_D0_D1_PACKET_COMPLETE` + READY flow §5.4 dispatcher |
| Mâu thuẫn authority bất kỳ | `HALT-AUTHORITY_AMBIGUOUS.txt` (exact hai phía), không marker |
| §C thiếu nguồn | Packet vẫn READY được nếu A/B PASS; §C ghi GAP + `AWAIT-FOUNDER-dd3839-scope.txt` |
| Hết giờ | `HALT-TIMEBOX.txt`, commit an toàn, giữ worktree |

Verification (docs-only):

```bash
pnpm exec prettier --check docs/auth-d0-d1-implementation-packet.md
git diff --check
git diff --stat main...HEAD   # chỉ được chứa đúng manifest scope
```
