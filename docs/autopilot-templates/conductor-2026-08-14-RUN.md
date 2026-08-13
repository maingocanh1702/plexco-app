# Conductor RUN — phiên tự chạy 5–6h · soạn 2026-08-14

> Base: `main` = `origin/main` = **`88eeb97`** (S2 `CreateSession` + E1 readiness-strict-keys đã merge; 0 worktree tồn đọng).
> Mode: `autonomous_to_ready` (DD-107). Owner **không** ra quyết định giữa chừng; review một lượt ở cuối.
> ⛔ **Không merge gì.** AUTO_MERGE off.

---

## Hình dạng phiên — hai pha, một session

Pha 1 author **cả ba** packet trước, pha 2 chỉ implement cái nào đạt `CODE_READY`.

```
         ┌── author P-A ──┐
base ────┼── author P-B ──┼──▶ báo cáo: cái nào CODE_READY?  (~1.5h)
         └── author P-C ──┘                    │
                                               ▼
         ┌── implement lane đạt ──┐
base ────┼── implement lane đạt ──┼──▶ N branch READY          (~3.5–4.5h)
         └── implement lane đạt ──┘
```

**Vì sao author cả ba TRƯỚC, không phải author-rồi-implement từng lane:** hai pass authoring gần nhất
**đều lòi blocker** — `chat-shared-message-command-core` ra `NOT_CODE_READY` (chặn sau hai slice chưa tồn
tại), `session-service-create-command-core` ra 4 blocker (3 tự giải bằng đọc repo, 1 phải hỏi owner → DD-105).
Base rate đó không thấp. Author trước cả ba thì một packet chết chỉ tốn ~30 phút; author-rồi-implement thì
nó nuốt cả budget implementation của lane.

---

## Roster

| Lane | Vùng file | Vì sao Tier C thấp |
|---|---|---|
| **L2** email/password bundle order-4 (DD-80) | `apps/web/app/api/auth/**` · `apps/web/lib/**` · `packages/db/src/auth.ts` | Schema `0016` đã merge và **0 production caller** — đấu dây, không thiết kế contract mới. Flag OFF ⇒ không chạm enablement |
| **L1** PublishSession + projector `public_sessions` đầu tiên | `packages/db/src/` (service/projector) · `apps/bot/src/dispatcher.ts` | Hợp đồng publish Reviewed; whitelist **15 cột** pin trong `0006` + **đã có invariant test canh**; action class `publish_new_sessions` đã có trong code; **không cần migration** |
| **L4** Session commands còn lại + narrow action class | `packages/db/src/session-service.ts` · billing spec | `DD-104 D2a` **chỉ đích danh** việc sửa contract billing ⇒ Tier A theo luật demote §6.1 |

**Đã loại khỏi roster: chat slice 7.** Packet của nó là `NOT_CODE_READY`, chặn bởi **hai slice không tồn
tại** — slice 4 `tenant-capability-authority-core` (backlog `idea`, `scope: []`, `manifest: null`) và slice 5
`chat-club-channel-lifecycle-core` (chưa có task). Đừng đưa lại vào.

---

## Prompt

