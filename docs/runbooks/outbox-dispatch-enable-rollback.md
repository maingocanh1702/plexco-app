# Runbook: bật / rollback outbox dispatch (registry, DLQ, NOTIFY wake)

> **Dành cho:** owner. **Nguồn:** lane L3 `p3-m6-outbox-delivery-core`, migration `0056`, DD-134 (a)(b)(e); default commit của cờ lịch đổi thành `true` theo DD-141 (B3, 2026-10-21), thay DD-134 (e) chỉ cho default commit; bước bật projector là CLI owner `scripts/outbox-projector-enable.mjs` theo lane L24 (quyết định owner 2026-10-22, mục 1: event ack trong lúc projector tắt không được mất lặng lẽ).
> Lệnh giữ nguyên tiếng Anh, copy-paste được; chạy từ thư mục gốc repo. Ví dụ dùng Postgres compose local
> (`plexco-postgres-1`, DB `plexco`); môi trường khác: thay bằng psql tới đúng DB với credential `DATABASE_URL_MIGRATION`.
> Bật dispatch cho dùng thật với token Zalo thật là **bước P0 của owner**, không phải việc của agent.

## Quy tắc an toàn

- **Default commit của `OUTBOX_DISPATCH_SCHEDULE_ENABLED` là `true`** ở `.env.example` và `infra/docker-compose.yml` (B3, DD-141). Worker chỉ lên lịch khi cờ đúng chuỗi `"true"`, bản đồ projector không chứa stub **và** probe registry qua (migration `0056`); không thì log `outbox dispatch schedule OFF` kèm lý do. Cờ `true` không có nghĩa là đã gửi: projector seed tắt hết nên event chỉ được ack với `{}` cho tới khi owner bật projector; bật dùng thật là **bước P0 của owner** (deliverer Zalo thật, token bot Zalo thật, bật projector trong registry).
- Đường cũ (gọi thẳng `outbox_projector_set_enabled(<tên>, true)`, không qua CLI): event ack trong lúc một projector đang tắt không có dòng delivery cho projector đó; vì claim bỏ qua event đã ack và đường cũ không backfill hay replay cho nó, event đó không bao giờ được gửi tới projector đó, kể cả sau khi bật lại. Câu này (ghi 2026-10-21) vẫn đúng cho đường cũ; CLI ở bước 2.4 thay đường đó.
- Qua CLI, event ack trong lúc projector tắt tới được projector đó nếu còn trong ngưỡng (tuổi và cap); nếu không thì được ghi một expiry record trong `job_audit_events`. Không event nào bị bỏ lặng lẽ. Giá trị ngưỡng, cap và vị trí record ở bước 2.4.
- Đồng hồ worker và DB phải đồng bộ NTP: lệch >= 15 s biến một lần retry sớm thành dlq `malformed_outcome` (replay được).
- Bật projector chỉ bằng CLI owner `node scripts/outbox-projector-enable.mjs enable --projector <tên>` (bước 2.4). **Không** gọi thẳng `outbox_projector_set_enabled(<tên>, true)`: đường raw chỉ đổi cờ, bỏ qua backfill, nên bị cấm để bật (lỡ bật raw thì chạy lại CLI để khôi phục). **Không** bằng migration, **không** sửa tay bảng. Tắt (rollback) vẫn là `outbox_projector_set_enabled(<tên>, false)` (mục 3).
- Chỉ bật một projector khi module thật của nó **đã deploy trên mọi worker đang chạy**: cả ba (`web_realtime`, `zalo_dm`, `public_sessions`) đã nối trong `apps/bot/src/projectors/index.ts` ở code hiện tại, không còn module nào chờ lane khác; worker chạy bản cũ còn stub trả dlq `no_projector_implemented`. `zalo_dm` vẫn cần bot token thật (bước P0 của owner).

```bash
# Owner SQL shell (local compose). Mọi lệnh gọi function của job_definer chạy giữa SET ROLE job_definer ... RESET ROLE.
OWNER_SQL='docker exec -i plexco-postgres-1 psql -U plexco -d plexco -v ON_ERROR_STOP=1'
```

