# Retro / Lessons Learned: {FEATURE_NAME}

> **Date:** {YYYY-MM-DD}
> **Feature:** {feature_name}
> **Phase:** {phase_number}
> **Participants:** {names}

---

## 1. Tóm tắt

| Thuộc tính | Chi tiết |
|-----------|---------|
| Feature | {tên feature} |
| Duration | {start → end} |
| Planned vs Actual | {X sprints planned → Y actual} |
| Outcome | ✅ Shipped / ⚠️ Partial / ❌ Not shipped |

---

## 2. Điều làm tốt (Keep)

| # | Gì | Tại sao hiệu quả | Áp dụng lại cho |
|---|---|---|---|
| 1 | {VD: Spec trước code} | {Giảm 50% rework} | {Mọi feature} |
| 2 | | | |

---

## 3. Điều cần cải thiện (Improve)

| # | Vấn đề | Root Cause | Ảnh hưởng | Giải pháp | Owner |
|---|--------|-----------|-----------|----------|-------|
| 1 | {VD: Spec→code mâu thuẫn} | {Không gate 3 chiều} | {2 ngày rework} | {Thêm gate checkpoint} | {name} |
| 2 | | | | | |

---

## 4. Bugs / Issues gặp phải

| # | Bug | Root Cause | Fix | Lesson |
|---|-----|-----------|-----|--------|
| 1 | {VD: RLS leak} | {SET LOCAL thiếu} | {Thêm middleware check} | {Luôn test tenant isolation} |
| 2 | | | | |

---

## 5. Spec vs Reality

> So sánh giữa spec doc ban đầu và implementation thực tế.

| Aspect | Spec (planned) | Reality (actual) | Delta | Lý do |
|--------|---------------|-----------------|-------|-------|
| Endpoints | {N endpoints} | {M endpoints} | {+/-X} | {feature scope change} |
| DB tables | {N tables} | {M tables} | {+/-X} | {normalization decision} |
| Edge cases | {N documented} | {M encountered} | {+X new} | {runtime discovery} |
| Timeline | {X days} | {Y days} | {+Z days} | {tech debt} |

---

## 6. Technical Debt phát sinh

| # | Debt | Severity | Estimated fix | Tracked |
|---|------|----------|--------------|---------|
| 1 | {VD: Missing index on payments} | 🔴 High | {2h} | {JIRA/Linear #} |
| 2 | | | | |

---

## 7. Action Items

| # | Action | Owner | Deadline | Status |
|---|--------|-------|---------|--------|
| 1 | {VD: Update template with new lesson} | {name} | {date} | 🔲 |
| 2 | | | | |

---

## Template Changelog

| Date | Thay đổi |
|------|----------|
| 2026-08-09 | Tạo template — adapted từ Sporta `design-to-code-improve.md` retro format |
