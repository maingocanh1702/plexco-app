# Kế hoạch bước kế tiếp — Plexco, sau phiên 2026-08-26

> **KHÔNG PHẢI EXECUTION AUTHORITY.** Đây là bản ghi thứ tự và lý do.
> Authority thi hành vẫn là `docs/standards/decisions.md` cộng manifest/contract của từng lane.
> Không tài liệu nào ở đây tự cho phép merge, push, deploy, cấp secret, sửa gate hay ghi vào `main`.
> Mọi số trong file này là **số đo**, không phải authority — đo lại trước khi dựa vào nó.

Đo 2026-08-26 trên `origin/main` `6bae04e15feb7dcadba4c711d13a6722c9e34e38`.

---

## 1. Trạng thái đo được

Tám commit đã land hôm nay:

| SHA | |
|---|---|
| `a3654fc` | `closeSession` + obligation-termination authz + DD-117 |
| `770ff4b` | Ba route API nghiệp vụ đầu tiên + ESLint guard DD-56 |
| `e943663` | DD-56 clause 1 — deferral có tên cho announce route |
| `0c204a9` | Đóng blindspot typecheck + 11 lỗi nó che |
| `cec62c6` | DD-118 — nguồn ngôn ngữ surface đã đăng nhập |
| `8e668a1` | `cancelSession` — đóng trọn family close/cancel |
| `54d7425` | Maturity ledger — split-early beats hardening |
| `6bae04e` | `runWithLang` + definer reader `tenant_locale` (0035) |

Runtime state: **0 lane in-flight**, root lock **FREE**, tracked working tree **sạch**.

Tồn đọng đã đo, không phải suy diễn:

- 3 entry untracked ở root: `_to_delete/`, `design.pen`, `fe.pen`
- 2 worktree cũ: `session-draft-lifecycle-commands`, `…--v2` (13–14/08)
- 1 reservation cũ trong `INFLIGHT.md`: `auth-s4-d0-revoke-core`, **đã merged 20/07**
- 1 thư mục lạc: `.autopilot/state/Plexco app`

---

## 2. Thuộc tính được ÉP BUỘC và thuộc tính chỉ được KHẲNG ĐỊNH

Đây là trục xuyên suốt của phiên hôm nay, và là lý do của thứ tự ở §3.

| Thuộc tính | Trạng thái | Bằng chứng |
|---|---|---|
| RLS fail-closed qua `tenantRepo` | **ép buộc** | choke-point + test |
| DD-56 clause 2 — role chỉ resolve ở một chỗ | **ép buộc** từ `770ff4b` | ESLint `no-restricted-imports`, không phải scanner cú pháp |
| `tenants.locale` đọc qua definer, không grant bảng | **ép buộc** từ `6bae04e` | `pg_proc` + ACL assertions, 3 giá trị `false` lật khi có grant lạ |
| Typecheck bao phủ `apps/web/lib/*.test.ts` | **ép buộc** từ `0c204a9` | `include` đã sửa; 11 lỗi ẩn đã lộ và đã fix |
| `MIGRATION_COUNT` khớp thư mục migrations | **ép buộc** | UCC-8 |
| Round breaker (`MAX_ROUNDS`, `REGION_THRASH`) | **ép buộc** | gate |
| `negative_scope` của manifest | **CHỈ KHẲNG ĐỊNH** | không có kiểm tra máy; B2 vượt qua nó mà gate vẫn pass |
| Ceremony cần `PLEXCO_COMMIT_OWNER` | **ép buộc bởi hook, KHÔNG có trong runbook** | hook `ROOT_COMMIT_UNLOCKED`; runbook chỉ ghi lock |
| Lane tự hoàn tất lifecycle của mình | **KHÔNG đạt** | `ap-finish`/release/`branch -D` bị permission layer chặn in-process, mọi lần land |
| Hai lane không red-line nhau qua Postgres chung | **CHỈ THỦ CÔNG** | serialize bằng tay; chưa có per-worktree `DATABASE_URL_TEST` |

Ba dòng cuối là chi phí trả **mỗi lần** land, không phải một lần.

---

## 3. Thứ tự chạy được ngay bây giờ

| Thứ tự | Lane | Risk | Điều kiện mở | Vì sao ở vị trí này |
|---|---|---|---|---|
| **K1** | `kit-canonical-sync` | P2 | không phụ thuộc | **Có đồng hồ.** `autopilot-update.sh` lần tới **âm thầm revert** mọi món chưa sync về canonical mirror. Và nó là lane duy nhất làm mọi lane sau **rẻ hơn** |
| **L1** | `db-updatesession-noop-version-ordering` | P1 | không phụ thuộc | Bug **thật đang sống trên main**: `isInt4` validate **trước** no-op (`session-service.ts` L178/181 so với vùng no-op). B1 đã sửa hình dạng này cho close, B2 cho cancel; update vẫn còn |
| **D1** | `docs-dd118-user-settings-correction` | P2 | root writer, cần lock | `feature_user_settings_tech.md:201` trao precedence cho `persons.language` — **cột không tồn tại** — trái DD-118. Đây là spec sẽ đẩy lane kế đi đúng đường v1 đã đi |
| **F4** | `db-barrel-exports-close-cancel` | P2 | sau K1 | Export `closeSession` + `cancelSession`; cả hai đã hoãn có chủ đích. Nhỏ, đóng nợ có tên |
| **W1** | `web-route-test-appdb-stub` | P2 | không phụ thuộc | Ba `route.test.ts` stub `appDb()` thành `{}` → 53 dòng stderr trong suite xanh. Một dòng mỗi file |
| **R1** | `reconcile-2026-08-26` | P2 | **sau K1** | Hygiene diện rộng, §7. Chạy sau K1 để không phải làm hai lần |

