# AP-45 — owner runbook · `dd38-dd86-chat-schema-core` · đóng dependency và tái thẩm định

> **Slice:** P1 root chat-schema migration (slice 3 của cây DD-38/DD-86)
> **Manifest:** `docs/autopilot-manifests/dd38-dd86-chat-schema-core.json`
> **Task contract:** `docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md`
> **Launcher (bước 2):** `.claude/commands/ap-45-dd38-dd86-chat-schema-core.md`
> **Soạn:** 2026-08-10 · base `main@3891bdf`
>
> Ngôn ngữ: prose dẫn tiếng Việt, khối paste tiếng Anh — theo `ap23-inbound-webhook-RUN.md`.

---

## Vì sao cần hai bước, không phải một

Launcher `/ap-45-dd38-dd86-chat-schema-core` **đã tồn tại** và sẵn sàng. Nhưng contract của nó đang mang
`REVIEW_VERDICT: NOT_CODE_READY` với classification `<!-- review-readiness: enforce -->` — tức nó **không
authorize coding**. Chạy thẳng launcher là viết code trên một packet chưa được cấp phép, đúng thứ
`docs/standards/review-code-readiness-gate.md` sinh ra để chặn.

Hai blocker của nó **đã đóng** (cả hai dependency đã merge), nhưng verdict block vẫn ghi
`NOT_MERGED, NOT_AUTHORED` cho cả hai. Cần một pass tái thẩm định trước.

## Ba dữ kiện đã mục kể từ khi packet được author (2026-08-03, `AUTHORITY_SHA 90d292d`)

| Packet đang khai | Sự thật đo được 2026-08-10 |
| --- | --- |
| scope pin `migrations/0029_chat_schema_core.sql` | `0029` đã bị `0029_dd29_capability_registry_contract.sql` chiếm; tail là `0030` ⇒ slice này phải là **`0031`** |
| *"migration tail 0027"*, *"no `chat_*` anywhere"* | tail `0030`; `chat_dm_safety_config` / `chat_blocks` / `chat_reports` đã tồn tại |
| `dep_checks: []`, `base_sha: null` | cả hai bắt buộc phải có trước khi `register` chấp nhận |

Bẫy số migration **đã nổ một lần trong chính chuỗi này** — §6 của packet tự ghi rằng AP-45 đoán `0029`
cho chính nó rồi hai migration DD-29 không liên quan tiêu mất số đó. Đừng đoán lần nữa.

## Bước 1 — pass tái thẩm định (paste khối này)

```text
Read docs/00-start-here/HANDOFF.md and docs/standards/review-code-readiness-gate.md first.

OUTCOME: bring AP-45 dd38-dd86-chat-schema-core from NOT_CODE_READY to strict CODE_READY. This is a
READINESS pass only — do NOT implement the migration, do NOT create a branch or worktree, do NOT register.

Both hard dependencies have closed since the packet was authored. Verify each yourself before using it:
- chat-definer-role-provisioning: infra/postgres-init/02-chat-definer.sql exists on origin/main and
  contains `CREATE ROLE chat_definer`. Originally landed 286f48b; last touched b55d628 (cluster-wide
  bootstrap serialization).
- chat-dm-safety-authority-core: packages/db/migrations/0030_chat_dm_safety_authority_core.sql exists on
  origin/main and contains `CREATE FUNCTION dm_safety_enabled`, `chat_pair_blocked`, `assert_dm_allowed`.
  Landed d5b31f9 (squash merge, 2026-08-10). Note it merged under DD-102, a conditional waiver — read
  that DD, it constrains what you may assume about assert_dm_allowed.

DO NOT simply flip the verdict. The packet was authored 2026-08-03 against AUTHORITY_SHA 90d292d and
several of its live-truth claims have since decayed. At minimum:

1. MIGRATION NUMBER — the manifest scope pins packages/db/migrations/0029_chat_schema_core.sql. 0029 is
   already taken by 0029_dd29_capability_registry_contract.sql, and the tail is now 0030. Re-derive with
   `ls packages/db/migrations/*.sql | sort | tail -3` and correct the scope entry. This exact trap has
   already fired once in this chain: the packet's own section 6 records that AP-45 guessed 0029 for
   itself and two unrelated DD-29 billing migrations consumed it. Do not guess again — derive.
2. The contract still states "migration tail 0027" and "no chat_* anywhere". Both are false now. Find
   every such claim and correct it against the live tree.
3. manifest base_sha is null. Pin it to the current origin/main tip, measured now.
4. manifest dep_checks is []. A level3-operational-v2 manifest requires ONE ENTRY PER DEPENDENCY binding
   the dependency's base, its landed SHA, and a slice-unique symbol — the readiness validator enforces
   this and the scope-gate rejects registration without it. Use the symbols named above; verify each
   resolves on origin/main, not just on disk.
5. HARD_DEPENDENCIES in the verdict block still reads NOT_MERGED, NOT_AUTHORED for both. Replace with the
   measured landed SHAs and probes.
6. CLOSURE_MATRIX is PARTIAL (10/12). Close the two open items or explain precisely why they cannot close;
   CODE_READY requires 12/12, G1-G5 all PASS, OPEN_QUESTIONS_IN_SCOPE 0, and no remaining blockers.
7. Flip the classification header from `<!-- review-readiness: enforce -->` to
   `<!-- review-readiness: code-ready -->` ONLY if strict CODE_READY is genuinely reached. If it is not,
   leave `enforce`, write NOT_CODE_READY with exact blockers, owners and binary resolutions, and stop.
   `pnpm review:check:changed` must be green before you finish either way — the validator rejects a
   code-ready document carrying a non-CODE_READY verdict.

Scope for this pass: docs/autopilot/contracts/autopilot-dd38-dd86-chat-schema-core.md,
docs/autopilot-manifests/dd38-dd86-chat-schema-core.json, docs/autopilot-backlog.md. Nothing else.
Commits are the owner's — report the diff, do not commit.

Terminate at READY | AWAIT | HALT.
```

## Bước 2 — thực thi (chỉ sau khi bước 1 đạt strict `CODE_READY` và owner đã commit)

```
/ap-45-dd38-dd86-chat-schema-core
```

## Ràng buộc còn hiệu lực khi bước 2 chạy

- **Serialize theo backlog.** `docs/autopilot-backlog.md` nằm trong scope của slice này và của AP-51,
  AP-52 — `SCOPE_COLLISION` bắn khi scope **hoặc** invariants giao với một feature đang active. Chỉ một
  slice register tại một thời điểm.
- **DD-102 KHÔNG chạm slice này.** ⚠️ Bản đầu của runbook viết *"slice này gọi `assert_dm_allowed`"* —
  **sai, đã sửa 2026-08-10 sau khi đọc DDL trực tiếp.** `dm_current_read_allowed()` gọi đúng hai hàm:
  `dm_safety_enabled()` và `chat_pair_blocked()`, cả hai một-statement, không dính hình dạng torn read
  bốn-statement mà DD-102 nói tới. `assert_dm_allowed()` — hàm duy nhất waiver đề cập — **không** được
  slice này gọi. Nên `chat-dm-safety-config-single-read` vẫn là precondition của **slice 7/8**, không phải
  của slice này, và DD-102 không mở open question nào ở đây. Dù vậy: đừng thêm caller mới nào của
  `assert_dm_allowed()` ngoài phạm vi đã đăng ký.
- **Thứ tự register là load-bearing.** `register` ép `HEAD == base_sha`. Tạo worktree ở base sạch,
  register, chứng minh `registered-manifest.sha256` tồn tại, *rồi* mới viết code.