## 1. Điều kiện trước

1. DB đã migrate tới `0056` (`[migrate] applied=... skipped=...`, không lỗi); DB cũ: chạy `pnpm db:bootstrap` (superuser,
   `DATABASE_URL_MIGRATION`) **trước** `0054`, rồi `pnpm --filter @plexco/db migrate`.
2. `pnpm --filter @plexco/bot provision:queue` đã chạy; preflight của worker pass (worker log không có dòng `[preflight] FAILED`).
3. Tất cả projector đang tắt:

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT name, enabled FROM outbox_projectors ORDER BY name" -c "RESET ROLE"
```

## 2. Bật theo thứ tự an toàn

1. Projector vẫn tắt hết. Xác nhận worker chạy với `OUTBOX_DISPATCH_SCHEDULE_ENABLED=true` (default commit đã là `true`; đặt lại cho worker nếu môi trường đang ghi đè), restart worker
   (`pnpm --filter @plexco/bot start:worker`). Log phải có `outbox dispatch schedule registered: "* * * * *"` và
   `[worker] outbox wake listening`; dòng `outbox dispatch schedule OFF — <lý do>` nghĩa là chưa bật (đọc lý do).
2. Xác nhận heartbeat báo đúng cổng (trong 30 s):

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT outbox_dispatch_schedule_live()" -c "RESET ROLE"   # phải là t
```

3. Chờ backlog chưa ack về 0. Đây là điều kiện trước của **mỗi** lần bật hoặc bật lại bằng CLI, và chính CLI bắt buộc nó (không chỉ runbook): khi mọi projector tắt, worker ack event với tập rỗng `'{}'`; còn event của projector đó chưa ack mà cũ hơn ngưỡng thì CLI từ chối (exit 2 `unacked_backlog`), nên phân loại của CLI luôn là kết quả cuối:

```bash
$OWNER_SQL -c "SELECT count(*) FROM outbox_events WHERE acked_at IS NULL"   # chờ = 0
```

Gặp `unacked_backlog` không phải ngõ cụt: CLI từ chối trước khi bật, không bật gì, không ghi dòng hay record nào. Để worker ack hết backlog (worker chạy với cờ `"true"` theo bước 2.1-2.2; chờ lệnh đếm trên về 0 chính là bước drain này), rồi chạy lại đúng lệnh CLI. Khi projector đang tắt, các event cũ hơn ngưỡng lúc đó đã ack mà không có dòng delivery cho projector đó, nên CLI ghi expiry record cho chúng thay vì gửi: không event nào mất lặng lẽ. Nếu projector đã bật sẵn (bật raw, hoặc CLI thoát `1` sau bước bật), tắt nó trước theo mục 3 rồi mới drain: drain lúc nó đang bật thì worker chuẩn bị delivery cho chính các event cũ đó và gửi đi (`zalo_dm`: tin cũ tới người chơi).

4. Rồi mới bật **từng** projector, bằng CLI owner: **đường duy nhất để bật** (lần đầu và bật lại sau rollback). Credential là `DATABASE_URL_MIGRATION` (thành viên `job_definer` sau `pnpm db:bootstrap`), chỉ nằm trong môi trường, không bao giờ trên dòng lệnh:

```bash
read -rs PW && export DATABASE_URL_MIGRATION="postgres://plexco:${PW}@localhost:5432/plexco" && unset PW   # như mục 4 (DLQ): gõ password + Enter, không hiện, không vào history
node scripts/outbox-projector-enable.mjs enable --projector web_realtime
```

