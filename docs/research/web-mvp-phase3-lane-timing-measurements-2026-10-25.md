# Phase 3 (Web MVP): số đo thời gian lane, orchestrator, usage limit và sự cố

Status: bản ghi số đo làm đầu vào cho kế hoạch Phase 4 (lane L38). Không phải quyết định, không phải readiness verdict, không cho phép code. File này không chứa ước lượng Phase 4: người viết kế hoạch tự suy ra từ các số bên dưới.
Đo ngày 2026-10-25 tại `origin/main` `7b31d1fe0f5e25c08d554cb191032596204fe2ed` (merge của PR #113). Phạm vi: PR #58-#113, từ 2026-10-16 đến 2026-10-25.

## 1. Phương pháp

- Số theo PR: `gh pr list --repo maingocanh1702/plexco-app --state merged --limit 150 --json number,headRefName,title,createdAt,mergedAt,changedFiles,additions,deletions,files`, chạy 2026-10-25; giờ là UTC (hậu tố Z). Loại PR suy từ đường dẫn file: `docs-only` = mọi path dưới `docs/` hoặc là `*.md`; `code+migration` = có path dưới `packages/db/migrations/`; còn lại là `code`. Bảng từng PR tái tạo được bằng lệnh này nên file chỉ giữ tóm tắt.
- Số từ hồ sơ chương trình ghi dạng `status/<file>:<dòng> (hồ sơ chương trình local, ngoài repo)`: các file đó nằm ngoài git, nên file này là bản lưu bền vững của các số đó. Nơi nào chỉ ghi `<file>:<dòng>` thì ý nghĩa như vậy. Giờ local là Asia/Saigon (+07) trừ khi ghi UTC.
- "tính ở đây" = số do người đo tự tính từ số nguồn, kèm công thức; số không có nhãn là nguyên văn nguồn; "cận dưới" = chính nguồn nói đó là số thấp nhất.
- Giờ merge dùng `mergedAt` của gh. Ở 3 lane đối chiếu được (L28, L18, L26) hồ sơ local ghi giờ merge muộn hơn gh 5 đến 11 phút; ở L31 (#108) hai nguồn trùng nhau (hồ sơ local 10:14 tại `status/P3-S16-SUMMARY.md:39`, gh 10:14:57). Khi hai số khác nhau, mục 4 ghi cả hai.

## 2. PR #58-#113 (gh; trung vị và tổng tính ở đây)

Khoảng này có 56 số PR, 55 đã merge; #75 ("chore(kit): sync the Level 3 mechanism pack to KIT_VERSION 42") đóng không merge nên không được tính.

| Loại PR | Số PR | Giờ mở→merge: min / trung vị / max | File (trung vị) | Additions (trung vị) | Deletions (trung vị) |
| --- | --- | --- | --- | --- | --- |
| code | 30 | 0.1 / 0.2 / 4.9 | 8.5 | 665 | 23 |
| code+migration | 16 | 0.2 / 0.7 / 6.2 | 24.5 | 2713 | 99.5 |
| docs-only | 9 | 0.2 / 0.2 / 5.1 | 4 | 455 | 9 |
| Tất cả | 55 | 0.1 / 0.3 / 6.2 | | tổng 90936 | tổng 3876 |

- **Giờ mở→merge (`mergedAt` trừ `createdAt`) KHÔNG phải thời lượng lane.** Lane làm việc trước khi PR được mở; số này chỉ đo từ lúc PR mở đến lúc merge. Thời lượng lane xem mục 4.
- Hai chế độ: #58-#74 (17 PR, 10-16 đến 10-18) mở→merge 0.6-6.2 giờ; từ #76 (38 PR) mọi PR 0.1-0.9 giờ, trung vị 0.2. Các nguồn đã đọc chỉ nêu nguyên nhân cho #72: khoảng 9 giờ không có CI vì billing GitHub Actions (`status/RUN-SUMMARY.md:272-274`, hồ sơ chương trình local, ngoài repo).
- Merge theo ngày UTC: 10-16 10 · 10-17 6 · 10-18 2 · 10-19 8 · 10-20 7 · 10-21 5 · 10-22 9 · 10-23 2 · 10-24 5 · 10-25 1; tổng 55 trên 10 ngày lịch = 5.5 PR mỗi ngày (tính ở đây).
- 16 PR có path dưới `packages/db/migrations/` (loại `code+migration`): #64 · #66 · #68 · #70 · #71 · #72 · #76 · #83 · #84 · #87 · #90 · #96 · #97 · #101 · #106 · #111.

## 3. Orchestrator run theo phiên và lane

Nguồn: `status/RUN-SUMMARY.md:229-253` (mục 7.1), `status/P3-S16-SUMMARY.md:60-79,191`, `status/P3-S16-carry-forward.md:86,95` (hồ sơ chương trình local, ngoài repo).

- S1-S14: 66 run trên 19 hàng có run = 3.47 run mỗi hàng (tính ở đây). Từng hàng: S1 2 · S2 3 · S3 3 · S4 1 · S5 2 · S6 1 · S7 2 · P3-CI 0 · S8 3 · S9 9 (L11) · S10 4 · S11 5 (L14, 46 worker result) · S12 6 (L13a+L15) · S12a 2 · S12b 2 · S13 5 (L16) · S13a 5 (L13, 48 worker) · S13b 3 · S13c 2 · S14 6 (L17).
- S15: L19 3 (#93) · L22 3 (#94) · L21 2 (#95) · L20 5 (#96) · L23 6 (#97) = 19 run cho 5 lane = 3.8 (tính ở đây). L17 có 6 run ở cả hai nguồn (S14 và S15): suy luận là cùng một lane nên chỉ tính một lần.
- S16: L28 1 · L18 4 · L26 3 · L27 4 · L24 4 · L25 3 (hai PR) · L32 3 · L29 8 · L30 4 = 34 run cho 9 lane merge = 3.78 (tính ở đây); thêm L31 2 run lúc lane bị dừng, L34 5 run (`:95`), L35 ít nhất 3 run (`:86`).
- Trần "6 run mỗi lane" chỉ là quy ước của conductor (`P3-S16-SUMMARY.md:191`): S9 dùng 9 (owner nâng trần từ 6 lên 9 lúc 2026-10-18 21:26), L29 dùng 8; dùng đủ 6: S12, S14, L23. Orchestrator trả lại ở 311-384k context đã hiệu chỉnh (`RUN-SUMMARY.md:245-252`).
- Song song: wave A của S16 chạy 3 orchestrator cùng lúc (`status/CONDUCTOR-LOG.md:394`); L34 và L35 chạy cùng nhau ngày 10-24 (`P3-S16-carry-forward.md:86,95`).

## 4. Thời lượng spawn→merge đã ghi nhận (hồ sơ chương trình local, ngoài repo)

| Lane (PR) | Spawn (+07) | Mốc cuối | Thời lượng | Run | Nguồn `status/<file>:<dòng>` |
| --- | --- | --- | --- | --- | --- |
| L14 | 10-19 11:04 | MERGE_READY 18:46 | 7 giờ 42 phút (tính ở đây; nguồn: khoảng 7.7 giờ) | 5 | `RUN-SUMMARY.md:244` |
| L13 | 10-19 02:27 | 10-20 07:41 (mốc xong theo nguồn) | 29 giờ 14 phút (tính ở đây), gồm 322 phút usage limit #1-#4 | 5 | `RUN-SUMMARY.md:249` |
| L28 (#98) | 10-22 11:02 | gh merge 11:44 | 42 phút (hồ sơ local ghi 11:51 = 49 phút) | 1 | `CONDUCTOR-LOG.md:394`, `P3-S16-SUMMARY.md:66-68` |
| L18 (#99) | 10-22 11:02 | gh merge 14:01 | 2 giờ 59 phút (hồ sơ local ghi 14:07 = 3 giờ 5 phút) | 4 | như trên |
| L26 (#100) | 10-22 11:02 | gh merge 14:31 | 3 giờ 29 phút (hồ sơ local ghi 14:43 = 3 giờ 41 phút) | 3 | như trên |
| L30 (#107) | 10-23 21:59 | gh merge 10-24 04:56 | 6 giờ 57 phút | 4 | `CONDUCTOR-LOG.md:446` |

- Các cửa sổ spawn→merge trên còn gồm usage limit #1 (11 phút) với L14 và #10 (khoảng 20 phút) với L18 và L26 (tính ở đây từ giờ ở mục 5); L28 và L30 không chứa lần dừng nào đã ghi nhận.
- S16 từ lệnh của owner 10-22 10:56 (`CONDUCTOR-LOG.md:393`) đến merge #107 (gh): 42 giờ 0 phút cho 9 lane merge; trừ lần mất mạng 10 giờ 54 phút (mục 6) còn 31 giờ 6 phút (tính ở đây). Cùng cửa sổ có usage limit #10-#12 và mất đăng nhập 1.
- Các lane sau (gh, UTC): #108 10-24 03:14, #109 06:38, #110 11:32, #111 16:19, #112 18:05, #113 10-25 14:30. Không tìm thấy giờ spawn của chúng trong các nguồn đã đọc nên không có thời lượng spawn→merge.

## 5. Usage limit (429)

Nguồn #1-#6: `status/RUN-SUMMARY.md:257-265`; #7-#9: `status/P3-S15-SUMMARY.md:231-233`; #10-#12: `status/P3-S16-SUMMARY.md:159-163`, `status/P3-S16-carry-forward.md:14,58` (hồ sơ chương trình local, ngoài repo).

| # | Ngày (+07) | Dừng → tiếp tục | Mất |
| --- | --- | --- | --- |
| 1 | 10-19 | 16:29 → 16:40 | 11 phút |
| 2 | 10-19 | 19:00 → 19:26 | 26 phút |
| 3 | 10-19 → 10-20 | 22:18 → 00:20 | 124 phút |
| 4 | 10-20 | 02:46 → 05:27 | 161 phút |
| 5 | 10-21 | 00:00 → 01:20 | 80 phút |
| 6 | 10-21 | 05:59 → 06:20 | 20 phút |
| 7 | 10-21 | không ghi giờ dừng; reset 16:20, tiếp tục 16:22-16:23 | khoảng 1 giờ |
| 8 | 10-21 | 17:45-17:50; reset 21:20, tiếp tục 21:22-21:23 | khoảng 3 giờ 30 phút |
| 9 | 10-21 → 10-22 | 23:45-23:50; reset 02:20, tiếp tục 02:23 | khoảng 2 giờ 30 phút |
| 10 | 10-22 | khoảng 12:09; reset 12:20, tiếp tục 12:29-12:30 | khoảng 20 phút |
| 11 | 10-23 | ngay trước 02:00; reset 03:20, tiếp tục 03:30 | khoảng 80 phút (cửa sổ báo trước, nguồn không đo thêm) |
| 12 | 10-23 | khoảng 07:00; reset 08:20, tiếp tục 08:29 | khoảng 80 phút (cửa sổ báo trước, nguồn không đo thêm) |

- Chưa đánh số, trước 10-19 16:29 (`RUN-SUMMARY.md:268,281`): S2 run 1, S3 run 1, S8 run 1 (khoảng 07:12 ngày 10-18) và S9 lúc 17:39 ngày 10-18 (reset 18:20, Mac ngủ tới 19:52, mất khoảng 2 giờ 14 phút). Thêm một lần chạm ngày 10-22 khoảng 14:28 không gây dừng thật (owner nhắn "usage reset, continue" khoảng 14:30).
- Số lần: 12 đánh số + 4 chưa đánh số = ít nhất 16 lần dừng (tính ở đây). Tổng dừng của 12 lần đánh số: 1022 phút = 17 giờ 2 phút (tính ở đây: #1-#6 = 422 phút, cận dưới theo nguồn; #7-#9 = 7 giờ, `P3-S15-SUMMARY.md:234`; #10-#12 = 20 + 80 + 80 phút); trung vị 80 phút, ngắn nhất 11, dài nhất 210. Bằng 7.5% của 225.9 giờ lịch (mục 7; mẫu số gồm đêm và giờ nghỉ).
- Tần suất theo giờ lịch (tính ở đây): 12 lần đánh số trong cửa sổ 10-19 16:29 đến 10-23 08:20 = 87.85 giờ, tức 1 lần mỗi 7.3 giờ; cả giai đoạn: ít nhất 16 lần trong 225.9 giờ, tức nhiều nhất 14.1 giờ cho mỗi lần.
- Khoảng cách từ lúc tiếp tục đến lần dừng sau (giờ lịch, tính ở đây). Dưới 5 giờ ở 7 khoảng: 2 giờ 20 (#1→#2) · 2 giờ 52 (#2→#3) · 2 giờ 26 (#3→#4) · 4 giờ 39 (#5→#6) · 1 giờ 22-28 (#7→#8) · 2 giờ 22-28 (#8→#9) · 3 giờ 30 (#11→#12). Dài ở 3 khoảng có đêm, không có log hoạt động: 18 giờ 33 (#4→#5), 9 giờ 46 (#9→#10), 13 giờ 30 (#10→#11). Khoảng #6→#7 không đo được vì thiếu giờ dừng của #7.
- So với giả định "about one usage limit per 5 hours" (`status/PHASE4-PLAN-PROMPT.md:17`): theo giờ lịch số đo thưa hơn giả định (7.3 giờ trong cửa sổ nặng, nhiều nhất 14.1 giờ cả giai đoạn); theo khoảng cách giữa các lần dừng thì 7 trên 10 khoảng ngắn hơn 5 giờ. Giờ hoạt động không được ghi nhận nên không tính được tần suất theo giờ hoạt động.

## 6. Mất đăng nhập, mất mạng, classifier và các điểm dừng khác (hồ sơ chương trình local, ngoài repo)

- **Mất đăng nhập 1** ("Not logged in"), 10-22 khoảng 17:21-17:22: chết L24 run 2, L27 run 3 và 3 reviewer (L24 R2-SEC, L27 R2-A, L27 R2-B); owner đăng nhập lại và nhắn "continue"; L24 run 3 và L27 run 4 spawn trước 17:30 (8-9 phút); không mất commit, push hay merge (`status/P3-S16-carry-forward.md:24`, `status/CONDUCTOR-LOG.md:412`, `status/P3-S16-SUMMARY.md:165`).
- **Mất đăng nhập 2**, 10-24 17:55-17:56: chết L35 run 3, reviewer vòng 3 của nó, L34 run 2 và 1 worker; khôi phục từ disk trước 18:01 (5-6 phút; L35 run 3 tiếp tục bằng SendMessage, L34 run 3 spawn mới); L35 xong 18:32; không mất commit (`status/CONDUCTOR-LOG.md:473-475`, `status/P3-S16-carry-forward.md:86,95`).
- **Mất mạng** (ENOTFOUND, server_error), 10-23 khoảng 09:00-19:54 = 10 giờ 54 phút (nguồn: khoảng 11 giờ): 33 heartbeat xếp hàng; chết L29 run 6, worker U8c và R1S; không mất commit (`status/P3-S16-carry-forward.md:66`, `status/P3-S16-SUMMARY.md:167`). Bản đếm của summariser cho S16: 4 lần chạm usage limit, 2 lần mất đăng nhập, 1 lần mất mạng (`status/P3-S16-SUMMARY.md:23`).
- **Mac ngủ (đóng nắp)** 10-18 10:13-13:10 = 2 giờ 57 phút (`status/CONDUCTOR-LOG.md:173`, `status/RUN-SUMMARY.md:279`).
- **Classifier AWAIT**: `grep 'classifier|AWAIT-RQ'` trên `status/CONDUCTOR-LOG.md` ra 20 dòng thuộc 4 sự kiện khác nhau:

| # | Khi (+07), lane | Chờ | Nội dung | Nguồn `status/<file>:<dòng>` |
| --- | --- | --- | --- | --- |
| 1 | 10-20 17:18, L16 run 3 | 48 phút (đến commit 18:06) | commit `apps/web/e2e/chat.spec.ts` bị từ chối; owner cho phép commit (7c6b07c) | `CONDUCTOR-LOG.md:319,321`, `RUN-SUMMARY.md:297` |
| 2 | 10-21 22:40, L20 run 3 (RQ2) | 57 phút (đến 23:37) | nhãn "[Security Test Removal]"; owner chạy lệnh, commit ef01466 | `CONDUCTOR-LOG.md:373,376` |
| 3 | 10-23 01:29, L32 run 2 | không ghi thời lượng | nhãn "[Interfere With Workloads]"; conductor trả lời, không cần owner | `CONDUCTOR-LOG.md:430`, `P3-S16-SUMMARY.md:171` |
| 4 | 10-23 06:47, L31 run 2 | 24 giờ 47 phút (owner trả lời "A" lúc 10-24 07:34) | nhãn "Safety Bypass Flag"; L31 merge #108 lúc 10-24 10:14 | `CONDUCTOR-LOG.md:439,454`, `P3-S16-SUMMARY.md:39` |

## 7. Khoảng thời gian lịch (gh; tính ở đây)

- Từ `createdAt` của PR đầu (#58, 2026-10-16T00:27:17Z) đến `mergedAt` của #113 (2026-10-25T14:30:03Z): 9 ngày 14 giờ 2 phút 46 giây = 230.05 giờ.
- Từ `mergedAt` của #58 (2026-10-16T04:36:05Z) đến `mergedAt` của #113: 9 ngày 9 giờ 53 phút 58 giây = 225.9 giờ = 9.41 ngày; cả 10 ngày lịch UTC đều có merge (mục 2).

## 8. Không ghi nhận trong các nguồn đã đọc

- Tổng số worker-round thực tế: không có tổng; chỉ có số từng phần (S11 46 worker result, S13a 48 worker, mục 3) và ước lượng của kế hoạch Phase 3, 143 worker-round (`docs/sessions/web-mvp-phase3-plan.md:111-112`, trong git).
- Giờ hoạt động thật theo ngày hoặc theo lane (chỉ có mốc lịch và các lần dừng), nên không tính được tần suất usage limit theo giờ hoạt động.
- Spawn→merge của phần lớn lane (chỉ có các lane ở mục 4); giờ spawn của các lane merge từ #108.
- Số vòng review của từng lane (chỉ có mảnh: L30 có 35 finding qua 3 vòng, `status/P3-S16-SUMMARY.md:190`).
- Giờ dừng của usage limit #7; thời lượng đo được của #11 và #12 (chỉ có cửa sổ báo trước); thời lượng của classifier AWAIT số 3.
