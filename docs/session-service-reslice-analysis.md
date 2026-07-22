<!-- review-readiness: criteria -->
# SessionService — re-slice theo mechanism

> **Status boundary:** đây là **analysis**, không phải authorization. Không slice nào dưới đây được mở
> worktree cho tới khi có manifest + acceptance matrix + verdict `CODE_READY` riêng trong
> `slice-readiness-verdicts.md`. Không tài liệu nào ở đây thay `decisions.md`.
> **Machine classification:** `criteria` — kiểm kê bằng chứng + thứ tự dependency, **không có verdict
> slice**. `REVIEW_POLICY_VERSION: 1.3`; `CLOSURE_MATRIX: NOT_APPLICABLE` cho đến khi một slice có
> manifest, acceptance matrix và exact target code được author.
> **Verify-on-disk:** `main@494ad4eae9725ce113f89109de210455651a58e9`, 2026-07-23. Mọi khẳng định về
> code/schema đều đo trực tiếp.

---

## 0. Kết luận một dòng

"SessionService" **không phải một slice** — nó là consumer cuối của các primitive, schema source và
worker chưa tồn tại trong code. Slice đầu tiên có thể author là tenant-integrity migration; nó **có**
đụng `sessions` để thêm composite candidate key. Chuỗi schema/source prerequisite phải hoàn chỉnh
contract DD-39/DD-41 trước khi core consumer tương ứng được author.

---

## 1. Sự thật đo được (không suy từ doc)

**Code feature layer = 0.** Grep toàn `packages/` + `apps/` cho
`evaluateSessionEligibility|evaluateJoinRestriction|deriveChargeAmount|addMemberToSession` → **không file
nào**. Không phải "một phần" — là trắng.

**Bảng đã có sẵn** (migrations `0000–0018` trên main): `sessions`, `players` (+`waitlist_position` từ
`0014`), `session_recurrence_rules`, `session_occurrences`, `session_surface_refs`, `charges`,
`public_sessions`, `join_requests`, `outbox_events`, `projector_deliveries`. Phần khó nhất — RLS
fail-closed + `tenantRepo` choke-point — đã xong và có invariant test chạy trên role runtime thật.

**Bốn khoảng trống schema chặn đường tiền:**

| Thiếu | Ai cần | Bằng chứng |
|---|---|---|
| `persons.gender_enc`, `persons.dob_enc`, **`gender_consent`, `dob_consent`** | DD-39 giá theo giới tính · DD-41 gating gender/age | `schema.ts` chưa có cả encrypted attribute lẫn consent state; `NULL` một mình không phân biệt missing với consent-denied |
| DD-41 session policy đầy đủ: `title`, `notes`, `session_type`, `byoe`, `cost_shared`, `instructions`, `level_min_rank`/`level_max_rank`/`level_strict`, `gender_restriction`, `age_min`/`age_max` | DD-41 (✅ chốt 13/07) | không có trong `schema.ts`; `skill_level` chỉ là baseline text và chỉ được giữ trong plan expand→contract đã pin |
| `sessions.price_male`, `sessions.price_female` | DD-39 `deriveChargeAmount` | chưa có trong `schema.ts`; helper phải dùng `price_amount` fallback, hai cột giá theo gender và decrypt failure contract |
| Composite tenant FK `(tenant_id, session_id)` → `sessions`, `(tenant_id, membership_id)` → `memberships` | tenant integrity cho `players`/`charges` | `grep` toàn `migrations/*.sql` → **không có**; chính BE spec ghi "FK id đơn hiện tại **không đủ** chứng minh tenant integrity (DD-68 prerequisite). CHƯA có trong 0014" |

Khoảng trống tenant-FK đáng lo nhất và ít ai để ý: RLS lọc **đọc**, nhưng FK một cột không chặn được một
bug tầng service chèn `players` trỏ sang `sessions` của tenant khác. Row đó sau đó **vô hình với cả hai
tenant** (cột `tenant_id` nói A, session thuộc B) trong khi `charges` tham chiếu cả hai — hỏng âm thầm,
đúng trên đường tiền. Đây là prerequisite, không phải nice-to-have.

**Blocker đã được chính spec liệt kê.** `feature_session_management_tech.md` §6 Rollout bước 3 ghi thẳng:
waitlist/promotion/charge path **blocked** vì cần `deriveChargeAmount` (DD-39), `evaluateSessionEligibility`
(DD-41), nguồn restriction DD-42, `evaluateJoinRestriction()` (DD-52) và DD-49 correction core —
"**None exist in code yet, nên không wire một nhánh partial**". Danh sách đó là dependency graph thật,
không phải ghi chú.

---

## 2. Vì sao không slice được thành một khối

Ba lý do, tất cả đều là ràng buộc cứng của repo:

1. **Scope cap.** Workflow quy định ~300 LOC / ≤3 module mỗi branch. SessionService đầy đủ (CRUD +
   join/leave + waitlist + promotion + retry + projector) vượt xa.