```text
Read these first, in this order:
  docs/00-start-here/HANDOFF.md
  docs/standards/review-code-readiness-gate.md
  docs/autopilot-templates/level3-workflow.md — sections 4, 6.1, 7, 8, 9
  docs/autopilot-templates/next-lanes-2026-08-14-RUN.md — the lane roster and its Tier C reasoning

ROLE: you are a CONDUCTOR. You will run for 5-6 hours without asking the owner anything. You do
not write product code yourself. You spawn one sub-agent per lane, each with its own context,
and you integrate their terminal states.

AUTONOMY_MODE: autonomous_to_ready
CONDUCTOR_LEDGER: .autopilot/state/conductor-2026-08-14/DECISIONS.md
BASE: freeze origin/main at start. Record the SHA in the ledger. Every lane branches from THAT
      SHA. No lane reads another lane's output. Never move the base.

════════ PHASE 1 — AUTHOR ALL THREE PACKETS (target ~1.5h) ════════

Author, in parallel sub-agents, a task contract + authored manifest + backlog block for:
  A. email-password-bundle-order-4        (DD-80; schema 0016 already merged, zero callers)
  B. session-publish-public-projector     (PublishSession + the first real public_sessions projector)
  C. session-commands-update-close-cancel (+ narrow per-op action class, DD-104 D2a)

Each packet ends at strict CODE_READY **or** an honest NOT_CODE_READY with named binary blockers.
Do not force CODE_READY. A packet that cannot honestly reach it is a successful phase-1 outcome —
it saved the implementation budget it would otherwise have burned.

Authoring needs no codex round. Do not queue reviews in this phase.

SERIALIZE: all three packets append to docs/autopilot-backlog.md. Let the sub-agents write their
contract and manifest in parallel, then YOU make the backlog edits yourself, one at a time, at the
end of phase 1. Do not let three sub-agents write that file.

PHASE 1 GATE — report before starting phase 2: for each packet, the verdict, and for any
NOT_CODE_READY the exact blockers. Then implement ONLY the CODE_READY ones.

════════ PHASE 2 — IMPLEMENT (target ~3.5-4.5h) ════════

One worktree per lane, branched from the frozen base. Register through
scripts/autopilot-scope-gate, then VERIFY .autopilot/state/<feature>/registered-manifest.sha256
exists before doing anything else — "registered" printed on stdout is not proof.

════════ RULES THAT APPLY TO BOTH PHASES ════════

CONTEXT — this is what kills a long session, not quota:
- Never load a lane's working context into your own. Read only the sub-agent's terminal report
  and its ledger path.
- If your own context passes ~60%, stop starting new lanes, finish integrating, report. A
  conductor that compacts loses the frozen base and the roster; that is lost bookkeeping, not a
  retry.

DECISION AUTHORITY — section 6.1 tiers apply to you AND every sub-agent:
- Tier A (derivable from repo/spec/precedent): decide, log one line, never stop. Stopping here is
  itself a defect — record it as one.
- Tier B (judgment, reversible, in scope): decide, log alternatives + reasoning + evidence read.
- Tier C (the 8 items): park THAT lane with a written note and move on. A Tier C item costs one
  lane, never the session. Report all parked items together at the end.
- Every decision needs the `Searched:` field: the exact queries you ran over docs/ and packages/,
  including the ones that returned nothing. A null result is evidence about the query — verify it
  with a known-present control before trusting it.

REVIEW — parallel is ALLOWED this session:
- Owner confirmed 2026-08-14 that codex quota covers this session plus the concurrent
  readiness-evidence-strict-keys lane. Quota is not the binding constraint today, so lanes do not
  need to queue.
- Parallel review is also SAFE now: pointer contamination between rounds was closed by the
  ephemeral detached-worktree isolation fix. Each round reviews its own frozen checkout.
- One exception, and it is about margin rather than quota: do NOT start a fresh review while
  another lane sits at fix-round 4 or higher. If anything throttles or times out mid-round, the
  lane closest to its ceiling is the one that pays, and an infra failure at 4/5 is easy to
  misread as a real round.
- --base is the lane's pinned base_sha, the same value every round. Never HEAD^.
- Commit before invoking; the change set under review is committed history.
- If codex does become unreachable, that is a WAIT, not a downgrade. Never self-certify.

FIX ROUNDS vs INFRA:
- A round that fails for infrastructure reasons (DB role race, container flake, quota) is NOT a
  fix round and must not consume a lane's budget. Record it as `round-NN infra:<reason>` in that
  lane's regions log, and only when the diff is unchanged from the previous round. The
  session-service lane did exactly this for a JCL-1 cluster-global role race; follow that precedent.
- Real fix rounds still cap at 5. On HALT MAX_ROUNDS, a successor is pre-authorized ONLY if the
  findings are accepted AND you can name a DESIGN cause. "Try again harder" is not a design cause.

READINESS EVIDENCE:
- Write the MINIMAL readiness.json resolved from
  docs/autopilot-manifests/_READINESS_EVIDENCE_TEMPLATE.json — identity, acceptance state, breaker
  state, nothing else. Once the readiness-evidence-strict-keys lane merges, the gate fails closed on
  any key outside the whitelist, top level and nested. Adding a helpful-looking `notes` field is a
  halt, not a courtesy. This is intended; do not work around it.

ROOT COMMITS:
- Any commit to main from the root working copy needs
  scripts/autopilot-root-lock acquire --owner <label>, export PLEXCO_COMMIT_OWNER, explicit paths,
  then release. Never `git commit -a`, never a bare `git commit`. A pre-commit hook enforces this
  and it exists because eba1c27 landed one session's files under another session's message.
- Work inside a feature worktree does not need it.

DO NOT TOUCH:
- Any FE work — DD-81 / M0.3 / M4 are PENDING by owner order 2026-08-13. No .pen tracking, no
  page/component, no docs/channels/web/**.
- chat slice 7 — its packet is NOT_CODE_READY behind two slices that do not exist.
- OUTBOX_DISPATCH_SCHEDULE_ENABLED and GOOGLE_OAUTH_* — enablement is Tier C.
- `autopilot-update.sh` — blocked by DD-108 until the canonical trust-gate mirror lands. Running it
  would silently revert the hardened readiness gate, and no test would go red.

DD-106 WAS RESOLVED ON 2026-08-14 — read the ruling, not the old 🟡 labels:
- Q1 Pay-for-Buddy: the enum value `payment_allocations.source='buddy'` is **REJECTED**, not merely
  deferred. `created_by` already exists (0003:87) and the CHECK already permits
  ('cash'|'waiver') + created_by NOT NULL (0003:92), so "A paid for B's charge" is expressible today
  as ('cash', created_by=A). Do not add the enum value. Do not build the buddy workflow either — it
  is deferred behind DD-40 manual mark-paid.
- Q2 chat embed columns: deferred with a BINARY unblock condition — `public_projection_fences` +
  guarded view + narrow raise/CAS-clear must be merged first. Until then, adding
  `chat_messages.embed_*` duplicates a known un-invalidated projection. Do not add those columns.
- Q3 unified SessionCard: direction ACCEPTED. Canonical shape lives in
  `docs/features/FE/feature_marketplace_discovery.md` §3; other specs reference it rather than
  redefining. It is NOT yet a contract — do not freeze it until a surface actually renders it. If
  lane L1 renders session data, this is the shape to follow.

SESSION STOP CONDITIONS (as distinct from a single lane's):
- your own context near exhaustion;
- codex unreachable for more than one backoff cycle;
- two lanes parked on Tier C — the roster was mis-chosen, say so plainly.

DELIVERABLE:
- Phase 1: three packets, each CODE_READY or honestly NOT_CODE_READY with named blockers.
- Phase 2: one branch per implemented lane at READY, each with gate-result.json and its ledger.
- One conductor summary: what reached READY, what parked and why, every Tier C item awaiting the
  owner, and the exact merge order. Merge order matters: every db lane appends an export block to
  packages/db/src/index.ts, and those touch at merge time, not at build time.

Do NOT merge. Do NOT push to main. AUTO_MERGE stays off.
```

