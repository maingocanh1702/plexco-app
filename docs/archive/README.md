# docs/archive — nội dung cứu khỏi worktree không được git bảo vệ

> Thư mục này **không phải authority**. Nó tồn tại để những thứ chưa từng được commit
> không biến mất. Source of truth vẫn theo `docs/00-start-here/HANDOFF.md` §7.

## Bối cảnh

Repo có ba thư mục dưới `.autopilot/worktrees/` từng là git worktree. Tính tới **2026-07-19**:

- `.git/worktrees/<name>` đã biến mất → chúng **không còn là git worktree**
  (`git -C <dir> status` trả `fatal: not a git repository`; `git worktree list` báo *prunable*)
- `.gitignore:56` có `.autopilot/*` → git **không nhìn thấy** nội dung bên trong
- ⇒ file nào chưa commit lên branch thì chỉ tồn tại dưới dạng file thường, một `rm -rf` là mất

`git worktree prune` **không** xoá mấy thư mục đó (prune chỉ dọn metadata vốn đã mất sẵn).
Muốn xoá phải `rm -rf` thủ công.

## Đã kiểm tra từng worktree

| Worktree | Base | Kết quả | Còn cần giữ? |
|---|---|---|---|
| `identity-link-security-core` | `21e42ea` | **27 file chưa commit** (26 sửa + `0014_identity_channel_security.sql`) | ✅ đã cứu → `identity-link-security-core-candidate-2026-07-19.patch` |
| `infra-egress-compatibility-evidence` | `260de3c` | **0 file** khác base — mọi thứ đã commit trên `feat/infra-egress-compatibility-evidence` | ❌ không, xoá được |
| `phase1-fable5` | `1eb6f60` | 0 file sửa; **3 file mới** chỉ có trong `.autopilot/phase1/` | ✅ đã cứu → `phase1-autopilot-run/` |

Cách kiểm (không đụng index, an toàn khi `.git/index.lock` đang kẹt):

```sh
git ls-tree -r <base> | awk '{print $3"\t"$4}' > /tmp/base.txt
# so từng blob hash với git hash-object trên file trong worktree
```

## Nội dung

### `identity-link-security-core-candidate-2026-07-19.patch`

Slice P0 security (identity/link/connector-secret) chưa từng được commit ở đâu.
Đã verify: apply lên `21e42ea` cho ra **byte-for-byte** đúng 27 file gốc.
Header trong patch ghi rõ 2 việc bắt buộc trước khi revive (đánh số lại migration vì
`0014` đã bị DD-45 chiếm; rebase vì base đã cũ). Bối cảnh vì sao candidate không thành
authority: `../session-docs-feature-updates-2026-07-17.md` §2.2.

### `phase1-autopilot-run/`

Ledger của đợt autopilot phase-1 — **không có bản nào khác trong repo** (`main` không có
`.autopilot/phase1/`):

- `DECISIONS.md` — log quyết định tự động theo slice (S0→S…), mỗi dòng *chọn gì + vì sao*.
  Giải thích nhiều lựa chọn nền tảng đang sống trong code: Next.js App Router cho `apps/web`,
  workspace consumed as TS source, `next typegen && tsc`, lý do `pnpm -w install` không dùng được.
- `PROGRESS.md` — trạng thái từng slice (INTEGRATED/BLOCKED) + lý do block và commit forensics
  (vd S2 `REGION_THRASH`, S2b `MAX_ROUNDS` → barrel export node-only `i18n` làm vỡ browser bundle).
- `codex-smoke.txt` — transcript smoke run, giữ để đối chiếu.

Không copy `.claude/settings.local.json` — config IDE cục bộ theo máy, không có giá trị lịch sử.