2. **Trộn risk class.** CRUD session là P1/P2; nhưng join tạo `charges` và promotion tự động tạo charge
   → **money-write**, P0 manual-only, cấm autopilot codegen. Gộp chung nghĩa là toàn bộ phải chạy dưới
   luật P0 — chậm gấp nhiều lần mà không cần thiết.
3. **Bài học đo được của chính repo.** Verdict 13 ghi: thrash tương quan với **thiết kế còn chuyển động
   lúc code**, không phải kích thước diff. AP-26 monolith HALT ở MAX_ROUNDS; `core-matcher` park 3 lần vì
   thiếu decision table. Slice nào bước vào code khi primitive phía dưới chưa chốt sẽ lặp lại đúng vòng đó.

---

## 3. Đồ thị slice đề xuất

Ký hiệu: **L** = layer. Slice cùng layer mà `invariants` rời nhau thì chạy song song được.

### L0 — schema/source prerequisite (không SessionService behavior)

| Slice | Nội dung | invariants | risk |
|---|---|---|---|
| `db-session-tenant-integrity-fks` | Composite candidate keys on `sessions`/`memberships`; every in-scope `(tenant_id, session_id)` / `(tenant_id, membership_id)` FK, including `session_surface_refs`. Expand-only, backfill-verify before constraints | `schema` | **P0** |
| `db-person-eligibility-attributes` | `persons.gender_enc`, `dob_enc`, `gender_consent`, `dob_consent`; enum/state mapping makes missing, denied and decrypt-fail distinct. KMS/redaction, grants and consent invariant tests are in this slice | `schema`, `identity` | **P0** |
| `db-session-dd41-and-dd39-fields` | Full DD-41 field set plus `price_male`/`price_female`; `cost_shared` remains descriptive-only. `level_strict`/age policy and public-whitelist contract are included. Keep `skill_level` only through the explicit expand→contract/backfill plan. DD-82 excludes `session_type='tournament'` | `schema`, `money-model` | **P0** |
| `db-dd42-reliability-source` | Tenant-private attendance/reliability source and policy required by DD-42; no public projection and no implicit global score | `schema`, `reliability` | **P1** |
| `db-dd52-manual-ban-source` | Separate manual-ban storage (reason, evidence, expiry/permanent, actor, audit); never merge semantics with DD-42 reliability ban | `schema`, `member-safety` | **P1** |
| `db-dd45-retry-store` | `waitlist_entry_version`, root retry job, candidate failure event, tenant RLS/grants and narrow worker-claim contract | `schema`, `money-model` | **P0** |

L0 đụng `schema` lẫn nhau ⇒ **tuần tự**. Thứ tự tối thiểu: tenant FK → person attributes/consent →
session policy+pricing → DD-42 source → DD-52 source → DD-45 retry store. Mỗi migration phải tự chứa
backfill/constraint/RLS-grant verification; không sửa migration đã apply.

### L1 — pure logic, `packages/core`, không DB/IO

| Slice | Nội dung | invariants | risk |
|---|---|---|---|
| `core-session-eligibility` | `evaluateSessionEligibility` after L0 person/session sources: DD-41 table, age at `starts_at` in session timezone, literal 9 errors and no strict publish when level source is unavailable | `shared-core` | P1 |
| `core-join-restriction` | `evaluateJoinRestriction()` after distinct DD-42/DD-52 sources: reliability restriction + manual ban, with reason/evidence/expiry/capability results opaque to adapters | `shared-core` | P1 |
| `core-derive-charge-amount` | `deriveChargeAmount` after DD-39 fields: KMS/decrypt typed failure, `price_male`/`price_female` selection and `price_amount` fallback; propose/return only, no DB write or enqueue | `money-model`, `shared-core` | **P0** |
| `core-dd49-rejoin-disposition` | Re-derive canonical financial disposition for existing `left` player: carry-over vs refunded append/defer, unknown→`REJOIN_REQUIRES_REVIEW`; no second charge row | `money-model` | **P0** |

L1 is not an immediate parallel lane: each core has a concrete L0 input/storage contract. `shared-core`
and `money-model` serialize the core slices; the first manifest must prove its named L0 predecessors are
merged on `main` (or be a root slice itself).

### L2 — service, có DB write

| Slice | Nội dung | invariants | risk |
|---|---|---|---|
| `svc-session-crud` | create/update/cancel qua `tenantRepo`; version/optimistic lock; **không** join, **không** money | `core-api`, `schema` | P1 |
| `svc-session-join-leave` | `addMemberToSession` after every core and retry-store predecessor; first activation creates exactly one charge, existing `left` re-derives DD-49, full outcomes create no charge/venue | `core-api`, `money-model` | **P0** |
| `svc-waitlist-promotion-core` | Atomic DD-45 selector/activation under `session→job→candidate/finance`; every candidate re-checks DD-41/DD-42/DD-52 and DD-49 disposition | `money-model`, `schema` | **P0** |
| `svc-waitlist-retry-worker` | CAS/lease root worker, current-order re-entry, bounded three claimed attempts, DLQ/owner-review and stale-claim fencing; calls promotion core, never a partial fallback path | `money-model`, `retry-liveness` | **P0** |