**Report-only, không mở lane:** 34 site `t()` ở auth/onboarding còn ngoài mọi request context. Con số đó là **đầu vào** cho quyết định có mở lane rộng hay không — không phải lý do để mở.

### Vì sao K1 đứng trước một bug P1 đang sống

Không phải vì kit quan trọng hơn code. Vì hai lý do đo được:

1. **Chỉ K1 có deadline huỷ hoại.** Năm trong bảy món của nó nằm ở file mà `autopilot-update.sh` ghi đè. Chậm K1 không phải hoãn — là mất, rồi phát hiện lại với giá đầy đủ.
2. **K1 giảm giá của L1, D1, F4, W1 và R1.** Lifecycle-completion gap bắt owner chạy tay ba lệnh **mỗi lần land**. Năm lane sau đó là mười lăm lệnh tay. Sửa trước thì trả một lần.

L1 là bug thật nhưng **không phải bug đang chảy máu**: nó trả `VALIDATION_ERROR` thay vì kết quả no-op ở một nhánh hẹp. Không mất tiền, không rò dữ liệu, không sai authz.

---

## 4. Kế hoạch này KHÔNG làm gì

- Không cho phép merge, push, deploy hay cấp secret. Ba việc đó vẫn cần tay owner.
- Không nới gate, không hạ số clean round, không bỏ security round.
- Không gộp lane để giảm số lần merge. Thước đo là **mỗi P1 mechanism đủ nhỏ để gate, review và rollback**, không phải số lần bấm merge.
- Không cho lane nào sửa gate state của chính nó. Nếu một ruling **chỉ** thi hành được bằng cách lane tự sửa `INFLIGHT`/`gate-result`/`READY`, thì ruling đó sai — quay lại hỏi.

---

## 5. Contract bắt buộc cho K1 (lane duy nhất có đồng hồ)

**Canonical-first.** Sửa ở `Claude template` mirror trước, để `autopilot-update.sh` mang về. Sửa ở repo rồi hy vọng nó sống sót là cách đã mất `DYNAMIC_SEGMENT` một lần.

**Một lần sync, không drive-by.** Bảy món đi cùng một lane, một review:

1. `DYNAMIC_SEGMENT` trong `scripts/autopilot-review-readiness.mjs` — validator từ chối Next.js dynamic segment (`[id]`, `[...slug]`)
2. Per-worktree `DATABASE_URL_TEST` — hai lane gate cùng lúc trên một Postgres thì red-line nhau
3. `requireString()` từ chối **mọi** `<` và `>` để bắt `<placeholder>` — chặn luôn `=>` trong prose. Sửa: chỉ từ chối **cặp ngoặc placeholder**, không phải mọi ký tự góc
4. Lifecycle-completion gap — lane merge được nhưng không finish được, nên **mọi** lần land để lại lock đang giữ. Cách sửa **không** phải cấp thêm quyền: hoặc lock có TTL, hoặc `ap-merge` từ chối chạy khi đường finish không dùng được
5. Tên lệnh canonical — `pnpm run lint` (eslint toàn repo, gồm guard DD-56) chứ không phải `pnpm -r run lint` (không tồn tại). Một lệnh không tồn tại và một check fail trông giống hệt nhau từ ngoài
6. Ràng buộc READY↔content — thêm commit sau gate là phá binding. Deviation ghi **trước** gate cuối, không bao giờ sau. Binding đã vỡ mà không có đường reopen ⇒ `authorized_close` với lý do đầy đủ, **không** sửa tay lifecycle state để re-gate chạy được
7. Ceremony step 1 là **acquire-and-export không tách rời** — `ap-merge` tạo root commit, nên hook chi phối cả ceremony. Thiếu `PLEXCO_COMMIT_OWNER` thì merge chết **sau khi squash đã staged**

Thêm một món nhỏ nhưng sẽ cắn: **trích verdict đọc dòng verdict CUỐI của transcript, không bao giờ dòng đầu.** Mỗi transcript có `VERDICT: FINDINGS` ở đầu vì prompt liệt kê token hợp lệ; ai grep first-match sẽ nhận kết luận ngược và trông rất có thẩm quyền.

