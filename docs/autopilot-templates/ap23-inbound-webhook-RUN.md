# AP-23 — owner pre-launch runbook · `infra-inbound-webhook-auth-evidence`

> **Model:** `claude-fable-5` · **Framework:** canonical `autopilot-prompt-GENERIC` v0.6.0
> **Slice:** P2 docs-only · `manual_only` · 1× FULL-base Codex clean round · STOP_AT_READY
> **Manifest:** `docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json`
> **Task contract:** `docs/autopilot-infra-inbound-webhook-auth-evidence.md`
> **Launcher:** `.claude/commands/ap-23-infra-inbound-webhook-auth-evidence.md`
> **Soạn:** 2026-07-22 · base `main@6a28072`
>
> Kế thừa dispatcher `phase1-fable5-7h-PR-RUN.md` §2/§4 (file đó chọn slice egress AP-22; file này chọn
> AP-23). Ngôn ngữ: giải thích tiếng Việt, block paste terminal tiếng Anh.

---

## 0. Vì sao AP-23 là slice duy nhất launch được lúc này

Session `db-migration-0000-idempotent-role-create` đang in-flight và **giữ 2 invariant: `schema` +
`build-config`**. Luật `scripts/autopilot-scope-gate`: song song ⟺ `scope` file rời nhau **và**
`invariants` rời nhau **và** không `depends_on` cái chưa merge.

| Slice | invariants | Song song với slice đang chạy? |
|---|---|---|
| `infra-inbound-webhook-auth-evidence` (AP-23) | `api-contract` | **✅ được** — đây là lựa chọn |
| `core-matcher-grouped-amount-parsing` (AP-29) | `money-model`, `shared-core` | ✅ invariant rời, **nhưng** `NOT_CODE_READY` (Verdict 15) tới khi authority packet DD-87 được commit/push |
| `infra-provider-limits-evidence` (AP-24) | `build-config` | ⛔ SCOPE_COLLISION |
| `infra-egress-compatibility-evidence` (AP-22) | `build-config` | ⛔ SCOPE_COLLISION (và đụng cả AP-24) |
| `docs-session-management-acceptance-checklist` (AP-25) | `schema` | ⛔ SCOPE_COLLISION |

Ba invariant set `{schema,build-config}` · `{api-contract}` · `{money-model,shared-core}` rời nhau hoàn
toàn ⇒ khi packet DD-87 đã lên `origin/main`, **ba slice chạy song song được cùng lúc**.

Thứ tự sau khi slice hiện tại merge + `cleanup`: **AP-24 → AP-22 → AP-25** (AP-24 và AP-22 share
`build-config` nên phải tuần tự với nhau).

---

## 1. ⛔ Ba blocker phải xử lý TRƯỚC khi chạy §2

Cả ba đã verify on-disk tại `main@6a28072` ngày 2026-07-22. Preflight §2 sẽ fail nếu bỏ qua.

### B1 — Reservation cũ chưa dọn sẽ làm `register` HALT

`.autopilot/INFLIGHT.md` còn block:

```
## feature: auth-s4-d0-session-web-boundary
status: in-flight
invariants:
- auth
- api-contract
```

Nhưng D0b **đã merge 2026-07-22 (`93c5404`)** — backlog ghi `status: merged`. Registry chưa được
`cleanup`. `active_others()` trong scope-gate coi mọi block `in-flight|ready` là ACTIVE, nên
`api-contract` của block chết này **va thẳng vào invariant duy nhất của AP-23** ⇒
`HALT SCOPE_COLLISION`.

Đây là stale state, không phải collision thật. Dọn bằng:

```bash
scripts/autopilot-scope-gate cleanup --feature auth-s4-d0-session-web-boundary
```

Kiểm tra lại registry sau khi dọn: chỉ còn đúng `db-migration-0000-idempotent-role-create` ở trạng
thái `in-flight`. Block `auth-s4-d0-revoke-core` có `status: merged (...)` nên không tính là ACTIVE —
để nguyên cũng được, dọn cũng được.

### B2 — Working tree không sạch

Preflight có `test -z "$(git status --porcelain)"`. Trạng thái lúc cập nhật (2026-07-22 22:44):

```
 M docs/auth-s4-session-handoff.md
 M docs/autopilot-backlog.md
 M docs/autopilot-manifests/core-matcher-grouped-amount-parsing.json
 M docs/autopilot-manifests/db-migration-0000-idempotent-role-create.json
 M docs/slice-readiness-verdicts.md
 M docs/standards/decisions.md
?? .claude/commands/ap-29-core-split-name-amount-ambiguity-contract.md
?? design.pen
?? docs/autopilot-core-split-name-amount-ambiguity-contract.md
?? docs/autopilot-templates/ap23-inbound-webhook-RUN.md
?? docs/dd-87-splitnameamount-decision-table-analysis.md
```

Phần lớn là **authority packet DD-87 + amendment Verdict 14** — chính là `HARD_DEPENDENCIES` mà
Verdict 15 đang chờ. Commit/push nhóm này vừa dọn tree cho AP-23 vừa gỡ blocker AP-29, một công đôi
việc. Riêng `design.pen` cần **owner quyết** riêng: DD-81 chốt tên design file là
`plexco-app-design.pen` — tên khác, nên xác nhận là file thật hay đặt nhầm/rác trước khi commit hoặc
`.gitignore`.

