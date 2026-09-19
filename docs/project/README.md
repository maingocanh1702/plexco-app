# `docs/project/` — tầng Project của Plexco

> Ba file, một script, một nhịp tuần. Đề xuất đầy đủ: Project Cowork `claude/pm-method-proposal-2026-09-19.md`.
> Nguyên tắc: **cái gì máy đo được thì máy đo; cái gì là phán đoán thì owner đặt, có ngày.**

| File | Ai sửa | Là gì |
|---|---|---|
| `modules.json` | **máy** (`axes`) + **owner** (`health` · `health_note` · `blocked_by` · `next` · `lane` · `last_moved`) | Nguồn sự thật của 25 module. `ROADMAP.md` §Module Progress được **sinh** từ đây — đừng sửa bảng đó tay. |
| `decisions-inbox.json` | owner | Mọi quyết định owner chưa ra, một chỗ. Có `default` và quá **21 ngày** ⇒ update tuần kế áp mặc định, trừ khi owner đổi thành `paused` có tên. |
| `board.html` | **máy** | Bảng theo dõi một màn: hai thanh headline · phase → module · inbox · làn. Sinh ra, commit cùng re-pin; bản trên claude.ai chỉ là publish của file này. |

```bash
node tools/progress.mjs            # số cấu trúc, carry check của pin, thanh delivery group, ap3, 7 ngày
node tools/progress.mjs --phases   # phase → module · 7 track · hai thanh headline
node tools/progress.mjs --render   # ghi lại bảng Module Progress trong ROADMAP + docs/project/board.html
node tools/progress.mjs --json     # tất cả, dạng máy đọc
```

## Từ vựng (enum — không chữ tự do)

**Trục** (`axes.migration|be|fe|tests`, máy suy, chỉ đổi khi code lên `main`):

| Giá trị | Nghĩa | Emoji cũ | Điểm |
|---|---|---|---|
| `done` | merged, bật, có surface gọi tới | ✅ | 1 |
| `merged_not_enabled` | merged, tắt bằng flag/env/schedule — việc kế là **quyết định bật** | 🟢 | ½ |
| `merged_dark` | merged, **0 caller production** — việc kế là **wire caller** | 🟢 | ½ |
| `partial` | một phần đã land | 🟡 | ½ |
| `not_started` | chưa có gì trên main | ⬜ | 0 |
| `blocked_external` | chờ thứ ngoài repo | ⛔ | 0 |
| `n/a` | trục không áp dụng | — | bỏ khỏi mẫu số |

**Health** (owner đặt mỗi tuần, kèm `health_note` một dòng): `on_track` có slice chạy/xếp, không chờ ai · `at_risk` review/gate lặp > 2 vòng hoặc dependency sắp trễ · `blocked` chờ một thứ có tên trong `blocked_by` · `paused` owner chủ động hoãn — **khác** blocked: không ai cần làm gì.

**Lane**: `level3` (supervised) · `ap3` (headless) · `owner` (việc tay) · `external` (ngoài repo).

## Hai thanh headline — vì sao hai

- **BE readiness cho phase-1** = trung bình (Migration · BE · Tests) của 20 module phase-1. Nhích mỗi khi một lane BE land. **Đây là thứ đang thật sự tiến.**
- **Launch readiness** = trục yếu nhất (luật 5) của 6 module thuộc 5 khối launch DD-113. Chỉ nhích khi FE nhích. Đứng yên = cái giá của O1, nói thẳng.
- Thanh `~33%` của ROADMAP là thang thứ ba (slice roadmap), giữ tay, trích nguyên văn — không tính lại.

`phase1` suy từ cột Phase + DD-114 (P0–P5, trừ discovery/chat). `launch_block` suy từ DD-113 D2 + bảng M0–M11 của BRD — **owner sửa được**, giống ô 🟡 trong BRD.

## Nhịp tuần (thứ Hai, 15 phút)

1. Digest tự động chạy `--phases` + `--render`, dựng nháp update theo khung cố định.
2. Owner đặt `health` cho module đang đụng (sửa JSON, một dòng mỗi module).
3. Owner trả lời hoặc `paused` các mục inbox quá hạn.
4. Commit `modules.json` + `decisions-inbox.json` + `board.html` + `ROADMAP.md` (bảng sinh) trong một commit `docs(project): W<nn>`.

Khung update (cố định để so tuần này với tuần trước):

```
Pin · gate · BE readiness · Launch readiness
Health: on_track n · at_risk n · blocked n · paused n
Đã đổi (trục yếu nhất nhích): …
Chặn / cần quyết (từ inbox, quá hạn trước): …
Cycle goal (2 tuần): …
Làn: level3 · ap3 · owner · external
```