### L3 — projection / surface

| Slice | Nội dung | invariants | risk |
|---|---|---|---|
| `proj-public-sessions` | projector `sessions` → `public_sessions`, field-whitelist DD-06/DD-12 (area only; venue chỉ khi outcome `active`); **invariant test tiền/PII bắt buộc trong CI** | `marketplace` | P1 |
| `proj-session-outbox-sse` | outbox event + SSE web | `core-api` | P2 |

---

## 4. Thứ tự thực thi

```
L0a tenant FK → L0b person consent/PII → L0c session policy+pricing → L1a eligibility → svc-session-crud
                                                ├→ L0d DD-42 source → L0e DD-52 ban source → L1b restriction
                                                ├→ L1c charge amount → L1d DD-49 disposition
                                                └→ L0f DD-45 retry store
L1b + L1c + L1d + L0f → svc-session-join-leave → promotion core → retry worker (P0)
                                                         ↓
                                      proj-public-sessions → proj-outbox-sse
```

Không có cặp implementation slice nào được mở **ngay** từ graph này: L0 chia sẻ `schema`, còn L1a cần
L0b/L0c đã merge. Sau L0c, L1a có thể được kiểm tra song song với L0d–L0f vì tokens `shared-core` và
`schema` rời nhau; scope-gate vẫn phải xác nhận manifest/invariant thực tế. `db-session-tenant-integrity-fks`
là root candidate đầu tiên, nhưng vẫn cần manifest, acceptance matrix và verdict riêng trước khi mở worktree.

---

## 5. Mandatory prior work trước L2 (không phải owner decision mới)

DD-41, DD-42, DD-45, DD-49 và DD-52 đã là authority chốt. Các mục dưới đây là **missing
implementation contracts/slices**, không được diễn đạt lại thành policy choice cho owner:

1. **DD-49 correction core:** `svc-session-join-leave` và promotion phụ thuộc L1d cho mọi existing-`left`
   path. Không được ship only first-activation branch.
2. **DD-42 + DD-52 source:** reliability và manual ban có storage/semantics riêng. `evaluateJoinRestriction`
   nhận kết quả từ cả hai; không được substitute "always not restricted".
3. **Level rank per-sport:** current authority đã pin: thiếu source ⇒ không publish `level_strict`; level
   non-strict chỉ advisory. Source này là prerequisite riêng khi muốn bật strict level, không phải một
   policy gap để implementer tự chọn.
4. **DD-45 retry:** retry store, candidate event, CAS/lease worker và DLQ/owner-review đều bắt buộc cho
   promotion. Không có negative scope "không retry" nào hợp lệ nếu vẫn author DD-45 promotion.

---

## 6. Ngoài phạm vi (ghi để không bị kéo vào)

- **Session Organize** (DD-61..64) — accept-in-principle, build sau P4, không có bảng/service nào.
- **Tournament** (DD-82) — aggregate độc lập, không tái dùng `sessions`/`players`. Chỉ liên quan ở chỗ
  `session_type` CHECK không được nhận `'tournament'`.
- **Retire `skill_level`** — contract phase của expand→contract, cần backfill + nguồn rank; không nằm
  trong L0c.
- **URL/slug** (DD-83) và **share card** (DD-73/78) — consumer của public projection, không phải
  prerequisite.

---

## 7. Điều kiện để slice đầu tiên thành CODE_READY

1. Re-pin authority SHA cùng exact live target files sau mọi change affecting this graph.
2. Author `db-session-tenant-integrity-fks` as the first root candidate: full child-FK inventory,
   backfill probe, constraint/RLS/grant acceptance matrix, rollback/disable plan and P0 manual workflow.
3. Chỉ sau khi prerequisite tương ứng merge, author manifest + matrix cho L0b/L0c rồi từng L1 core;
   trace exact DD-39/DD-41/DD-42/DD-45/DD-49/DD-52 clauses and fail-closed behavior.
4. Issue a distinct readiness verdict only after a slice has exact targets; **không** dùng file này làm
   authority hoặc tạo verdict placeholder.
5. P0/P1 manual-only: không launcher/autopilot codegen. Money path and retry worker remain P0.

---

## Changelog

| Ngày | Thay đổi |
|---|---|
| 23/07/2026 | Reconcile review at `main@494ad4eae9725ce113f89109de210455651a58e9`: add machine `criteria` classification; correct L0 to include consent states, full DD-41 policy, DD-39 price columns and all required DD-42/DD-45/DD-52 sources; add DD-49 core; remove false immediate-parallel and optional-no-retry claims. This remains analysis, not a readiness verdict or coding authorization. |
| 23/07/2026 | Tạo analysis (superseded snapshot `main@3120bf7`): feature layer = 0 file; baseline schema + waitlist DDL exist, but SessionService runtime does not. |