### B3 — Có git operation đang chạy

`.git/index.lock` tồn tại lúc soạn file này (session đang chạy đang thao tác git). Không chạy bất kỳ
lệnh git ghi nào khi lock còn — đợi nó biến mất rồi mới vào §2.

---

## 2. Preflight + tạo worktree (chạy từ repo root, sau khi §1 xong)

```bash
set -euo pipefail
cd "/Users/maingocanh/Projects/Plexco app"

git fetch origin
test "$(git branch --show-current)" = "main"
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"

# artifacts phải có mặt trên origin/main, không chỉ trên đĩa
test -f docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json
test -f docs/autopilot-infra-inbound-webhook-auth-evidence.md
test -f .claude/commands/ap-23-infra-inbound-webhook-auth-evidence.md
git show origin/main:docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json >/dev/null
git show origin/main:docs/autopilot-infra-inbound-webhook-auth-evidence.md >/dev/null
git show origin/main:.claude/commands/ap-23-infra-inbound-webhook-auth-evidence.md >/dev/null

scripts/autopilot-backlog-reconcile --check
test ! -e .autopilot/worktrees/infra-inbound-webhook-auth-evidence
test -z "$(git branch --list feat/infra-inbound-webhook-auth-evidence)"

# target file CHƯA tồn tại — nếu có rồi nghĩa là slice đã chạy, dừng lại điều tra
test ! -e docs/standards/webhook-verification-matrix.md

scripts/autopilot-scope-gate register \
  --manifest docs/autopilot-manifests/infra-inbound-webhook-auth-evidence.json
git worktree add .autopilot/worktrees/infra-inbound-webhook-auth-evidence \
  -b feat/infra-inbound-webhook-auth-evidence main
test "$(git -C .autopilot/worktrees/infra-inbound-webhook-auth-evidence rev-parse HEAD)" = \
     "$(git rev-parse main)"
```

Bất kỳ dòng nào fail ⇒ **dừng**. Không xoá branch/worktree, không stash, không dọn repo, không
release reservation kiểu đoán mò, và **không thay bằng slice khác** — soạn handoff mới.

---

## 3. Mở session

Mở Claude Code với process cwd đặt đúng vào worktree (không mở từ repo root):

```text
/Users/maingocanh/Projects/Plexco app/.autopilot/worktrees/infra-inbound-webhook-auth-evidence
```

Chọn `claude-fable-5`, gọi `/ap-23-infra-inbound-webhook-auth-evidence`. Không paste dispatcher
lịch sử (`phase1-fable5-RUN.md`, `phase1-fable5-orchestrator.md` — cấm chạy).

---

## 4. Kỳ vọng đầu ra (kiểm khi review)

Slice tạo **đúng một file**: `docs/standards/webhook-verification-matrix.md`, 4 hàng — SePay,
ApiPay, Zalo Bot, Meta Messenger. Mỗi hàng cần: surface + header chữ ký · thuật toán (họ HMAC/hash,
ký **raw body** hay parsed, timestamp/nonce + replay window, có bắt buộc timing-safe compare không)
với giá trị `SPECIFIED|PARTIAL|UNRESOLVED` · nguồn chính thức (title/URL) · ngày kiểm · một câu giải
thích vì sao nguồn đó chứng minh kết luận.

Kết cục xác định, không được rơi tự do:

| Trạng thái bằng chứng | Kết quả bắt buộc trong doc |
|---|---|
| 4 hàng attributable, tất cả `SPECIFIED` | `Overall result: WEBHOOK_AUTH_CONTRACT_COMPLETE` |
| 4 hàng attributable, có `PARTIAL` (ghi rõ gap, không bịa) | `Overall result: WEBHOOK_AUTH_CONTRACT_PARTIAL` |
| Bất kỳ hàng nào thiếu/mơ hồ/cũ/chỉ suy diễn | `HALT-EVIDENCE_INCOMPLETE`, **không** có overall result/marker |

Marker `<!-- WEBHOOK_AUTH_EVIDENCE_CLOSED -->` chỉ được thêm ở hai kết cục đầu, ngay dưới bảng. Marker
chứng minh **bằng chứng đủ**, KHÔNG phải authorize viết adapter — code webhook vẫn P0/manual.

Verify:

```bash
pnpm exec prettier --check docs/standards/webhook-verification-matrix.md
git diff --check
git diff --stat main...HEAD    # phải đúng 1 file, non-empty
```

Bẫy hay gặp cần soi khi review: lấy yêu cầu **outbound source-IP** (đó là AP-22, chiều ngược lại) rồi
kết luận cho inbound; đóng hàng bằng search snippet/community post thay vì doc chính thức; coi
"documentation im lặng" là `SPECIFIED`; ghi giá trị secret thật vào doc (tuyệt đối cấm).

---

## 5. Kết thúc

Sau verify: chạy `scripts/autopilot-scope-gate ready --manifest ...`, giữ nguyên branch/worktree,
**STOP_AT_READY**. Không merge, không sang task thứ hai, không viết adapter code. Owner merge tay,
verify trên `origin/main`, rồi `scripts/autopilot-scope-gate cleanup` trước khi mở slice kế (AP-24).
