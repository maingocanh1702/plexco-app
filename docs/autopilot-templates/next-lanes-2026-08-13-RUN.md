# Next lanes — soạn 2026-08-13 · base `main` = `775cb9e`

> Kế nhiệm `next-lanes-2026-08-11-RUN.md` (lane A đã chạy — `37c6f8b`; lane C: nợ 1 merged `0032`,
> nợ 2 authored blocked-by-design AP-54; lane B phần nặng đã land — launcher fix `7f5a886`,
> reviewer-isolation `b53bc75`/`2d5834b`).
>
> ⛔ **FE PENDING theo lệnh owner 13/08:** DD-81 / M0.3 / M4 và mọi việc FE **treo lại** — không chạy
> lane D cũ, không track `.pen`, không mở page/component. Chỉ chạy các lane dưới đây.
>
> **Serialize:** S1 và C7 đều ghi `docs/autopilot-backlog.md` → chạy lần lượt, không song song.
> S2 chỉ mở sau khi S1 flip strict `CODE_READY`. Codex đang bận repo bot (đo 13/08) — S1/C7 là
> authoring docs-only, không cần codex; S2 cần codex rảnh.

---

## Thứ tự và vì sao

**S1 trước** — nó mở đường M2 (Session BE vertical), critical path sản phẩm, và 3/4 blocker chỉ là
read-and-pin. **C7 sau S1** — chat slice 7 đã hết precondition (DD-102 điều kiện cứng thoả tại
`80a3464`) nhưng xếp sau vì Session là node thấp nhất chưa build. **S2** khi codex rảnh. **B-rest**
(P2/P3 kit friction còn lại: `classifier-blocks-kit-mandated-readiness-json`,
`codex-review-verdict-nondeterminism` phần chưa đóng, `test-harness-acquire-chat-definer-lock-leaks-client-on-error`)
không chặn ai — nhét xen kẽ khi chờ review.

---

## S1 — Flip session packet lên CODE_READY (authoring, docs-only, không cần codex)

```text
Read docs/00-start-here/HANDOFF.md and docs/standards/review-code-readiness-gate.md first.

OUTCOME: resolve the four named blockers B1-B4 in
docs/autopilot/contracts/autopilot-session-service-create-command-core.md §7 and flip the packet to
strict CODE_READY (closure matrix 12/12, acceptance matrix enumerated, marker changed from enforce to
code-ready). This is an AUTHORING pass — do NOT write service code, do NOT register, no worktree.

The packet + authored manifest + backlog block already exist (committed 2026-08-13). Do not re-author
them from scratch; amend in place.

B1 (G4): extract the slice-local acceptance matrix. Source rows: create-related items of
  docs/issues/session-management-acceptance-checklist.md v1.2 — but its sources are STALE (P v2.17 /
  T v2.18a; current: FE v2.25 / BE v2.22 after the DD-104 strip + invite-friend pass). Re-trace every
  row you use against the CURRENT files; prove the create rows survived both passes rather than
  assuming. Add dedup-replay, outbox-exactly-once, and cross-tenant-invisibility assertions.
B2 (G5): pin the service module home. Proposal packages/db/src/session-service.ts (precedent: auth.ts
  in the same package). Read docs/product/TDD.md §3.2 — if it names a service-layer location, use it;
  otherwise record the precedent WITH the TDD line you checked.
B3 (G3): pin the outbox PRODUCER insert contract. outbox_agg_seq_uq demands per-aggregate monotonic
  sequence; 0022/0023 authored only the consumer side (claim/lease/ack). Read
  docs/autopilot/contracts/autopilot-db-job-claim-lease-core.md + the 0022 migration header and write
  the exact insert shape (sequence derivation included) into contract §2 step 6. This slice is the
  FIRST producer — if no helper exists, the slice defines it and says so.
B4 (G1): the suspension-gate decision. Billing matrix row 'Admin mutation | suspended: blocked'
  exists with NO action-class literal for create (only publish_new_sessions). Present the owner the
  binary from contract §7: (a) narrow class in the billing contract first (DD-104 D2a precedent) and
  add that docs slice as a hard dependency, or (b) pin create-draft as ungated with written rationale
  in decisions.md (drafts are invisible; publish is the gated boundary). Record the answer in
  decisions.md before flipping. Do NOT decide it silently inside the contract.

Then: closure matrix 12/12 in the contract, verdict block CODE_READY with pinned SHA, marker
<!-- review-readiness: code-ready -->, backlog _readiness flip, pnpm review:check:changed MUST pass.
Commit via scripts/autopilot-root-lock (shared working copy). Deliverable: one docs commit.
```