Password có ký tự dành riêng của URL (`@ : / ? # [ ] %`...) phải percent-encode trước khi ghép vào `DATABASE_URL_MIGRATION` (ví dụ `@` thành `%40`, `#` thành `%23`); nếu không, URL bị cắt sai chỗ hoặc không parse được, và khi không parse được CLI dừng trước khi kết nối nên chưa làm gì: in `error: ERR_INVALID_URL Invalid URL`, thoát `1`, không in URL ra (CLI enable in thêm dòng gợi ý chung `if the enable step had committed, the projector stays enabled: re-run this command (it is idempotent) or disable it`; ở trường hợp này bước bật chưa chạy, projector không đổi).

CLI chạy hai phần liên tiếp. Transaction đầu từ chối nếu còn event chưa ack cũ hơn ngưỡng (bước 2.3), nếu không thì bật bằng chính function cũ `outbox_projector_set_enabled`. Transaction sau, khi transaction đầu đã commit, quét mọi event thuộc route của projector mà chưa có dòng delivery và chưa có record cho projector đó: event chưa ack **luôn** được chuẩn bị delivery (ngoài cap); event đã ack, còn trong ngưỡng và thuộc nhóm mới nhất trong cap, được chuẩn bị delivery rồi gửi qua đường DD-134 không đổi; mọi event đã ack còn lại được ghi **một** expiry record. Chỉ `public_sessions`: sau đó CLI dựng lại projection từ trạng thái canonical cho mọi tenant có outbox event.

