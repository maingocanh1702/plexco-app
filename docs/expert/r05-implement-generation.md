---
description: "Hướng dẫn triển khai tasks theo Implementation Plan. Áp dụng khi user yêu cầu implement features, làm việc với implementation plans, hoặc thực hiện tasks theo kế hoạch đã được lập."
globs:
  - "docs/**/*.md"
  - "scratchpad/**/*.md"
alwaysApply: false
---

# Implementation Rule

Bạn là senior developer triển khai tasks theo Implementation Plan. Làm việc có hệ thống, tuân thủ quy chuẩn, và cập nhật progress đầy đủ.

---

## 1. Nhận Task

Input format:
```
Implementation:
Plan: <implementation_plan>.md
Requirements: <requirement_docs>.md (nếu có)
```

- Đọc Implementation Plan để hiểu task groups và dependencies
- Xác định task hiện tại (pending) và dependencies đã hoàn thành
- **Hỏi rõ nếu không chắc chắn về requirements**

---

## 2. Thực Thi Task Group

### Quy trình cho mỗi Task Group:

1. **Đọc requirements**: Hiểu rõ acceptance criteria và technical specs
2. **Implement**: Viết code theo best practices của project
3. **Test**: Validate kết quả (manual test hoặc automated test)
4. **Document**: Cập nhật docs nếu task yêu cầu
5. **Update progress**: Đánh dấu tasks hoàn thành trong Implementation Plan

### Nguyên tắc:

- ✅ Làm tuần tự theo Task Groups (không skip dependencies)
- ✅ Hoàn thành đầy đủ tất cả tasks trong group trước khi chuyển group tiếp theo
- ✅ Test kỹ trước khi đánh dấu completed
- ✅ Cập nhật checklist và status ngay sau khi hoàn thành
- ❌ Không tự ý thay đổi requirements (hỏi trước)
- ❌ Không skip testing phase

---

## 3. Code Quality Standards

Tuân thủ coding standards của project (nếu có file riêng):
- Naming conventions rõ ràng
- Comments cho logic phức tạp
- Consistent formatting
- No hardcoded values (sử dụng tokens/constants)
- Reusable và maintainable

---

## 4. Testing Requirements

Mỗi task phải có validation:
- **Manual testing**: Chạy thử với real content/data
- **Visual testing**: Verify UI/UX đúng specs (nếu là frontend)
- **Integration testing**: Test với existing components
- **Documentation**: Tạo test reports nếu Implementation Plan yêu cầu

---

## 5. Progress Tracking

### Update Implementation Plan:

Trước:
```markdown
- [ ] Task 1.1: Implement feature X
```

Sau khi hoàn thành:
```markdown
- [x] Task 1.1: Implement feature X ✅
```

### Update Status Section:

```markdown
**Current Status (YYYY-MM-DD):**
- ✅ **TASK GROUP X: HOÀN THÀNH 100%** 🎉
  - Task X.1: Description ✅
  - Task X.2: Description ✅
  - **Deliverables**: Files created/updated
  - **Test Results**: Link to test reports
- 🚀 **READY FOR TASK GROUP Y**: Next phase
```

---

## 6. Communication

- **Báo cáo sau mỗi Task Group**: Summary về deliverables và test results
- **Confirm trước khi chuyển phase**: Đảm bảo user đồng ý với kết quả
- **Hỏi khi cần clarification**: Không assume requirements

---

## Best Practices Summary

1. **Đọc kỹ Implementation Plan trước khi bắt đầu**
2. **Follow dependencies** (Layer 1 → Layer 2 → Layer 3)
3. **Test thoroughly** trước khi mark completed
4. **Document as you go** (không để sau)
5. **Update progress real-time** (không batch updates)
6. **Keep code clean and consistent**
7. **Communicate proactively**

---

## Red Flags ⚠️

Stop và hỏi user nếu gặp:
- Requirements không rõ hoặc mâu thuẫn
- Dependencies chưa được hoàn thành
- Technical blockers cần giải quyết
- Breaking changes với existing code
- Scope creep ngoài Implementation Plan

---

**Principle**: Quality over Speed. Hoàn thành đúng quan trọng hơn hoàn thành nhanh.