## S2 — Implement `session-service-create-command-core` (cần codex rảnh, sau S1)

```text
Precondition: S1 flipped the packet to strict CODE_READY on origin/main, and
scripts/codex-review-pin.sh can reach its reviewer (an account-wide codex saturation means WAIT, not
skip — HALT TOOL_UNAVAILABLE if unreachable mid-run).

Follow docs/autopilot-ONBOARDING.md Level 3 flow exactly: hand-write the runtime manifest from
docs/autopilot-manifests/_TEMPLATE.json (the authored contract at
docs/autopilot-manifests/session-service-create-command-core.json is NOT the runtime manifest and
must NOT gain manifest_schema_version), register via scripts/autopilot-scope-gate register --manifest
.autopilot/state/<feature>/manifest.json, then VERIFY .autopilot/state/<feature>/registered-manifest.sha256
exists before doing anything else.

Build per the contract: one transaction — dedup lookup, validation subset (edges 1/2/7), tenantRepo
insert, session.created outbox row (payload session_id/tenant_id/visibility), processed_commands
result. Budget 300 LOC / 3 modules. Real-PG tests via DATABASE_URL_TEST. Two clean codex rounds.
STOP if the diff grows a migration, a route, or a billing file.
```

## C7 — Author packet chat slice 7 `chat-shared-message-command-core` (authoring, sau S1)

```text
Read docs/00-start-here/HANDOFF.md and docs/standards/review-code-readiness-gate.md first.

OUTCOME: author the packet (task contract + authored manifest + backlog block) for chat slice 7,
chat-shared-message-command-core, and end at strict CODE_READY or an honest NOT_CODE_READY with named
binary blockers. AUTHORING pass — no code, no register, no worktree.

Preconditions to VERIFY yourself, not inherit:
  - DD-102's hard condition is CLOSED: 0032_chat_dm_safety_config_single_read is merged
    (main@80a3464) and decisions.md v2.25 records the obligation as completed. Slice 7 was the
    exact slice that condition protected.
  - Slice 7's definition lives in the primary plan
    (docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md, PLAN_READY v1.8 at
    90d292d) — re-read its slice graph rather than trusting this prompt's naming.
  - The DB substrate it writes against: 0031 chat schema (channels/members/messages), 0030+0032 DM
    safety functions. Person-merge re-parent is BLOCKED separately (AP-54) — slice 7 must not touch
    person_id/dm_key semantics.

Serialization: shares docs/autopilot-backlog.md with S1 — run after S1 lands. If slice 7 needs a
migration, note it serializes against any other migration-writing lane on the tail number.
```

## B-rest — kit friction còn lại (P2/P3, nhét xen kẽ)

Ba mục còn mở sau đợt 11–13/08, đều có block sẵn trong `docs/autopilot-backlog.md` — đọc block trước,
đừng tin title: `classifier-blocks-kit-mandated-readiness-json` (idea) ·
`codex-review-verdict-nondeterminism` (phần unanimity-of-M đang HOLD chờ re-measure `3bf8ec1`) ·
`test-harness-acquire-chat-definer-lock-leaks-client-on-error` (idea, mở 13/08). Không cái nào chặn
S/C — chỉ chạy khi rảnh review-wait.