---

## Trước khi bấm chạy — kiểm 2026-08-14

| # | Kiểm | Kết quả |
|---|---|---|
| 1 | Postgres + `DATABASE_URL_TEST` | ⬜ **owner tự kiểm** — sandbox không có `psql`. `pg_isready -h localhost -p 5432 && echo "$DATABASE_URL_TEST"` |
| 2 | E1 đã merge? | ✅ **Rồi** — squash `a3c62ad`. Lane đóng ở **4 fix-round (< 5)**, code r5 CLEAN + security r2 CLEAN |
| 3 | Codex quota | ✅ **Owner xác nhận 14/08.** Luật queue đã gỡ (xem §Review); giờ cũng không còn lane nào chạy song song |
| 4 | Teardown worktree | ✅ **Xong** — `88eeb97`, **0 worktree** tồn đọng |

### Hai thứ E1 vừa đổi, ảnh hưởng trực tiếp phiên này

**a) Luật `readiness.json` minimal nay có hiệu lực THẬT.** Gate fail-closed trên mọi key ngoài whitelist,
cả top-level lẫn trong `acceptance`/`breakers`, halt riêng `EVIDENCE_UNKNOWN_KEY` kiểm **trước** check
identity. Sub-agent thêm một trường `notes` "cho dễ đọc" là halt, không phải nhắc nhở.

**b) Validator layer 17 → 30 test** (`check-review-readiness` 13 + `ephemeral-review-worktree` 17). Lane nào
báo cáo số test phải dùng mốc mới, nếu không lần full-run kế tiếp bị đọc thành drift.

### 🔴 Nợ P1 chưa đóng — không chặn phiên, nhưng đừng để trôi

Canonical kit **vẫn mang bản validator cũ** non-fail-closed, và **cả hai kit cùng `KIT_VERSION: 31`** — nên
một lần `autopilot-update.sh` sẽ âm thầm revert E1 **mà không có tín hiệu version nào** để ai đó nhận ra, và
không test nào đỏ vì test bị ghi đè cùng lúc. `SessionStart` hook chỉ auto-overwrite `scope-gate` nên `main`
Plexco đứng một mình vẫn an toàn; rủi ro chỉ kích hoạt khi chạy update. Mirror phải làm **đủ ba vế**: copy 2
file · thêm dòng `pack_pairs()` cho module mới · **bump `KIT_VERSION`**. Thiếu vế ba là tái tạo đúng cái mù
vừa phát hiện. Xem `next-lanes-2026-08-14-RUN.md` → E1b.

---

_Soạn 2026-08-14, cập nhật tại `main@88eeb97`. Số/SHA là claim lúc soạn — conductor phải tự verify lại ở bước freeze base._
