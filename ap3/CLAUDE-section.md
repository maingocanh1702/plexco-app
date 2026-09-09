> ⚠️ **SỬA 09/09 (chiều):** mọi câu trong file này nói *writer* chạy review / mở PR đều đã lỗi thời —
> writer chỉ code rồi dừng ở `.ap3-run/READY-FOR-REVIEW`, **dispatcher** review + push + mở PR
> (`W1-DECISION-codex-sandbox.md`). Bản đúng đã nằm ở `CLAUDE.md`/`AGENTS.md`; file này chỉ là lịch sử.

> ✅ ĐÃ ÁP DỤNG 2026-09-09 vào `CLAUDE.md` (mục "Làn ap3"), `AGENTS.md` (English), `docs/standards/decisions.md` (DD-120 🟡).
> File này giữ làm bản gốc của đoạn văn; sửa ở đích, không sửa ở đây.

# Đoạn dán vào `CLAUDE.md` của Plexco (owner dán tay, sau khi chấp nhận DD-120)

> Đặt ngay dưới mục "Workflow mặc định — Level 3 supervised autonomy". Nó không thay mục đó; nó khoanh
> một ngoại lệ có tên cho run do máy khởi động. Payload agent đọc để thực thi nằm trong
> `.claude/skills/ap3-slice/SKILL.md` (English); đoạn này chỉ nói *khi nào* ngoại lệ áp dụng.

---

## ap3 — run do dispatcher khởi động (khi env `AP3_SLUG` có mặt)

Nếu session này được `ap3/dispatch.sh` khởi động — nhận biết bằng biến môi trường `AP3_SLUG`,
`AP3_TASK`, `AP3_BASE_SHA`, `AP3_STATE` — thì quy trình của slice là
`.claude/skills/ap3-slice/SKILL.md`, **không phải** mục "Workflow mặc định — Level 3" ở trên:

- **Không** `scripts/autopilot-scope-gate register`, **không** manifest runtime, **không** `READY.txt`.
  READY của ap3 là **một PR đang mở** trên nhánh `ap3/<slug>`, test xanh, verdict `AP3_REVIEW_VERDICT: CLEAN`.
- **Thẩm quyền để code** = file task `ap3/queue/<slug>.md` (owner viết, đã push lên `origin/main`,
  qua `ap3/lint-task.sh`) **+** class `enabled` trong `ap3/routines.json` (owner sửa tay). Không cần
  verdict block trong `docs/slice-readiness-verdicts.md` cho class này — xem DD-120.
- Thiếu context → **không hỏi** (session headless, `AskUserQuestion` bị chặn): viết `.ap3-run/HALT.md`
  với mã `MISSING_CONTEXT` và câu hỏi cụ thể, không mở PR.

**Mọi luật khác của repo vẫn nguyên, không có ngoại lệ:** 5 HARD RULES; review độc lập bắt buộc qua
`scripts/codex-review-pin.sh` (`bash ap3/review.sh code --base "$AP3_BASE_SHA"` gọi đúng script đó);
security round khi diff chạm auth/secret/permission/tiền/external input (`ap3/review.sh security`);
GitNexus `gitnexus_impact` trước khi sửa symbol và `gitnexus_detect_changes()` trước commit;
hook `pnpm review:check:changed`; agent-facing ⇒ English; commit message theo convention của repo.

**Phạm vi của ngoại lệ này là hẹp có chủ ý:** chỉ class ghi trong `ap3/routines.json` (hiện tại:
`code-quality-p2`). Task P0/P1, mọi slice chạm schema/migration/auth/tiền, và mọi slice đã có verdict
trong `docs/slice-readiness-verdicts.md` vẫn đi đường supervised ở mục trên. Một run ap3 mà cần bất kỳ
thứ gì ngoài scope đã khai → `HALT SCOPE_DRIFT`, class bị pause cho tới khi owner bật lại.

---

# Đề xuất ghi vào `docs/standards/decisions.md` (owner quyết; ghi dạng proposal 🟡)

| DD-120 | **Làn ap3 (proactive) cho class `code-quality-p2`** — run do `ap3/dispatch.sh` (launchd) khởi động không cần người gõ lệnh; thẩm quyền code = task file trong `ap3/queue/` + class `enabled` trong `ap3/routines.json`; READY = PR mở + Codex `CLEAN` + evidence row; owner merge tay, `AUTO_MERGE: off` giữ nguyên. **Không** áp cho P0/P1, schema, auth, tiền, i18n string. Class bị pause ở bất kỳ HALT/crash/PR bị từ chối/sửa tay trước merge; bật lại là quyết định owner. Bằng chứng để giữ làn: 3 run READY liên tiếp merge nguyên vẹn (`ap3/evidence.jsonl`). | 🟡 Đề xuất (2026-09-09) | P0–P1 (tooling) | `docs/level3-native/DESIGN.md` (repo Claude template) · `ap3/routines.json` · `ap3/README-W2.md` |