- **Ngưỡng** (accepted under the owner's delegation of 2026-10-24 (assistant review), DD-149; hằng số `BACKFILL_MAX_AGE_MINUTES` và `BACKFILL_MAX_ROWS` trong `scripts/outbox-projector-enable.mjs`): tuổi tối đa **30 phút** theo `outbox_events.created_at` (đồng hồ DB) cho mọi projector, trừ `zalo_dm` dùng ngưỡng chung **60 phút** (`ZALO_DM_MAX_AGE_MINUTES`, đọc từ `apps/bot/src/zalo-dm-delivery-age-bound.json`, đúng giá trị dispatcher áp lúc gửi: DD-146); tối đa **200** event đã ack trong ngưỡng cho mỗi projector mỗi lần chạy, mới nhất trước. Ngưỡng chặn tuổi event lúc **chuẩn bị** delivery; các retry DD-134 không đổi (mục 4) cộng thêm thời gian của chúng, nên với `zalo_dm` dispatcher còn kiểm tuổi event lần nữa ngay trước khi gửi, theo cùng ngưỡng 60 phút (DD-146, mục 3 và 4). Ngưỡng có vì giao muộn `zalo_dm` có thể gây hại (tin cũ tới người chơi).
- **Ngoại lệ `player.promoted` (R-CLI, DD-146 sửa đổi, DD-149):** CLI không bao giờ phân loại `age` cho event `zalo_dm` có type nằm trong `untilSessionStart` của `apps/bot/src/zalo-dm-delivery-age-bound.json` (hiện chỉ `player.promoted`, DM báo người chơi được lên từ danh sách chờ; projector khác giữ ngưỡng tuổi của nó): event đã ack loại này được chuẩn bị delivery như event còn trong ngưỡng, dưới cùng cap **200** event mỗi lần chạy; từ chối `unacked_backlog` (bước 2.3) và cap không đổi. Hết hạn hay không do chỗ kiểm giờ bắt đầu của dispatcher quyết định, không phải CLI (xem **Ngoại lệ** sau lệnh SQL liệt kê dòng `noop_expired` bên dưới).
- **Output:** đúng một dòng JSON trên stdout, chỉ có tên projector, cờ `changed` và các số đếm; không có chuỗi kết nối, credential hay payload event: `{"projector":"<tên>","changed":<true|false>,"prepared":<n>,"expired_age":<n>,"expired_cap":<n>,"rebuilt_sessions":<n>}`. `changed=false` nghĩa là projector vốn đã bật. Lý do từ chối hoặc lỗi in ra stderr.
- **Exit code:** `0` xong (chạy lại cũng `0`). `2` từ chối: `invalid_argument` (thiếu hoặc sai `--projector`, kiểm trước khi kết nối), `projector_not_found` (sai tên), `unacked_backlog` (không bật gì và cũng không tắt gì: hướng đi ở bước 2.3; nếu projector đã bật sẵn, lần từ chối này không tắt nó: tắt trước theo mục 3, rồi drain, rồi chạy lại CLI), `projector_disabled` (projector bị tắt khi CLI đang chạy: xen giữa hai transaction thì chưa backfill gì; trong lúc dựng lại `public_sessions` thì backfill đã commit, tenant đang dựng dở vẫn chạy xong, CLI dừng ở tenant kế tiếp, và các tenant đã dựng lại vẫn đã commit; chạy lại CLI nếu vẫn muốn bật: lần chạy lại bật lại projector và dựng lại đủ mọi tenant). `1` mọi lỗi khác (chưa đặt `DATABASE_URL_MIGRATION`, không kết nối được, lỗi SQL). Nếu `1` xảy ra sau khi bước bật đã commit (transaction đầu xong), projector đang bật mà backfill, hoặc phần dựng lại `public_sessions`, có thể chưa xong: chạy lại CLI (idempotent) hoặc tắt projector theo mục 3.

**Expiry record** nằm ở `job_audit_events`: mỗi (event, projector) tối đa một dòng, reason `projector_delivery_expired:<projector>:age` hoặc `projector_delivery_expired:<projector>:cap`. Xem số lượng theo reason:

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT reason, count(*) FROM job_audit_events WHERE starts_with(reason, 'projector_delivery_expired:') GROUP BY reason ORDER BY reason" -c "RESET ROLE"
```

**Expiry lúc gửi (chỉ `zalo_dm`, DD-146):** khi event đã quá ngưỡng 60 phút ở thời điểm gửi, dispatcher không gửi mà kết thúc luôn dòng delivery: dòng nằm ở `projector_deliveries` với `projector = 'zalo_dm'`, `status = 'delivered'`, `provider_ref = 'noop_expired'` (không vào dlq, không phải lần thất bại; `job_audit_events` của nó ghi reason `projector_delivery_delivered` như mọi delivery xong, chỉ `provider_ref` phân biệt); tuổi lúc gửi là `delivered_at - outbox_events.created_at` (cùng đồng hồ DB). Tuổi được kiểm ở đầu mỗi lần gửi, và lần gửi đó mang theo hạn chót là chính ngưỡng: `deliver()` dừng ở mốc sớm hơn giữa 120 s (`ATTEMPT_BUDGET_MS`) và lúc event đủ 60 phút; mỗi lệnh gửi tới Zalo có timeout không quá phần thời gian còn lại, và hạn chót được kiểm trước khi đọc danh sách người nhận, trước mỗi lần giải mã người nhận và trước mỗi lệnh gửi: hết hạn ở đó thì lần đó trả retry `delivery_deadline_reached` khi mốc 60 phút đến trước, `send_budget_exhausted` khi 120 s đến trước. Hạn chót tính từ lần dispatcher đọc đồng hồ DB nhưng đếm trên đồng hồ của worker từ lúc `deliver()` bắt đầu, nên một DM chỉ có thể rời hệ thống sau mốc 60 phút đúng bằng khoảng trễ giữa hai thời điểm đó, không còn tới 120 s; đúng thiết kế (DD-146, L44), không phải lỗi.
Riêng event `player.promoted` không theo ngưỡng 60 phút này mà theo giờ bắt đầu của session: xem **Ngoại lệ** ngay sau lệnh SQL liệt kê dòng `noop_expired` bên dưới.

Mỗi dòng hết hạn có đúng một dòng warning trong log của bot worker (`console.warn` trong `apps/bot/src/dispatcher.ts`, in sau khi dòng delivery đã hoàn tất), chỉ có tuổi, ngưỡng (giây), id event và tên projector, không có nội dung tin, người nhận hay số tiền: `[dispatcher] delivery expired: age <giây>s > bound <giây>s (event <event-uuid>, projector zalo_dm)`; nếu không đọc được thời gian của event thì cũng hết hạn, không gửi, và dòng là `[dispatcher] delivery expired: age unreadable, bound <giây>s (event <event-uuid>, projector zalo_dm)`. Xem các dòng hết hạn gần nhất:

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT d.event_id, d.projector, d.delivered_at, round(extract(epoch FROM d.delivered_at - o.created_at)) AS age_s FROM projector_deliveries d JOIN outbox_events o ON o.id = d.event_id WHERE d.projector = 'zalo_dm' AND d.status = 'delivered' AND d.provider_ref = 'noop_expired' ORDER BY d.delivered_at DESC LIMIT 50" -c "RESET ROLE"
```

**Ngoại lệ: DM báo người chơi được lên từ danh sách chờ (event type `player.promoted`; DD-146 sửa đổi, DD-149):** DM này không bị ngưỡng 60 phút ràng buộc; nó còn gửi được cho tới giờ bắt đầu của session, theo đồng hồ DB. Danh sách `untilSessionStart` trong `apps/bot/src/zalo-dm-delivery-age-bound.json`, cạnh `maxAgeMinutes`, liệt kê các event type được hưởng ngoại lệ này (hiện chỉ `player.promoted`). Dispatcher kiểm ở đúng một chỗ, ngay trước khi gửi, cũng là chỗ kiểm tuổi ở trên (nên mọi đường đều đi qua: gửi lần đầu, retry, dòng backfill, dòng chạy tiếp sau khi bật lại bằng CLI hoặc đường raw, dòng `replay` từ dlq): nó đọc giờ bắt đầu hiện tại của session (session dời giờ thì tính theo giờ mới) qua function chỉ đọc `zalo_dm_promotion_seconds_to_start(event_id, claim_token)` (migration `0071`, `EXECUTE` chỉ cho `app_worker`), và kết quả quyết định:

- `> 0`: gửi như thường.
- `<= 0` (đã tới hoặc qua giờ bắt đầu): không gửi; dòng kết thúc `delivered` với `provider_ref = 'noop_expired'` (DF3 của DD-146, không đổi; không vào dlq) và một dòng warning `[dispatcher] delivery expired: session started <n>s ago, rule until_session_start (event <event-uuid>, projector zalo_dm)`, với `<n>` là số giây nguyên đã qua kể từ giờ bắt đầu.
- `NULL` (session không tồn tại, thuộc tenant khác, hoặc có `starts_at` vô hạn: function trả NULL vì `isfinite`; giá trị không phải số hữu hạn cũng tính là không đọc được): cũng hết hạn và kết thúc như trên, dòng warning là `[dispatcher] delivery expired: start unreadable, rule until_session_start (event <event-uuid>, projector zalo_dm)`.
- Không trả về dòng nào: claim đã mất; dispatcher không gửi và không ghi gì.

Event hết hạn không bao giờ tới `deliver()`: không đọc target, không ghi dòng audit, không giải mã secret, không gửi. Mọi template `zalo_dm` khác giữ nguyên ngưỡng 60 phút từng byte. Truy vấn `noop_expired` ở trên cũng liệt kê các dòng này; với chúng `age_s` chỉ để tham khảo, căn cứ hết hạn là giờ bắt đầu của session.

Rủi ro còn lại của ngoại lệ (nói thẳng):

- R1: promotion mà một lần chạy CLI trước ngoại lệ này đã ghi record `age`, hoặc mà dispatcher trước L34 đã kết thúc `delivered`/`noop_expired`, vẫn không được gửi; không có gì mở lại record đó. `zalo_dm` chưa từng được bật dùng thật; DB đang chạy thật (nếu có) chưa được đo.
- R2: promotion còn trước giờ bắt đầu nhưng xếp ngoài **200** event đã ack mới nhất của một lần chạy sẽ nhận record `cap`; thứ tự mới nhất trước đẩy event cũ nhất xuống cuối, và đó cũng là những event nhiều khả năng session đã bắt đầu.
- R3: mỗi promotion đã chuẩn bị của một session đã bắt đầu tốn một lần claim và một lần đọc của function trên, rồi kết thúc `noop_expired` (không gửi).
- R4: số `prepared` trong dòng JSON tóm tắt của CLI gồm cả các promotion có thể vẫn hết hạn lúc gửi.
- R5: phí ghi trong DM promotion gửi muộn là `amount_due` trong payload lúc emit; khoản thanh toán hoặc điều chỉnh được ghi sau lúc emit không được phản ánh. Đọc số dư thực lúc gửi là một thay đổi 0057, làm trong lane riêng (backlog row `zalo-dm-promotion-live-balance-at-delivery`).
- Cửa sổ gửi: giờ bắt đầu được kiểm ở đầu mỗi lần gửi, và lần gửi mang theo hạn chót là giờ bắt đầu: `deliver()` dừng ở mốc sớm hơn giữa 120 s (`ATTEMPT_BUDGET_MS`) và giờ bắt đầu (hết hạn thì retry `delivery_deadline_reached` khi giờ bắt đầu đến trước, `send_budget_exhausted` khi 120 s đến trước), nên một DM chỉ có thể rời hệ thống sau giờ bắt đầu đúng bằng khoảng trễ từ lần đọc giờ bắt đầu (đồng hồ DB) tới lúc `deliver()` bắt đầu, không còn tới 120 s (L44); không trừ lùi một khoảng đệm khỏi giờ bắt đầu vì như vậy thu hẹp cửa sổ owner đã chọn (tới giờ bắt đầu).
- Event type mới: thêm một event type vào `untilSessionStart` cần thêm một nhánh trong function trên, tức một migration; sửa file JSON một mình không đủ.

**Chạy lại và đường raw:** CLI idempotent: chạy lại (`changed=false`) không thêm dòng delivery hay record nào. Đường raw `SELECT outbox_projector_set_enabled('<tên>', true)` **cấm** dùng để bật (chỉ đổi cờ, không backfill); nếu ai lỡ bật bằng đường raw, chạy CLI cho đúng projector đó để khôi phục.

## 3. Rollback

- **Tắt một projector:** vẫn bằng function raw với `false` (chỉ việc tắt đi đường raw; bật luôn là CLI ở bước 2.4):
  `$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT outbox_projector_set_enabled('web_realtime', false)" -c "RESET ROLE"`.
  Có hiệu lực ở lần đọc envelope kế tiếp: tối đa delivery đang gửi dở hoàn tất; dòng vừa claim nằm `claimed` tới khi lease 5 phút hết.
  Tắt **giữ** các delivery đã prepare **trước** lúc tắt (`pending`/`failed`): chúng nằm chờ và chạy tiếp khi bật lại.
  Riêng `zalo_dm`: dòng đã nằm chờ mà event cũ hơn 60 phút ở lúc gửi (bước 2.4) thì **không gửi**: dòng kết thúc `delivered` với `provider_ref = 'noop_expired'`, có record (dòng `projector_deliveries` và một dòng warning trong log worker, xem bước 2.4), không vào dlq; kiểm này nằm ở dispatcher nên chạy cả khi bật lại bằng CLI lẫn bằng đường raw. `web_realtime` và `public_sessions` chạy tiếp như trước.
  Ngoại lệ: dòng `player.promoted` đang chờ không theo mốc 60 phút này mà theo giờ bắt đầu của session (ngoại lệ ở bước 2.4): bật lại trước giờ bắt đầu thì vẫn gửi, tới hoặc qua giờ bắt đầu thì kết thúc `delivered` với `provider_ref = 'noop_expired'` và có record.
  Bật lại bằng CLI là idempotent: chạy lại không thêm dòng delivery hay record nào. Event ack **trong lúc tắt** theo đúng quy tắc của CLI lúc bật lại (bước 2.4): chưa có dòng delivery cho projector đó và còn trong ngưỡng thì được chuẩn bị delivery; cũ hơn ngưỡng hoặc vượt cap thì ghi expiry record (`zalo_dm`: tin đó không gửi, đã có record); riêng `player.promoted` của `zalo_dm` không bao giờ nhận record `age` (projector khác, ví dụ `public_sessions`, giữ ngưỡng tuổi của nó): được chuẩn bị dưới cùng cap 200, và giờ bắt đầu của session quyết định lúc gửi (ngoại lệ R-CLI ở bước 2.4). Riêng `public_sessions`, việc dựng lại projection từ trạng thái canonical đã nằm trong CLI, không còn bước tay.
- **Lệnh tắt bị chờ:** nếu `outbox_projector_set_enabled(<tên>, false)` không trả về ngay, một lần chạy CLI đang giữ dòng của projector đó trong một trong hai transaction ngắn của nó (bước 2.4): transaction bật (khoá dòng, đếm event chưa ack cũ hơn ngưỡng, bật) hoặc transaction backfill (khoá dòng, một lần quét phân loại, hai câu lệnh ghi theo tập, rồi commit). Cách nhanh nhất là ngắt kết nối của CLI từ phía DB: `$OWNER_SQL -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = 'plexco_outbox_projector_enable_cli'"`. Transaction đang mở được rollback ngay, không có dòng delivery hay record nào bị ghi dở, CLI thoát `1`, và lệnh tắt chạy tiếp. Ctrl-C cũng dừng CLI, nhưng Postgres có thể chỉ rollback khi câu lệnh đang chạy kết thúc, nên lệnh tắt chạy tiếp lúc đó chứ không ngay. Phần dựng lại `public_sessions` thì không giữ khoá dòng đó: mỗi tenant một transaction riêng, nên lệnh tắt không phải chờ nó; sau khi tắt, tenant đang dựng dở vẫn chạy xong (như một delivery đang gửi dở), rồi CLI dừng với exit `2` `projector_disabled` ở tenant kế tiếp; backfill và các tenant đã dựng lại trước đó vẫn đã commit, và chạy lại CLI (lần chạy lại bật lại projector) sẽ dựng lại đủ.
- **Tắt hẳn dispatch:** đặt flag `false` (hoặc bỏ) + restart worker: unschedule, không consumer, không LISTEN, không
  draft expiry. Heartbeat báo `false` trong 30 s; `SELECT outbox_dispatch_schedule_live()` về `f` trong 90 s.
- **Gỡ code:** chỉ sau khi flag đã tắt; schema thì revert bằng một migration mới (không sửa `0056`).

## 4. DLQ: kiểm tra và replay (CLI owner, không HTTP, không UI)

Retry: lần thất bại thứ n < 8 chờ **ít nhất** 15 s x 2^(n-1) (tổng 1905 s, khoảng 32 phút); retry đến hạn chỉ chạy ở lần wake
kế tiếp (event mới bất kỳ) hoặc tick cron 1 phút, nên mỗi lần chờ có thể trễ tới khoảng 60 s. Tính cả thời gian claim và từng lần gửi, ở lần kiểm tra thứ 8
trước khi gửi, event cũ nhất tối đa **3225 s (53,75 phút)** = 1905 s backoff + 8 x 60 s chờ wake/tick (claim đầu và 7 retry) + 7 x 120 s gửi, còn cách
ngưỡng 60 phút của `zalo_dm` (bước 2.4) 375 s, nên đường live với worker đang chạy giữ nguyên như trước. Rủi ro còn lại, nói thẳng: worker chết hai lần khi
đang gửi (mỗi lần tốn tới 5 phút lease cộng 60 s tick: một lần còn vừa 375 s, hai lần thì không), hoặc hàng chờ hơn 25 dòng của một projector (mỗi cycle chỉ xử lý
25 dòng, `DEFAULT_BATCH_LIMIT`), có thể đẩy một retry live qua ngưỡng; dòng đó hết hạn có record (`delivered` + `noop_expired`, bước 2.4), đúng thiết kế, không phải lỗi.
Phép tính 375 s ở trên chỉ áp cho ngưỡng 60 phút; với `player.promoted` mốc hết hạn là giờ bắt đầu của session (ngoại lệ ở bước 2.4), nên retry của nó chỉ hết hạn khi session đã bắt đầu (hoặc không đọc được giờ bắt đầu).
Lần thứ 8 vào dlq `attempts_exhausted`; lỗi projector báo terminal vào dlq ngay. Ngưỡng cảnh báo: **> 100** dòng dlq.

```bash
$OWNER_SQL -c "SET ROLE job_definer" -c "SELECT count(*) FROM outbox_dlq_list(NULL, 500)" -c "RESET ROLE"
read -rs PW && export DATABASE_URL_MIGRATION="postgres://plexco:${PW}@localhost:5432/plexco" && unset PW   # gõ password + Enter (không hiện, không vào history) hoặc nạp từ file env chmod 600; không bao giờ gõ thẳng trong lệnh
node scripts/outbox-dlq-replay.mjs list --projector web_realtime --limit 50
node scripts/outbox-dlq-replay.mjs replay --event <event-uuid> --projector web_realtime
```

- Password: cùng luật percent-encode như ghi chú ở bước 2.4; URL không parse được thì CLI dừng trước khi kết nối, thoát `1`, không in URL ra.
- `list`: mỗi dòng dlq một JSON (không có payload), cuối cùng `dlq rows: <n>`.
- `replay`: đưa đúng một delivery dlq về `pending`, `attempts = 0`, ghi một dòng `job_audit_events`
  (`projector_delivery_replayed`); cycle kế tiếp gửi lại. Projector đang tắt thì CLI cảnh báo và dòng nằm chờ.
- Exit `0` xong; `2` từ chối (`invalid_argument`, `delivery_not_found`, `delivery_not_in_dlq`, không ghi gì); `1` lỗi khác.
- Ngoại lệ `zalo_dm`: `replay` một dòng dlq mà event đã cũ hơn ngưỡng 60 phút (replay không đổi `outbox_events.created_at`) vẫn đưa dòng về `pending`, nhưng tới lần claim kế tiếp dispatcher kết thúc nó là `delivered` với `provider_ref = 'noop_expired'`: có record, **không** gửi lại (bước 2.4). Dòng đã hết hạn là `delivered` chứ không phải dlq, nên `replay` từ chối nó: `delivery_not_in_dlq`, exit `2`, không ghi gì.
- Ngoại lệ `player.promoted`: `replay` không bị kiểm tuổi 60 phút; dòng về `pending` và ở lần claim kế tiếp được gửi nếu session chưa bắt đầu, còn nếu đã tới hoặc qua giờ bắt đầu (hoặc không đọc được giờ bắt đầu) thì kết thúc `delivered` với `provider_ref = 'noop_expired'`, có record, không gửi lại (ngoại lệ ở bước 2.4).

## 5. Đo sync lag (chỉ local, trong test process; NFR-1c p95 <= 3 s, p99 <= 10 s)

Không bao giờ bật flag để đo. Test tự chạy wake loop + runner thật trên DB test riêng của nó, rồi ghi một dòng `SYNC_LAG {...}`
(N, p50, p95, p99, max, số cycle) vào file `OUTBOX_SYNC_LAG_OUT`, cho tải ổn định 10 event/s x 60 s và tải burst 50 event/transaction mỗi 5 s:

```bash
bash -c 'export NODE_ENV=test DATABASE_URL_TEST=postgres://plexco:plexco_dev@localhost:5432/plexco_test
OUTBOX_SYNC_LAG_MEASURE=1 OUTBOX_SYNC_LAG_OUT="$PWD/sync-lag.jsonl" pnpm --filter @plexco/bot exec vitest run src/outbox-wake.test.ts -t "sync lag"'
cat sync-lag.jsonl && rm sync-lag.jsonl
```

Sau mỗi lần chạy test: đặt lại password ba role runtime theo `docs/runbooks/local-mvp-smoke.md` mục 5.