**Không hai project cùng đụng mirror.** `Bestminton Club Payment check bot` cũng consume canonical kit này (`autopilot-readiness-preflight-enforce`). Hai lần drive-by đồng thời thì cái sau đè cái trước — đúng cơ chế `autopilot-update.sh` vẫn làm. Gom vào cùng đợt hoặc serialize.

---

## 6. Luật nhà đã chốt hôm nay

Sáu luật, chia hai họ.

**Họ "đo đúng cục bộ, sai toàn cục"** — mỗi cái là một phép đo đúng ở chỗ của nó và sai ở chỗ nó được dùng:

1. Anchor **duy nhất** không nói gì về hàng xóm của nó. Chèn giữa đoạn thì in anchor cộng hai dòng sau trước khi ghi, và đếm số lần xuất hiện trước/sau.
2. `tsc` standalone với cờ xấp xỉ **không** phải project program. Đo scope chạy ở project mode hoặc không tính.
3. Một chữ ký hàm **không** là bằng chứng tham số của nó có chỗ lưu. `resolveLang(memberLocale, …)` đọc như design intent; kiểm tra storage cho thấy `memberLocale` không có cột. Design intent và hoá thạch nhìn từ chữ ký là giống nhau.
4. Một bộ tín hiệu lệch nhau có thể là **thao tác đang bay**, không phải trạng thái hỏng. Đọc lại trước khi chẩn đoán.
5. Một công cụ **không thấy** một thứ báo giống hệt thứ **không tồn tại**. Vắng mặt chỉ là bằng chứng khi người quan sát có khả năng thấy sự hiện diện.
6. Bộ tín hiệu bắt được **lỗi không nhất quán**, không bắt được **lỗi hệ thống**. "Cả bốn đều khớp" là **đủ để đi tiếp**, không phải **bằng chứng nó chạy đúng**.

**Họ "một authority cho một sự thật"**:

7. Một danh sách giữ bằng tay ở N chỗ thì sai ở chỗ thứ N−1 không ai nhớ sửa. Cách chữa là **xoá**, không phải cẩn thận hơn: chỉ một bản được phép tồn tại, và đó là bản **chạy được**.
8. Một khẳng định về **tính đầy đủ** hoặc có kiểm tra máy móc, hoặc đừng khẳng định là đầy đủ.
9. Một capability premise — "X đọc được", "Y import được", "Z tồn tại" — là một **phép đo**. Viết nó vào brief không biến nó thành phép đo. Ba lần vấp hôm nay: `tenants` đọc được, `packages/db` import được `parseLang`, `persons.language` tồn tại.
10. Hướng nội của (9): trước khi register, grep mọi thứ **khẳng định về hình dạng** bạn sắp đổi, không chỉ code hiện thực nó. "File thay đổi chạm tới" và "file khẳng định về cái nó chạm tới" là hai tập khác nhau.

Và một luật quy trình:

11. Lane thấy `negative_scope` của **chính mình** chặn một fix đúng thì **dừng và hỏi**. Không làm rồi báo. `negative_scope` không được máy ép buộc — đó chính là lý do phải giữ bằng tay.

---

## 7. Reconcile bắt buộc (R1)

- Backfill bảng DD cho 110–118; `BUILD-STATUS` refresh; UC floor 8→10; re-pin canonical runner
- Backlog reconcile + AGED entry; ghi chú DD-56
- Doc-sync: `client.ts:9`, `README:72`, `db.dbml:424`, `docker-compose`, và comment outbox cũ ở `apps/bot/src/dispatcher.ts` + `queues.ts` (ba route đã ship đều insert outbox row, nên comment "no producer" là sai)
- Sửa citation trong DD-118: thân bài trỏ tới luật public-surface bằng mô tả, chưa bằng số DD
- Xác minh nhãn ngày trong các doc phiên trước (lệch ~2 ngày)
- Dọn reservation `auth-s4-d0-revoke-core` (merged 20/07), hai worktree `session-draft-lifecycle-commands`, thư mục lạc `.autopilot/state/Plexco app`
- Quyết định số phận `design.pen` / `fe.pen`: `.gitignore` hay commit có chủ đích. Để lơ lửng thì lần sau lại là câu hỏi giữa ceremony
- `zalo_bots.secret` đang plaintext — hardening có tên, không gộp vào lane khác

---

## 8. Verdict

Sáu tính chất an toàn giờ **được ép buộc** thay vì được khẳng định; ba tính chất còn **chỉ được khẳng định**, và cả ba đều nằm trong K1.

Thu hoạch lớn nhất của phiên không phải tám commit. Là lane **không** land: `web-i18n-runwithlang-request-context` v1 xanh lint, typecheck, format và **1.191 test** trong khi **không chạy được một dòng nào** trong production — khoảng cách đúng bằng **một database role**. Nó chỉ lộ ra vì code review round 1 đọc cluster thật thay vì đọc diff.

Cái đóng được khoảng cách đó không phải cẩn thận hơn. Là **mỗi lời khẳng định giờ đều có một thứ có thể fail**.
