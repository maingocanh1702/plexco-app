# Plexco - GTM Strategy (Internal)

**Ngày cập nhật:** 22/08/2026
**Đối tượng:** Internal team  
**Niche khởi đầu:** Kèo thể thao cộng đồng, ưu tiên cầu lông và pickleball  
**Trạng thái:** Strategy + launch/beta operating plan

> **🔴 Cập nhật 22/08/2026 — GTM RE-SEQUENCING (owner-final). Đọc khối này TRƯỚC mọi đoạn phía dưới.**
>
> **Launch surface đổi từ "bot-first, web là fallback" sang HAI SURFACE SONG SONG: webapp PWA + Zalo bot cùng ra mắt.** App native lùi về sau, không nằm trong launch.
>
> - **Webapp PWA v1** ship với scope cơ bản: **signin/signup · link Zalo bot · session management · session detail · settings**. Đây là *launch scope*, không phải MVP đầy đủ.
> - **Zalo bot** vẫn là acquisition 0-install và là nơi player sinh hoạt hằng ngày, nhưng **không còn phải gánh toàn bộ flow**: thứ gì cần màn hình, danh sách, lịch sử hay cấu hình thì đi qua PWA.
> - **App native = phase sau**, mở khi PWA live và đo được retention. Direction native (DD-69, accepted 18/07) **không đổi**; quyết định hôm nay chỉ đổi **thứ tự** và bỏ web khỏi vai "fallback".
>
> **Cái gì KHÔNG đổi:** thesis host-first · trust-first · fill-slot; ICP; beachhead theo liquidity cell; trust/reputation layer; monetization order (Host Pro trước success fee); north star cross-host player rate. Toàn bộ phần market/ICP/trust bên dưới giữ nguyên giá trị.
>
> ⚠️ **Doc này là strategy, KHÔNG phải authority quyết định hay authority runtime.** Authority của quyết định này là **`../standards/decisions.md` DD-113 ✅** (mint 22/08, `decisions.md` v2.35). Mirror đã propagate **đủ** trong cùng phiên: `../product/ROADMAP.md` **v3.6** (§Positioning · hàng *App Native* · §GTM theo phase · Phụ lục A) · `../00-start-here/HANDOFF.md` **v1.36** · `./native-app-strategy.md` §1 + §Changelog · `../product/BRD.md` **v3.9p** (§14 gate native có ngưỡng đo được; §5.1 phân lớp MVP scope vs phase-1) · `../product/PRD.md` **v2.8o** (header). Phạm vi phase-1 (7 nhóm) là **DD-114**, doc này chỉ mirror. Khi doc này lệch DD-113 thì **DD-113 thắng**.
>
> ⚠️ **Ràng buộc thực thi phải gỡ trước khi launch scope này chạy được:** lệnh owner **13/08 đặt toàn bộ FE ở trạng thái PENDING** (không mở page/component, không track `.pen`). PWA v1 **không thể bắt đầu** khi PENDING còn hiệu lực, và **doc chiến lược không tự gỡ được lệnh đó** — cần chính owner gỡ và ghi vào `decisions.md`. Tương tự: Google login đã merge nhưng **chưa có bằng chứng enable**; tầng nghiệp vụ hiện có **0 API route nghiệp vụ + 0 màn FE** (ba session command mới chỉ là thư viện, chưa surface nào gọi được). Launch scope dưới đây là **đích**, không phải mô tả cái đang có.
>
> *(Hai ghi chú 10/07 và 28/07 bên dưới giữ làm lịch sử. Phần "web fallback" của chúng đã mục; phần kênh/Telegram và Host Pro/provider vẫn còn hiệu lực.)*
>
> **Cập nhật 10/07/2026 (DD-37 / BRD v3.4):** kênh Plexco phase-1 = **Zalo + Facebook Messenger + web** (bỏ Telegram; Messenger nay là phase-1, không còn post-MVP). Các đoạn nhắc Telegram như **nơi cộng đồng đang sinh hoạt** (market reality) giữ nguyên; các đoạn **fallback/kênh Plexco tự xây** đã đổi Telegram→Messenger.
>
> **Cập nhật 28/07/2026 (DD-91 + regional reconciliation):** luận điểm acquisition vẫn là
> host-first và gặp cộng đồng ở external chat; target dài hạn nay là chuyển daily use sang **In-app
> Chat** sau khi safety/runtime/exit gates đóng. Primary plan v1.8 đã `PLAN_READY` tại immutable authority
> `90d292d`, nhưng từng slice vẫn phải strict `CODE_READY` và chưa có runtime, nên không đổi beta promise
> hay launch flow. Host Pro không được quảng bá
> auto-reconcile như capability toàn cầu: mark-paid thủ công là global baseline; auto-reconcile chỉ
> `Available` khi entitlement + market/provider/bank/currency/consent/runtime cùng pass. Current
> provider authority mới là `sepay|apipay` cho Việt Nam.

---

## Executive summary

Plexco nên tiếp tục đi theo hướng **host-first, chat-native, trust-first** — và từ 22/08/2026, **launch bằng hai surface song song: webapp PWA + Zalo bot**.

Luận điểm cốt lõi: Plexco không nên cố kéo người chơi rời Zalo/Telegram/Messenger ngay từ đầu. Cộng đồng đang sống trong chat, vì vậy Plexco cần trở thành lớp vận hành và uy tín nằm ngay trên các group đó. Host dùng Plexco vì công cụ giúp họ gom người, chốt slot, nhắc lịch, quản no-show và lấp chỗ trống. Player đi vào Plexco qua chính các kèo của host, rồi dần có hồ sơ uy tín, lịch sử tham gia và khả năng tìm kèo ngoài nhóm ban đầu.

**Định vị ngắn gọn:**

> Plexco là lớp **trust + fill-slot** cho kèo thể thao cộng đồng ở Việt Nam.

**Không nên định vị là:** "app đặt sân", "mạng xã hội thể thao", hay "marketplace kèo thể thao" ở giai đoạn đầu. Các định vị đó quá rộng, dễ đụng trực diện với booking app, club app và hành vi chat hiện hữu.

**Điều chỉnh 22/08 — vì sao bỏ chữ "bot-first":** "bot-first" đúng ở tầng *hành vi* (gặp cộng đồng trong chat) nhưng đã bị đọc thành *thứ tự build* (web là phương án dự phòng khi Zalo không cho). Hai cách đọc đó dẫn tới hai sản phẩm khác nhau. Cách đọc mới, dứt khoát: **chat là nơi hành động một-nhịp; PWA là nơi chứa trạng thái**. Cả hai ra cùng lúc, không cái nào là dự phòng của cái nào. Chi tiết ranh giới ở §Launch surface sequencing.

**Chiến lược đúng:** come for the host tool, stay for the cross-host trust network.

**North star dài hạn:** `% player tham gia nhiều host trong cùng một liquidity cell` (cross-host player rate).

**Metric sống còn trong beta:** số slot trống được Plexco lấp thành công mỗi tuần.

**Beta gates không được bỏ qua:**

1. Zalo OA/bot flow phải pass technical feasibility. **Fail không còn nghĩa là "chuyển sang web fallback"** — PWA đã là surface launch. Fail Zalo nghĩa là **mất kênh acquisition 0-install**, phải bù bằng Messenger hoặc bằng link/QR dẫn vào PWA, và phải đo lại giả định acquisition chứ không chỉ đổi đường ống kỹ thuật.
2. Player **New** phải có trust bridge: host-vouch, deposit hoặc manual approval.
3. Phải đo được `repeat through Plexco rate` để biết marketplace có bị rò ra ngoài Zalo direct không.
4. Monetization giai đoạn đầu nên ưu tiên Host Pro; success fee chỉ thử khi attribution đủ sạch.
5. **PWA v1 phải đo được install + return rate trước khi bàn app native.** Đây là gate của DD-69, không phải sở thích: native chỉ đáng tiền khi đã có bằng chứng người ta quay lại một surface Plexco sở hữu.

---

## Launch surface sequencing

> Mục này là nội dung của quyết định 22/08/2026. Mọi đoạn khác trong doc nói về surface đều phải đọc qua mục này.

### Phân vai ba surface

| Surface | Vai trò | Sở hữu | Không làm |
|---|---|---|---|
| **Zalo bot (OA)** | Acquisition 0-install + hành động một-nhịp ngay trong group | Tạo kèo nhanh, RSVP/hủy, nhắc lịch, xác nhận có mặt, prompt fill-slot, deep link sang PWA | Danh sách dài, lịch sử, cấu hình nhiều bước, đối soát tiền, hồ sơ |
| **Webapp PWA** | Nơi chứa **trạng thái** và mọi màn có cấu trúc | Tài khoản, quản lý kèo, chi tiết kèo, cài đặt, liên kết kênh; về sau: hồ sơ uy tín, sổ tiền, fill-slot queue | Không cố thay chat; không ép player mở mỗi ngày ở giai đoạn đầu |
| **App native** | Phase sau | Push nền, trải nghiệm host hằng ngày, offline read-only | Không nằm trong launch; **không hứa với host/player**, không xuất hiện trong sales script |

Câu kiểm một dòng khi phân vân một feature thuộc surface nào:

> Thao tác **kết thúc gọn trong một tin nhắn** → bot. Thứ cần **nhìn nhiều hơn một dòng, hoặc sửa được về sau** → PWA.

### Webapp PWA v1 — launch scope

Đúng năm khối, không hơn:

| # | Khối | Nội dung tối thiểu | Vì sao nó ở launch |
|---|---|---|---|
| 1 | **Signin / signup** | Đăng nhập tài khoản Plexco; là root của mọi thứ còn lại | Không có account thì không có trạng thái để chứa |
| 2 | **Link Zalo bot** | Nối account web ⇄ identity Zalo, có bằng chứng nối đúng một người | Đây là **khớp nối** giữa hai surface; thiếu nó thì hai surface là hai sản phẩm rời |
| 3 | **Session management** | Danh sách kèo của host: tạo/sửa/publish/announce/đóng, xem ai đã nhận slot | Là thứ chat làm dở nhất |
| 4 | **Session detail** | Một kèo: roster, slot còn trống, trạng thái, thao tác của host | Nơi host thực sự làm việc |
| 5 | **Settings** | Hồ sơ tối thiểu, kênh đã liên kết, tuỳ chọn nhắc, ngôn ngữ | Cấu hình nhiều bước không thể sống trong chat |

Điều kiện để được gọi là **PWA** chứ không phải "web page": manifest + service worker + installable + mobile-first 375px. Nếu launch mà chưa có installable shell thì **không được gọi là PWA** trong bất kỳ tài liệu nào — lúc đó nó chỉ là web app, và mọi lập luận dựa trên "add-to-home-screen" (nhất là push trên iOS) đều rỗng.

### Negative scope của launch — viết ra để khỏi trôi

Không có trong launch: marketplace discovery public · in-app chat · feed/kudos · đối soát chuyển khoản tự động (mark-paid thủ công là baseline toàn cầu) · rating công khai · tournament/club tools · web push · **app native**.

**Fill-slot không thuộc PWA v1.** Nó vào đúng chỗ cũ trong beta plan (Weeks 5-6), sau khi có attendance data. Đưa fill-slot vào launch scope là cách nhanh nhất để launch trượt.

### Vì sao đổi thứ tự — năm lý do

1. **"Fallback" là một cái bẫy tổ chức.** Thứ được gắn nhãn fallback thì không ai build, cho tới lúc cần gấp thì không kịp. Suốt giai đoạn vừa rồi web nằm ở vai đó và kết quả đo được là **0 màn FE**.
2. **Thứ Plexco bán cho host là trạng thái**, không phải tin nhắn: ai đi, ai nợ, ai hay no-show, kèo nào còn slot. Trạng thái cần màn hình để đọc; nhồi vào chat thì host vẫn phải mở Google Sheet.
3. **Zalo OA là rủi ro nhà cung cấp.** Quota, rate limit, quyền gửi tin và policy nằm ngoài tầm kiểm soát. Có PWA từ ngày đầu tháo bỏ single point of failure của toàn bộ GTM — đây là lý do mạnh nhất trong năm lý do.
4. **PWA rẻ hơn native ở mọi trục đang quan trọng:** 0 store review, deploy tức thì, 0 install friction cho player đến từ link trong group.
5. **Native cần API/auth/push boundary ổn định** (xem `./native-app-strategy.md` §3–4: client-safe contracts, `/api/v1`, bearer/refresh, device push riêng). Build native trước khi có surface web ổn định là trả nợ kiến trúc bằng tiền mặt.

### Cái giá phải trả — đọc trước khi ăn mừng

- **Hai surface = hai lớp UX, hai lớp i18n, hai lớp trạng thái lỗi**, trên một solo dev. Đây là chi phí thật, không phải rủi ro giả định.
- **PWA v1 buộc phải kéo FE ra khỏi PENDING**, tức là rút năng lực đang dồn cho BE session commands. Không thể có cả hai cùng tốc độ.
- **Launch scope này không tự sinh liquidity.** Signin + session CRUD không đủ để host bỏ Google Sheet. Giá trị vẫn nằm ở **reminder + attendance ledger**, và hai thứ đó phải bám ngay sau v1 — nếu để trôi sang "v2 nào đó" thì launch chỉ là demo.
- **Hai surface làm loãng chỉ số.** Từ nay mọi metric activation phải khai rõ đo trên surface nào; gộp lại là tự lừa.

### Gate để mở bàn app native

Giữ nguyên tinh thần DD-69, viết rõ thành ngưỡng đo được (working hypotheses, không phải cam kết):

| Điều kiện | Ngưỡng đề xuất |
|---|---|
| PWA v1 live và có host dùng thật | ≥ 5 host vận hành ≥ 4 tuần liên tục trên PWA |
| Có bằng chứng quay lại | Host weekly return rate ≥ 60% trong 4 tuần |
| Installable thật sự được dùng | PWA install rate ≥ 30% host, đo tách iOS/Android |
| API/auth boundary đủ ổn định | `/api/v1` + bearer/refresh + client-safe contracts đã land |
| Có lý do native cụ thể | Nêu được ≥ 1 capability push/offline mà PWA đo được là **không** làm nổi (không phải "cho xịn") |

Chưa đủ các điều kiện này thì native ở lại **phase sau**, và không được nhắc trong sales script cho host.

---

## Verdict

**Đánh giá tổng thể:** 7.5/10 - thesis đúng, nhưng chỉ đáng scale sau khi chứng minh được local liquidity trong một cụm hẹp.

Chiến lược hiện tại có 3 điểm mạnh thật:

1. **Wedge vào đúng pain của host.** No-show, thiếu người, chốt slot và nhắc lịch là vấn đề lặp lại hàng tuần.
2. **Distribution ăn theo group có sẵn.** Host tự kéo demand qua cộng đồng hiện hữu, giảm phụ thuộc paid acquisition.
3. **Moat không nằm ở tool, mà ở trust graph.** Tool có thể bị copy; lịch sử uy tín cross-host khó copy hơn vì cần thời gian tích lũy.

Nhưng để chạy được, Plexco phải giải quyết 6 hard gates:

1. **ICP phải hẹp hơn.** "Host" là một nhóm quá rộng.
2. **Listing phải được đóng gói lại thành fill-slot có kiểm soát.** Host không muốn public hết kèo và member của mình.
3. **Density phải có ngưỡng cụ thể.** Marketplace chết vì rải mỏng.
4. **Trust cold-start phải có bridge.** Fill-slot cần trust ngay lúc đa số player còn là New.
5. **Bot-first phải qua feasibility check.** Zalo OA/OpenAPI có quota, rate limit, quyền gửi tin và policy riêng; không thể giả định giống Telegram.
6. **Retention phải chống bypass.** Nếu host/player gặp nhau rồi đi thẳng qua Zalo, marketplace value sẽ rò khỏi hệ.

---

## Market reality

### 1. Chat là hạ tầng xã hội, không phải đối thủ trực tiếp

Zalo tiếp tục là nền tảng nhắn tin đại chúng ở Việt Nam. Theo thông tin công khai của Zalo/VietnamNet, Zalo đạt khoảng 78.3 triệu MAU trong nửa đầu 2025 và xấp xỉ 2 tỷ tin nhắn mỗi ngày. Điều này củng cố giả định: kèo thể thao cộng đồng sẽ tiếp tục được tạo, bàn và chốt trong chat.

Hệ quả chiến lược:

- Bot Zalo là điểm chạm rẻ nhất cho hành động một-nhịp: tạo kèo, RSVP, nhắc, xác nhận.
- **Web PWA không phải fallback** mà là nơi chứa đúng thứ chat làm dở: danh sách, lịch sử, hồ sơ, cấu hình. Ranh giới cụ thể ở §Launch surface sequencing.
- Không nên bắt player "chuyển nhà" sang Plexco quá sớm. PWA có mặt từ launch **không** đồng nghĩa ép player mở PWA mỗi ngày — ngày đầu player vẫn sống trong chat, PWA là nơi họ đến khi cần xem hoặc sửa.

### 2. Pickleball/cầu lông là niche hợp lý nhưng phải đánh theo cụm

Racket sports có tần suất chơi lặp lại, nhóm nhỏ, skill matching quan trọng và no-show gây thiệt hại rõ. Đây là cấu trúc tốt cho trust graph.

Pickleball đặc biệt đáng thử vì thị trường đang tăng nhanh và có nhiều cụm sân/cộng đồng mới. Dữ liệu từ Metric.vn được Dân trí/VnEconomy trích dẫn cho thấy chi tiêu TMĐT cho sản phẩm pickleball đạt khoảng **228,7 tỷ đồng trong Q1/2025** và **510,6 tỷ đồng trong 6 tháng đầu 2025**, vượt xa mức **271,9 tỷ đồng của cả năm 2024**. Đây là proxy tốt cho demand tiêu dùng, nhưng không đồng nghĩa trực tiếp với liquidity kèo/sân. Các directory như Pickleheads cũng ghi nhận nhiều địa điểm/court tại TP.HCM, còn Reclub có các club và hoạt động pickleball công khai tại Việt Nam. Đây là tín hiệu đủ mạnh để chọn một cụm beta, nhưng chưa đủ để kết luận thị trường toàn quốc đã sẵn sàng — vẫn phải đánh theo cụm hẹp.

Hệ quả chiến lược:

- Không launch theo "Việt Nam" hoặc "TP.HCM".
- Chọn một liquidity cell rất hẹp: một môn, một khu vực, một vài khung giờ, một vài level.
- Ví dụ ứng viên nếu bắt đầu ở TP.HCM: pickleball Thảo Điền/An Phú hoặc cầu lông trong một cụm quận có nhiều sân và host active.

### 3. Đối thủ thật không chỉ là Zalo

Plexco cần tránh định vị rộng vì đã có các nhóm sản phẩm gần kề:

| Nhóm | Ví dụ | Họ mạnh ở đâu | Plexco nên tránh | Plexco nên khác biệt |
|---|---|---|---|---|
| Chat app | Zalo, Telegram, Messenger | Group, thói quen, thông báo | Thay thế group | Bot + identity + trust layer |
| Venue booking | ALOBO, HaloSport, app quản lý sân | Lịch sân, thanh toán, venue inventory | Đặt sân đại trà | Lấp slot người chơi cho kèo đã có sân |
| Club/community app | Reclub | Club, meet, tournament, discovery | Social/community quá rộng | Trust graph local + fill-slot embedded in chat |
| Manual host workflow | Google Sheet, note, chat poll | Linh hoạt, miễn phí | Ép quy trình phức tạp | Automation nhẹ, dùng ngay trong chat |

**Chiến lược cạnh tranh:** không đấu trực diện booking/club app ở giai đoạn đầu. Plexco thắng bằng việc giải một job cực cụ thể: host thiếu người đáng tin cho kèo gần diễn ra.

---

## ICP khởi đầu

### Primary ICP

**Local recurring host** - người tổ chức kèo cá nhân/nhóm nhỏ, có cộng đồng riêng và chạy nhiều buổi mỗi tuần.

Đặc điểm:

- Tổ chức 2-10 buổi/tuần.
- Có group Zalo/Telegram/Messenger đang hoạt động.
- Thường xuyên gặp vấn đề thiếu người, hủy sát giờ, no-show hoặc lệch trình.
- Có quyền ảnh hưởng trong cộng đồng.
- Sẵn sàng thử bot nếu không làm rối workflow hiện tại.
- Không nhất thiết là chủ sân hay club chuyên nghiệp.

Tại sao chọn nhóm này trước:

- Pain rõ và lặp lại.
- Quyết định dùng tool nhanh hơn venue/club lớn.
- Mang theo demand sẵn có.
- Tạo dữ liệu attendance/no-show nhanh.
- Có thể onboarding thủ công trong beta.

### Secondary ICP

**Club operator, coach, hoặc host chuyên nghiệp.**

Nhóm này có volume cao hơn nhưng yêu cầu sản phẩm sâu hơn: member management, phân level, lịch nhiều sân, thanh toán, giải đấu, báo cáo. Nên tiếp cận sau khi workflow cho host nhỏ đã sắc.

### ICP chưa nên ưu tiên

- Player cá nhân chưa thuộc cộng đồng nào.
- Chủ sân chỉ quan tâm booking court.
- Tournament organizer lớn.
- Corporate wellness/team-building.
- Social sports app dùng cho nhiều môn ngay từ đầu.

---

## Beachhead strategy

### Liquidity cell

Plexco không nên đo thị trường theo thành phố. Nên đo theo **liquidity cell**:

> 1 môn + 1 cụm địa lý + 1-2 nhóm trình độ + vài khung giờ chơi lặp lại.

Ví dụ:

- Pickleball, Thảo Điền/An Phú, beginner-intermediate, tối thứ 2-6.
- Cầu lông, Bình Thạnh/Phú Nhuận, trình trung bình, tối weekday.
- Pickleball, Phú Mỹ Hưng, mixed level, cuối tuần.

### Tiêu chí chọn cell đầu tiên

Chọn cell có đủ 6 điều kiện:

1. Có ít nhất 8-12 host active có thể tiếp cận trực tiếp.
2. Mỗi host tổ chức ít nhất 2 buổi/tuần.
3. Có pain thiếu người/no-show thật, không chỉ nice-to-have.
4. Có sân/court gần nhau để player chấp nhận di chuyển.
5. Có group chat đang vận hành sẵn.
6. Có một vài host có uy tín để làm champion.

### Ngưỡng để bật discovery

Không bật discovery đại trà trước khi đạt ngưỡng local density.

Ngưỡng beta đề xuất cho một cell:

| Điều kiện | Ngưỡng tối thiểu |
|---|---:|
| Weekly active hosts | 15+ |
| Sessions tạo qua Plexco/tuần | 40+ |
| Registered players trong cell | 300+ |
| Sessions có slot trống/tuần | 20+ |
| Host opt-in fill-slot | 35%+ sessions eligible |
| External slot fill thành công | 20+ slots/tuần |
| Disputed no-show | <5% attendance events |

> Lưu ý phép tính: `40 sessions ÷ 15 WAH ≈ 2.7 buổi/host/tuần`. Sàn dashboard "2+ sessions/host/week" là **mức tối thiểu mỗi host**, còn 40 là **tổng cell** (một số host active chạy 3-5 buổi/tuần kéo trung bình lên). Hai con số này nhất quán, không mâu thuẫn.

Nếu chưa đạt các ngưỡng này, Plexco vẫn nên hoạt động như host tool + trust ledger, chưa nên nói quá nhiều về marketplace.

---

## Core wedge

### Job-to-be-done của host

> Khi kèo còn thiếu người hoặc sợ người lạ no-show, tôi muốn tìm người phù hợp và đáng tin mà không phải spam nhiều group hay tự nhớ lịch sử từng người.

### Job-to-be-done của player

> Khi muốn chơi đều hơn, tôi muốn tìm kèo hợp lịch, hợp trình và có host đáng tin mà không phải lục nhiều group chat.

### Product promise

Cho host:

> Plexco giúp bạn lấp slot trống bằng người chơi có lịch sử tham gia, được bảo lãnh hoặc có cơ chế cam kết rõ ràng.

Cho player:

> Plexco giúp bạn tìm kèo phù hợp và xây hồ sơ uy tín để dễ được nhận vào kèo tốt hơn.

### Minimum product wedge

Trong beta, chỉ cần tập trung vào 5 workflow — và từ 22/08 mỗi workflow phải khai rõ **nó sống ở surface nào**:

| # | Workflow | Bot Zalo | Webapp PWA | Có trong launch? |
|---|---|---|---|---|
| 1 | **Tạo kèo** (môn, sân/khu vực, thời gian, level, slot, giá) | Tạo nhanh một-nhịp | Tạo đầy đủ + sửa + publish/announce | ✅ cả hai |
| 2 | **RSVP + waitlist** | Player bấm tham gia/rút lui ngay trong chat | Xem roster, ai chờ, ai đã nhận slot | ✅ bot; PWA ở mức đọc |
| 3 | **Nhắc lịch + cutoff** | Nhắc và xác nhận | Cấu hình rule nhắc/cutoff trong settings | 🟡 bám ngay sau v1 |
| 4 | **Attendance / no-show ledger** | Host chốt nhanh sau buổi chơi | Sổ lịch sử, sửa sai, xem theo player | 🟡 bám ngay sau v1 |
| 5 | **Fill-slot có kiểm soát** | Prompt khi thiếu người | Host approval queue | ❌ Weeks 5-6, không thuộc launch |

Hai dòng 🟡 là **điều kiện để launch có ý nghĩa**, không phải nice-to-have: v1 chỉ có account + session CRUD thì host chưa có lý do bỏ cách làm cũ.

Không nên build quá sớm:

- Social feed.
- Full marketplace toàn thành phố.
- Full venue booking system.
- Tournament platform hoàn chỉnh.
- Chat replacement.
- Gamification nặng.

---

## Listing strategy: từ "public listing" sang "fill-slot"

### Vấn đề

"Bật listing" nghe như public kèo và mở cửa cho người lạ. Với host, điều này tạo 3 nỗi sợ:

1. Mất member sang host khác.
2. Người lạ vào làm lệch trình hoặc phá vibe nhóm.
3. Bị lộ thông tin group, sân, lịch cố định.

Vì vậy, mắt xích yếu nhất không phải chỉ là UI toggle. Vấn đề là framing và control.

### Cách đóng gói mới

Không gọi là "list kèo". Gọi là:

> Plexco Fill: tìm người phù hợp cho slot trống.

Các trạng thái visibility:

| Trạng thái | Ý nghĩa | Khi dùng |
|---|---|---|
| Private | Chỉ người trong link/group thấy | Kèo nội bộ, không thiếu người |
| Fill-only | Plexco đề xuất người ngoài nhóm nhưng host duyệt | Default cho beta |
| Public | Hiện trên discovery công khai | Chỉ bật khi cell đã có density |

### Control host cần có

Host phải kiểm soát được:

- Số slot mở cho người ngoài.
- Level/skill range.
- Giới tính/độ tuổi nếu cộng đồng cần.
- Player phải có no-show band tối thiểu.
- Host duyệt thủ công hoặc auto-accept.
- Ẩn danh sách member nội bộ.
- Không hiển thị group chat gốc.
- Chặn player cụ thể.
- Chỉ mở fill đến deadline nhất định.

### Moment để gợi ý fill-slot

Bot nên gợi ý đúng lúc:

- Kèo còn thiếu người sau X giờ.
- Sắp đến cutoff mà chưa đủ minimum players.
- Có player rút lui sát giờ.
- Host tạo kèo repeat có pattern thường thiếu 1-2 slot.

Copy gợi ý:

> Kèo còn 2 chỗ. Bật Plexco Fill để nhận người có lịch sử tốt, được host khác bảo lãnh hoặc đặt cọc lần đầu?

---

## Trust and reputation layer

### Vì sao đây là moat

Plexco không nên coi tool quản lý kèo là moat. Tool có thể bị copy bởi booking app, club app hoặc chính chat platform. Moat thật sự là dữ liệu cross-host:

- Player có tham gia đúng hẹn không?
- Player hủy có báo trước không?
- Player hợp level nào?
- Host có tổ chức đúng như mô tả không?
- Kèo nào đáng tin?
- Người chơi nào được nhiều host nhận lại?

Khi dữ liệu này đi theo player qua nhiều host, Plexco mở khóa được điều quan trọng nhất của marketplace: host dám nhận người lạ.

### Data primitives nên thu từ đầu

Không cần profile phức tạp. Cần data đúng:

| Primitive | Ai tạo | Dùng để làm gì |
|---|---|---|
| RSVP | Player | Ý định tham gia |
| Cancel time | Player/system | Phân biệt hủy sớm/hủy muộn |
| Attendance | Host xác nhận | Tính reliability |
| Player confirmation | Player xác nhận/phản hồi | Chống host mark sai |
| Skill tag | Host/player | Matching trình |
| Repeat participation | System | Đo loyalty và cross-host |
| Host reliability | Player/system | Player chọn host |
| Host vouch | Host bảo lãnh player mới | Bridge trust cho player chưa có lịch sử |
| Deposit status | Player/system | Giảm rủi ro khi nhận player New |

### No-show score không nên là con số thô

Không nên hiển thị kiểu "no-show rate 18%" ngay từ đầu vì dễ gây tranh cãi và làm player phòng thủ. Nên dùng band:

- **New** - chưa đủ dữ liệu.
- **Reliable** - tham gia ổn định.
- **Watch** - có vài lần hủy muộn/no-show.
- **Restricted** - cần host duyệt thủ công hoặc deposit.

Nội bộ vẫn có thể tính score chi tiết, nhưng UI beta nên dùng ngôn ngữ ít gây đối đầu.

### Trust cold-start bridge

Vấn đề lớn nhất của fill-slot là nghịch lý cold-start: lúc host cần trust nhất là lúc player ngoài nhóm chưa có dữ liệu. Nếu bật Plexco Fill ở tuần 5-6, phần lớn external players vẫn sẽ ở band **New**, nên không thể chỉ dựa vào no-show score.

Plexco cần một cơ chế bắc cầu cho player New:

| Bridge | Cách hoạt động | Khi dùng |
|---|---|---|
| Host-vouch | Host A bảo lãnh player từng đi kèo với mình, nhưng chưa đủ data cross-host | Player mới với platform nhưng đã có trust local |
| First-time deposit | Player New đặt cọc nhỏ, hoàn/khấu trừ sau khi attended | Kèo có rủi ro no-show cao hoặc host chưa quen player |
| Manual approval | Host xem profile tối thiểu và duyệt từng request | Default trong beta |
| Invite-only external slot | Host mở fill cho player được giới thiệu bởi host/player đã tin cậy | Cell còn nhỏ, cộng đồng quen nhau |

Default beta rule:

- **Reliable/Watch/Restricted** dùng reliability band để host quyết định.
- **New** phải có ít nhất một bridge: host-vouch, deposit, hoặc host manual approval.
- Không auto-accept player New trong giai đoạn beta.
- Sau 2-3 attended sessions, player New bắt đầu được nâng band nội bộ.

Bridge này phải được thiết kế như một phần của fill-slot, không để ở dạng open question. Nếu không, Week 5-6 sẽ đo sai: fill-slot fail không hẳn vì marketplace không có nhu cầu, mà vì trust chưa đủ để host dám nhận người lạ.

### Attendance taxonomy

| Trạng thái | Định nghĩa | Ảnh hưởng score |
|---|---|---|
| Attended | Có mặt | Tăng reliability |
| Early cancel | Hủy trước cutoff | Không phạt hoặc phạt nhẹ |
| Late cancel | Hủy sau cutoff | Phạt vừa |
| No-show | Không đến, không báo | Phạt mạnh |
| Host canceled | Host hủy | Không phạt player |
| Weather/venue issue | Bất khả kháng | Không phạt hoặc loại khỏi score |

### Anti-fraud và dispute

Cần cơ chế chống lạm dụng từ beta:

1. Host chỉ mark no-show với player đã RSVP.
2. Player nhận thông báo sau khi bị mark late cancel/no-show.
3. Player có quyền dispute trong 24-48h.
4. Host có abuse score nếu nhiều dispute bị overturn.
5. Rating chỉ mở sau khi session kết thúc.
6. Rating hai chiều nên reveal trễ để giảm trả đũa.
7. Không cho host sửa attendance vô hạn sau khi chốt.

Nguyên tắc: trust data phải đủ đáng tin để host dựa vào, nhưng không được biến thành hệ thống bêu tên.

---

## Growth loops

### Loop 1: Host operations loop

Host tạo kèo -> player RSVP -> bot nhắc lịch -> host chốt attendance -> host thấy kèo dễ quản hơn -> host tạo kèo tiếp.

Metric:

- Time to first session.
- % host tạo session thứ 2 trong 7 ngày.
- Weekly active hosts.
- Sessions/host/week.

### Loop 2: Player identity loop

Player RSVP qua bot -> tạo hồ sơ tối thiểu -> đi kèo đúng hẹn -> nhận reliability band tốt -> dễ được host khác nhận hơn -> tham gia thêm kèo.

Metric:

- Bot RSVP to registration conversion.
- % player có attendance event đầu tiên.
- % player có 3 attended sessions.
- % player được accepted bởi host mới.

### Loop 3: Fill-slot liquidity loop

Host thiếu người -> bật Plexco Fill -> player ngoài nhóm request/được đề xuất -> host accept -> slot được lấp -> host tin Plexco hơn -> mở fill-slot nhiều hơn.

Metric:

- Fill-slot prompt conversion.
- Requests per open slot.
- Acceptance rate.
- Fill success rate.
- Time to fill.
- Repeat external players.

### Loop 4: Cross-host network loop

Player có reliability tốt ở Host A -> Host B chấp nhận -> player chơi nhiều host -> dữ liệu trust dày hơn -> discovery đáng tin hơn -> nhiều host bật fill hơn.

Metric:

- Cross-host player rate.
- Median hosts per active player.
- % sessions có player ngoài nhóm.
- % external players được mời lại.

---

## GTM motion

### Motion 1: Concierge host acquisition

Beta không nên chạy ads rộng. Nên làm thủ công và dày:

1. Chọn một liquidity cell.
2. Lập danh sách 50-80 host tiềm năng.
3. Phỏng vấn 15-20 host về workflow hiện tại.
4. Chọn 20-30 host có pain rõ nhất để onboarding.
5. Setup bot, template kèo và rules cho từng host.
6. Theo sát 2 tuần đầu như customer success.

Script bán cho host:

> Anh/chị vẫn giữ group Zalo như cũ. Plexco chỉ giúp tạo kèo, nhắc lịch, ghi nhận ai hay no-show và tìm người đáng tin khi kèo thiếu slot.

### Motion 2: Player acquisition qua RSVP

Player không cần được bán bằng "hãy tải app mới". Entry nên là hành động cụ thể:

- "Bấm giữ slot."
- "Xác nhận có mặt."
- "Xem kèo của bạn."
- "Tạo hồ sơ để host duyệt nhanh hơn."
- "Giữ reliability tốt để được nhận vào kèo khác."

Registration nên progressive, và từ 22/08 nó **kết thúc ở PWA chứ không ở app store**:

1. RSVP bằng link/bot — không cần tài khoản.
2. Xác thực Zalo identity / số điện thoại.
3. Tạo account Plexco trên PWA (signin/signup) khi cần xem lịch riêng hoặc nhận slot ở kèo lạ.
4. **Link Zalo bot ⇄ account** — bước quyết định: từ đây một người là một hồ sơ xuyên hai surface.
5. Thêm tên hiển thị, level/môn/khu vực khi cần.
6. **Add-to-home-screen (PWA)** khi đã có recurring value. Không nhắc app native với player ở giai đoạn này.

Bẫy cần tránh: đẩy bước 3 lên quá sớm. Nếu player phải tạo account trước khi được giữ slot, lợi thế 0-install của bot mất sạch.

### Motion 3: Host champion program

Chọn 3-5 host có uy tín trong cell làm champion.

Incentive:

- Concierge setup miễn phí.
- Priority support.
- Badge "Founding host".
- Early access fill-slot.
- Dashboard riêng về attendance và slot filled.
- Có thể miễn phí Pro trong 6-12 tháng.

Mục tiêu không phải vanity endorsement. Mục tiêu là tạo trust ban đầu trong cộng đồng local.

### Motion 4: Venue partnership sau, không trước

Venue có thể giúp phân phối, nhưng nếu bắt đầu với venue booking, Plexco dễ bị kéo sang bài toán quản lý sân. Nên tiếp cận venue sau khi chứng minh host/player liquidity.

Use case venue phù hợp về sau:

- Venue giới thiệu Plexco cho các host thường xuyên thiếu người.
- Plexco đẩy kèo có slot trống tại venue.
- Venue package cho tournament/league.
- Booking integration nếu đã có demand.

---

## 8-week beta plan

### Pre-beta: launch readiness gate

Từ 22/08, beta **không bắt đầu** khi chưa có hai surface tối thiểu chạy được. Điều kiện vào Week 0:

| Điều kiện | Bằng chứng phải có |
|---|---|
| Lệnh FE PENDING (13/08) đã được owner gỡ | Ghi trong `../standards/decisions.md`, không phải hiểu ngầm |
| Signin/signup dùng được trên thiết bị thật | Đăng nhập thành công Safari iOS + Chrome Android, không phải "đã merge" |
| Link Zalo bot ⇄ account chạy end-to-end | Một người thật nối được hai identity, kiểm chứng được ở DB |
| Session management + detail có thao tác thật | Host tạo → publish → xem roster, qua API route thật, không phải gọi thư viện |
| Bot Zalo tạo kèo + RSVP được | Một kèo thật đi trọn vòng trong group thật |

Chưa đủ thì Week 0 vẫn chạy được phần **phi kỹ thuật** (chọn cell, phỏng vấn host, host CRM) — nhưng không được onboard host lên sản phẩm và không được tính là Week 1.

### Week 0: Cell selection and setup

Mục tiêu:

- Chọn 1 môn + 1 cụm địa lý.
- Xác định 50-80 host tiềm năng.
- Phỏng vấn nhanh 15-20 host.
- Chốt 20-30 host beta.
- Chuẩn hóa template kèo, attendance rules và cutoff rules.
- Validate Zalo OA/bot constraints trước khi cam kết bot-first trên Zalo.

Technical validation bắt buộc:

- Xác nhận flow nào chạy được qua Zalo OA, **flow nào thuộc về PWA theo thiết kế** (không phải "phải lùi về web vì Zalo không cho").
- Kiểm tra rate limit, quota tin nhắn, quyền gửi tin, webhook và chính sách template nếu dùng notification.
- Đo chi phí/khả năng gửi reminder, RSVP confirmation, attendance dispute và fill-slot prompt.
- **Đo đường nối hai surface:** deep link từ bot sang PWA, và link account ⇄ Zalo identity. Đây là điểm gãy dễ xảy ra nhất của mô hình hai surface.
- Nếu Zalo không cho automation đủ mượt trong cell: bù bằng **Messenger** hoặc link/QR dẫn thẳng vào PWA, **và ghi nhận đó là mất kênh acquisition**, không phải đổi đường ống kỹ thuật.

Output:

- Beta cell brief.
- Host CRM.
- Onboarding script.
- Bot flow v1.
- **PWA v1 live** với đúng 5 khối launch scope, có manifest + service worker.
- Zalo feasibility memo: allowed flows, blocked flows, quota/cost assumptions, kênh bù nếu mất Zalo.
- Metrics dashboard v1 — **tách theo surface** ngay từ đầu, không gộp.

### Weeks 1-2: Host activation

Mục tiêu:

- Onboard host thủ công.
- Mỗi host tạo ít nhất 1 session thật.
- Giảm friction trong tạo kèo và RSVP.

Target:

- 20+ hosts onboarded.
- 12+ weekly active hosts.
- 30+ sessions tạo qua Plexco/tuần.
- 50% host tạo session thứ 2 trong 7 ngày.

### Weeks 3-4: Attendance and trust ledger

Mục tiêu:

- Bắt đầu thu attendance/no-show data.
- Player có hồ sơ tối thiểu.
- Host thấy giá trị của no-show ledger.

Target:

- 200+ registered players.
- 300+ attendance events.
- 70% sessions được host chốt attendance.
- <5% attendance events bị dispute.

### Weeks 5-6: Controlled fill-slot

Mục tiêu:

- Bật Plexco Fill cho host chọn lọc.
- Không public discovery rộng.
- Đo host có sẵn sàng nhận người ngoài nhóm không.
- Dùng host-vouch/deposit/manual approval để xử lý player New.

Target:

- 35% eligible sessions bật fill-slot.
- 2+ requests per open slot.
- 50%+ request acceptance rate.
- 20+ external slots filled/tuần.
- 30% external players được mời lại hoặc quay lại.
- 80%+ accepted New players có bridge rõ ràng: host-vouch, deposit, hoặc manual approval.

### Weeks 7-8: Discovery decision

Mục tiêu:

- Quyết định có bật discovery public trong cell hay không.
- Chọn scale path: dày thêm cell hiện tại hay mở cell thứ hai.

Target:

- 15+ weekly active hosts.
- 40+ sessions/tuần.
- 300+ registered players.
- 10-15% active players đã tham gia từ 2 host trở lên.
- Host 4-week retention >=60%.

### Decision gates

| Kết quả | Hành động |
|---|---|
| Host retention tốt, fill-slot tốt | Dày thêm cell hiện tại, bắt đầu public discovery có kiểm soát |
| Host retention tốt, fill-slot yếu | Giữ làm host SaaS/tool, sửa incentive/visibility |
| Host retention yếu, fill-slot tốt | Xem lại host tool UX, có thể player-led hơn |
| Cả hai yếu | Pivot ICP, cell hoặc sport trước khi build thêm |

---

## Metrics dashboard

| Tầng | Metric | Ý nghĩa | Beta target |
|---|---|---|---:|
| Supply | Weekly active hosts | Tool có được dùng thật không | 15+ |
| Supply | Sessions/host/week | Host có dùng lặp lại không | 2+ |
| Activation | Time to first session | Onboarding có nhẹ không | <24h |
| Activation | Host second-session rate | Có repeat behavior không | 50%+ |
| Surface | Host tạo kèo trên PWA / tổng kèo | PWA có được dùng thật hay chỉ là màn đăng nhập | 40%+ |
| Surface | Link Zalo ⇄ account rate (host) | Hai surface có thành một sản phẩm không | 80%+ |
| Surface | PWA install rate, tách iOS/Android | Add-to-home có xảy ra không (điều kiện của mọi lập luận push) | 30%+ host |
| Surface | Host weekly return to PWA | Có lý do quay lại surface Plexco sở hữu không — **gate của app native** | 60%+ |
| Demand | RSVP to registration conversion | Bot có kéo player vào được không | 40%+ |
| Demand | Player first attendance rate | Player có hoàn tất vòng đầu không | 60%+ |
| Trust | Sessions with attendance closed | Dữ liệu có đủ dày không | 70%+ |
| Trust | Disputed attendance rate | Trust data có bị tranh cãi không | <5% |
| Trust | Accepted New players with bridge | Cold-start có được xử lý không | 80%+ |
| Liquidity | Eligible sessions using fill-slot | Host có dám mở cửa không | 35%+ |
| Liquidity | External slots filled/week | Plexco tạo giá trị marketplace thật không | 20+ |
| Liquidity | Time to fill slot | Fill có kịp trước giờ chơi không | TBD by cell |
| Network | Cross-host player rate | Network effect có bật không | 10-15% |
| Retention | Repeat through Plexco rate | Host/player có quay lại hệ thay vì bypass không | 60%+ |
| Retention | 4-week host retention | Supply có bền không | 60%+ |

North star dài hạn vẫn là **cross-host player rate**, nhưng beta không được chỉ nhìn north star. Trước khi có network effect, metric quan trọng nhất là **external slots filled/week**.

---

## Positioning and messaging

### Internal positioning

Plexco là:

- Host operations tool.
- Trust ledger.
- Fill-slot network.
- Sau đó mới là marketplace.

Plexco không phải:

- App chat thay Zalo.
- App đặt sân thuần túy.
- Social network thể thao đại trà.
- Tournament SaaS ngay từ đầu.
- **App native** — ít nhất là chưa. Không nói "app" với host/player khi thứ họ sẽ dùng là bot + web installable.

**Cách gọi tên surface khi nói ra ngoài:** "bot Zalo" và "trang quản lý" (hoặc "web Plexco"). Tránh chữ "PWA" — đó là từ nội bộ. Tránh chữ "app" cho tới khi thật sự có app.

### Host-facing message

Primary:

> Lấp slot trống bằng người chơi đáng tin hoặc có cam kết rõ ràng, ngay trong group bạn đang dùng.

Secondary:

- Tạo kèo nhanh hơn.
- Nhắc lịch tự động.
- Theo dõi ai hay hủy/no-show.
- Duyệt người ngoài nhóm trước khi nhận.
- Giữ group cũ, thêm lớp quản lý nhẹ.

### Player-facing message

Primary:

> Tìm kèo hợp lịch, hợp trình và xây uy tín để dễ được nhận vào kèo tốt.

Secondary:

- Giữ slot rõ ràng.
- Nhận nhắc lịch.
- Xem lịch chơi cá nhân.
- Xây hồ sơ reliability.
- Tìm kèo ngoài nhóm khi muốn chơi thêm.

### Copy nên tránh

- "Rời Zalo sang Plexco."
- "Marketplace lớn nhất cho mọi môn thể thao."
- "Public toàn bộ kèo của bạn."
- "Rating người chơi công khai."
- "Thay thế cách host đang vận hành."

---

## Product roadmap by phase

> ⚙️ **DD-114 (22/08) — phase-1 kỹ thuật có 7 nhóm feature; các Phase 1-4 dưới đây là phase *thị trường*, không phải phase build.** Bảy nhóm: signup/signin Google · create club · link club ⇄ Zalo bot · link account ⇄ Zalo · sync data + owner config public/private · session management/detail + nhắc nợ/confirm/gạch nợ · settings/privacy. Launch (Phase 0) là **subset** của nhóm đó. Khi hai cách chia có vẻ lệch: mục này nói *thị trường mở khoá theo thứ tự nào*, DD-114 nói *build gồm những gì*. Chi tiết + hai hard dependency (billing/entitlement · fence public read model): `../standards/decisions.md` DD-114.

### Phase 0: Launch hai surface (mới 22/08)

Mục tiêu:

- Có một sản phẩm chạy được trên hai surface, nối đúng một người.

Build — đúng launch scope, không hơn:

- **PWA:** signin/signup · link Zalo bot · session management · session detail · settings.
- **Bot Zalo:** tạo kèo, RSVP/hủy, deep link sang PWA.

Do not build:

- App native (mọi dạng, kể cả wrapper).
- Discovery, chat, feed, đối soát tự động, web push.

### Phase 1: Win the host

Mục tiêu:

- Host tạo và quản lý kèo hằng tuần.
- Player RSVP không cần học app mới.

Build:

- Reminder + cutoff rules (bot gửi, PWA cấu hình).
- Attendance close + no-show ledger (bot chốt nhanh, PWA là sổ).
- Basic player identity.
- Host dashboard đơn giản trên PWA.
- Waitlist.

Do not build:

- Public discovery.
- Payment phức tạp.
- Social feed.
- Tournament bracket.
- App native.

### Phase 2: Build trust and fill-slot

Mục tiêu:

- Dữ liệu attendance đủ dày.
- Host bắt đầu dùng Plexco để nhận người ngoài nhóm.

Build:

- Reliability band.
- Host/player lightweight rating.
- Fill-only visibility.
- Host approval queue.
- Skill/location matching.
- Dispute flow.

Do not build:

- Score public quá chi tiết.
- Auto-accept mặc định.
- Discovery toàn thành phố.

### Phase 3: Ignite local network

Mục tiêu:

- Player tìm được kèo từ host khác trong cùng cell.
- Host thấy external players không làm tăng rủi ro quá mức.

Build:

- Discovery trong cell.
- Search/filter theo time, location, level.
- Recommendation cho open slots.
- Cross-host profile.
- Repeat invite.

Do not build:

- National expansion.
- Multi-sport broad launch.
- Heavy content/community feed.

### Phase 4: Deepen and monetize

Mục tiêu:

- Tăng retention, revenue và switching cost.

Build:

- Club tools.
- Tournament hosting.
- Host Pro.
- Player premium nhẹ nếu có value.
- Venue partnerships.
- Payment/deposit nếu cần giảm no-show.

---

## Monetization

Không nên monetize trước khi chứng minh được host retention và fill-slot value. Tuy nhiên, **success fee trên slot được lấp** có vấn đề attribution: sau khi host và player biết nhau, rất khó chứng minh lần sau player đến nhờ Plexco hay nhờ quan hệ trực tiếp ngoài hệ.

Vì vậy, trong giai đoạn đầu, **Host Pro subscription** có thể dễ thu và sạch hơn success fee. Host trả tiền cho workflow, automation, trust ledger và priority fill, thay vì tranh luận từng slot có do Plexco tạo ra hay không.

### Pricing experiments theo thứ tự ưu tiên

1. **Host Pro subscription.** Cho host active cần automation, analytics, attendance history, priority fill, dispute handling và better controls.
2. **Success fee trên slot được Plexco lấp.** Chỉ thử sau khi attribution nằm trong sản phẩm: request qua Plexco Fill, host accept trong Plexco, player RSVP/check-in qua Plexco.
3. **Tournament package.** Doanh thu cao hơn, nhưng nên sau khi có club/host base.
4. **Venue referral/booking fee.** Chỉ nên làm khi có demand đủ mạnh.
5. **Player premium.** Cẩn thận vì có thể làm giảm liquidity; chỉ dùng cho value rõ như advanced stats, priority request, lịch chơi cá nhân.

### Attribution rule nếu thử success fee

Chỉ tính success fee khi đủ 3 điều kiện:

1. Slot được mở qua Plexco Fill.
2. Player request/được mời và được host accept trong Plexco.
3. Attendance được chốt trong Plexco.

Nếu host và player tự add Zalo rồi đi ngoài hệ, Plexco không nên cố charge từng slot. Khi đó retention phải đến từ Host Pro, trust ledger, reminders, attendance history, dispute/deposit và visibility trong fill network.

### Không nên ưu tiên

- Ads.
- Take rate trên mọi giao dịch quá sớm.
- Bắt player trả tiền để RSVP.
- Bán data.

---

## Key risks and mitigations

### Risk 1: Host sợ mất cộng đồng

Mitigation:

- Fill-only thay vì public listing.
- Host duyệt người ngoài.
- Không lộ group/member list.
- Chỉ mở số slot thiếu.
- Host có quyền chặn/blacklist.

### Risk 2: Trust cold-start làm fill-slot fail

Mitigation:

- Player New không được auto-accept trong beta.
- Dùng host-vouch cho player đã có trust local nhưng chưa có data cross-host.
- Dùng first-time deposit cho kèo có rủi ro no-show cao.
- Manual approval là default cho external slot.
- Đo riêng accepted New players with bridge để biết fill-slot fail vì thiếu demand hay thiếu trust.

### Risk 3: Disintermediation và rò rỉ marketplace

Sau khi Host A và player gặp nhau qua Plexco Fill, họ có thể add Zalo nhau và lần sau bỏ qua Plexco. Đây là rủi ro marketplace kinh điển, nhất là khi giao dịch offline và cộng đồng local nhỏ.

Mitigation:

- Reliability chỉ cập nhật khi RSVP/attendance được chốt qua Plexco.
- Deposit, dispute và no-show protection chỉ áp dụng khi đi qua Plexco.
- Host Pro dashboard làm Plexco hữu ích ngay cả với repeat players.
- Repeat invite/reminder/waitlist phải tiện hơn tự nhắn tay.
- Không cố charge các lần đi ngoài hệ; thay vào đó đo repeat through Plexco rate.
- Discovery/fill priority ưu tiên host và player có lịch sử dùng Plexco đầy đủ.

### Risk 4: Player không có lý do mở PWA lặp lại

Rủi ro này **tăng** sau quyết định 22/08: có thêm một surface không tự sinh ra lý do mở nó.

Mitigation:

- Chat vẫn gánh hành động hằng ngày; **không** ép player vào PWA cho việc một-nhịp.
- PWA dành cho thứ chat không chứa nổi: lịch cá nhân xuyên nhóm, hồ sơ reliability, kèo phù hợp, lịch sử tiền.
- Weekly digest: lịch sắp tới, reliability, kèo hợp trình — mỗi digest dẫn về **một màn PWA cụ thể**, không dẫn về trang chủ.
- Chấp nhận sự thật: ở launch, **player có thể gần như không mở PWA**. Đó không phải thất bại — host mới là người phải quay lại. Đo hai nhóm tách nhau, đừng gộp thành "user return rate".

### Risk 5: Trust data bị sai hoặc bị lạm dụng

Mitigation:

- Attendance cần player notification.
- Có dispute flow.
- Host abuse tracking.
- Reliability band thay vì bêu tên bằng số thô.
- Chỉ tính score trên session có đủ dữ liệu.

### Risk 6: Rải mỏng supply

Mitigation:

- Chỉ chạy một liquidity cell.
- Không mở discovery public trước ngưỡng.
- Tập trung host champion.
- Đo slots filled, không đo vanity signups.

### Risk 7: Scope creep sang booking/social/tournament

Mitigation:

- Roadmap theo phase.
- Mọi feature phải trả lời được: có giúp host lấp slot hoặc tạo trust data không?
- Tournament và club để sau khi có recurring host/player base.

### Risk 8: Phụ thuộc Zalo OA/bot constraints

Mitigation:

- Validate Zalo OA/OpenAPI ở Week 0: rate limit, quota tin nhắn, quyền gửi tin, webhook, template/policy và chi phí.
- Không thiết kế flow nào chỉ có thể chạy nếu Zalo behave như Telegram.
- **PWA là surface độc lập, không phải fallback** — đây là mitigation mạnh nhất sau 22/08: mất Zalo thì mất acquisition, không mất sản phẩm.
- Identity gắn với account Plexco + phone, không chỉ chat ID.
- Bot đa kênh theo thứ tự nhu cầu: Zalo trước nếu cell dùng Zalo, sau đó **Messenger** (Telegram đã bỏ — DD-37).

### Risk 9: PWA không phải native — giới hạn là thật, nhất là trên iOS

Web push trên iOS **chỉ hoạt động khi PWA đã được cài** (add-to-home-screen). Nghĩa là mọi lập luận "PWA đủ rồi, có push mà" đều treo trên một tỉ lệ install chưa ai đo.

Mitigation:

- **Không đưa web push vào launch scope.** Reminder ở launch đi qua bot Zalo — kênh đó không phụ thuộc install.
- Đo PWA install rate **tách iOS/Android** ngay từ tuần đầu; đây là input trực tiếp cho quyết định native.
- Không hứa notification cho player trên iOS khi chưa có bằng chứng install.
- Khi bàn native, dùng đúng số đo này làm bằng chứng, không dùng cảm giác "native mượt hơn".

### Risk 10: Hai surface trên một solo dev

Quyết định 22/08 nhân đôi bề mặt phải xây và phải sửa, trong khi năng lực không đổi.

Mitigation:

- Giữ launch scope đúng **năm khối**, và coi mọi đề nghị thêm vào là đề nghị lùi launch.
- Bot và PWA **dùng chung một canonical API**, không fork business rule sang client (nguyên tắc này cũng chính là thứ mở đường cho native sau này).
- Chấp nhận PWA v1 xấu. Đổi lại: đúng và chạy được.
- Nếu phải chọn giữa hoàn thiện PWA v1 và ship reminder/attendance, **chọn reminder/attendance** — đó mới là thứ host trả tiền để có.

---

## Strategic do's and don'ts

### Do

- Đánh dày một cell nhỏ.
- Onboard host thủ công trong beta.
- Dùng ngôn ngữ "fill-slot", không phải "public listing".
- Thu attendance data từ ngày đầu.
- Thiết kế bridge cho player New: host-vouch, deposit hoặc manual approval.
- Validate Zalo OA/bot constraints trước khi chốt bot-first implementation.
- Đo external slots filled/week.
- Đo repeat through Plexco rate để phát hiện disintermediation.
- Build trust controls trước khi mở discovery rộng.
- Nói rõ Plexco bổ trợ group chat hiện tại.
- Giữ launch scope PWA đúng năm khối, coi mọi bổ sung là đề nghị lùi ngày launch.
- Đo mọi metric activation **tách theo surface**.
- Nối account ⇄ Zalo identity sớm; đó là thứ biến hai surface thành một sản phẩm.

### Don't

- Launch marketplace toàn thành phố.
- Bắt player tải app trước khi RSVP.
- Public rating/no-show quá sớm.
- Xây social feed.
- Đấu trực diện booking sân.
- Scale sang nhiều môn khi chưa có một cell thắng.
- Đặt success-fee làm pricing mặc định trước khi giải được attribution.
- Gọi web app là "PWA" khi chưa có manifest/service worker/installable.
- Hứa app native với host hoặc player trước khi PWA đo được retention.
- Đưa web push vào launch — trên iOS nó phụ thuộc install rate chưa ai đo.
- Ép player tạo account trước khi được giữ slot.

---

## Open decisions for team

1. **Chọn cell beta đầu tiên.** Môn nào, khu vực nào, level nào, khung giờ nào?
2. ~~**Chọn identity primitive.**~~ ✅ **Chốt 22/08:** account Plexco là primitive; Zalo identity được **link** vào account (khối 2 của launch scope). Phone dùng để xác thực, không phải danh tính gốc.
3. **Cutoff mặc định.** Hủy trước bao lâu thì không bị phạt?
4. **No-show visibility.** Reliability band nào được hiển thị cho host/player?
5. **Dispute policy.** Ai xử lý tranh chấp trong beta?
6. **New-player bridge.** Player New cần host-vouch, deposit, manual approval hay kết hợp cả ba?
7. **Payment/deposit timing.** Có cần deposit để giảm no-show ngay trong fill-slot beta, hay để sau?
8. **Zalo feasibility.** Flow nào chạy được qua Zalo OA? *(Câu hỏi "flow nào phải dùng web fallback" đã hết nghĩa từ 22/08: ranh giới bot ⇄ PWA nay do thiết kế quyết định, không do giới hạn của Zalo quyết định. Câu còn lại là: mất Zalo thì acquisition bù bằng gì.)*
9. **Host champion incentives.** Miễn phí Pro, badge, priority support hay revenue share?
10. **Success fee test.** Khi nào attribution đủ sạch để thử thu phí trên slot được lấp?
11. **Thứ tự sau launch.** Reminder/cutoff trước hay attendance ledger trước? Cả hai đều là "bám ngay sau v1", nhưng solo dev chỉ làm được một cái trước.
12. **Player có cần account ở launch không?** Hiện thiết kế cho phép RSVP không account. Ngưỡng nào thì bắt buộc tạo account — nhận slot ở kèo lạ, hay chỉ khi muốn xem lịch riêng?
13. **Ngưỡng gate native.** Bảng ngưỡng ở §Launch surface sequencing là đề xuất; owner cần chốt con số hoặc thay bằng con số của mình.

---

## Recommended next step

Sau quyết định 22/08, việc gần nhất **không phải** chạy beta mà là làm cho launch scope tồn tại. Thứ tự:

1. **Gỡ lệnh FE PENDING bằng một quyết định ghi ra.** Không có bước này thì mọi việc còn lại là bàn suông. DD-113 cố ý **không** gỡ nó (đổi ưu tiên GTM ≠ cấp quyền thực thi FE). ⚠️ Đo 22/08: **lệnh PENDING gốc cũng chưa từng vào `decisions.md`** — nó chỉ sống ở `../autopilot-templates/next-lanes-2026-08-13-RUN.md` rồi mirror sang ROADMAP/HANDOFF, đúng thứ DD-111 D4 vừa cấm. Nên ghi cả lệnh gốc lẫn quyết định gỡ.
2. ~~**Mint DD-113 và mirror.**~~ ✅ **Xong 22/08, đủ chuỗi:** `decisions.md` v2.35 (DD-113) · ROADMAP v3.6 · HANDOFF v1.36 · native-app-strategy 2.1 · BRD v3.9o · PRD v2.8n.
3. **Chốt launch scope thành slice thật.** Năm khối PWA + bot tạo kèo/RSVP, mỗi khối một packet đi qua gate `CODE_READY` như mọi slice khác. Ưu tiên **signin/signup → link Zalo bot** trước, vì hai khối sau không có nghĩa nếu chưa có account và chưa nối được identity.
4. **Song song, phần phi kỹ thuật của Week 0:** chốt một liquidity cell duy nhất, phỏng vấn 15 host trong cell đó (họ thiếu người khi nào, sợ gì khi nhận người lạ, xử lý no-show ra sao, có chấp nhận host-vouch/deposit không). Việc này không phụ thuộc code và đang là thứ rẻ nhất để làm ngay.
5. **Validate Zalo OA/bot feasibility** — rate limit, quota, quyền gửi tin, webhook, chi phí — và lần này hỏi đúng câu: *mất Zalo thì acquisition bù bằng gì*, không phải *flow nào lùi về web*.
6. **Chạy concierge beta với 20-30 host** khi pre-beta gate đã pass. Product có thể thô, nhưng phải đo được session, RSVP, attendance, external slot fill, repeat through Plexco — và từ nay, **tách theo surface**.

Nếu beta chứng minh được host dùng lặp lại và Plexco lấp slot thật, khi đó mới đáng đầu tư mạnh vào discovery, club và monetization. App native đứng sau tất cả những thứ đó.

---

## Source notes

Các nguồn public dùng để kiểm tra giả định thị trường tại thời điểm cập nhật:

- [Zalo product page](https://zalo.me/en/product/zalo/) và [VietnamNet](https://vietnamnet.vn/en/zalo-s-number-of-users-hits-78-3-million-putting-telcos-at-pipeline-trap-2436470.html): Zalo khoảng 78.3M MAU trong nửa đầu 2025 và xấp xỉ 2B tin nhắn/ngày.
- [Zalo OA OpenAPI](https://developers.zalo.me/docs/api/official-account-api-230), [giới hạn tốc độ API](https://developers.zalo.me/docs/official-account/phu-luc/gioi-han-toc-do-api), [kiểm tra hạn mức tin nhắn OA](https://developers.zalo.me/docs/official-account/quan-ly/quan-ly-thong-tin-oa/kiem-tra-han-muc-tin-nhan-oa) và [mã lỗi quota/rate limit](https://developers.zalo.me/docs/official-account/phu-luc/ma-loi): cần validate kỹ trước khi đặt cược toàn bộ vào Zalo bot-first.
- [Dân trí](https://dantri.com.vn/kinh-doanh/nguoi-viet-chi-hon-510-ty-dong-mua-do-pickleball-trong-nua-nam-20250808113341326.htm), [VnEconomy](https://vneconomy.vn/pickleball-tu-tro-choi-den-thi-truong-nghin-ty-dong) và [Metric.vn](https://metric.vn/ereport/vot-bong-pickleball): proxy demand tiêu dùng pickleball qua doanh thu TMĐT; không dùng như bằng chứng trực tiếp cho liquidity kèo.
- [ALOBO App Store](https://apps.apple.com/my/app/alobo-sports-field-booking/id6479625228) và [Google Play](https://play.google.com/store/apps/details?id=com.alobo.sportUser): định vị mạnh ở booking sân, real-time availability, payment, lịch chơi và review.
- [Reclub website](https://reclub.co/) và [Reclub Google Play](https://play.google.com/store/apps/details?id=co.reclub): định vị mạnh ở club, meets, RSVP/waitlist, competitions và community.
- [Pickleheads HCMC](https://www.pickleheads.com/courts/vn/ho-chi-minh): public court directory cho thấy có nhiều địa điểm/court pickleball tại TP.HCM và một số thành phố Việt Nam.
- [VnExpress](https://e.vnexpress.net/news/life/trend/vietnam-s-pickleball-boom-turns-fast-growing-sport-into-new-gold-mine-4992840.html) và [SGGP](https://en.sggp.org.vn/pickleball-booming-in-ho-chi-minh-city-post113550.html): thị trường pickleball VN tăng từ ~15 tỷ đồng (Q1/2024) lên ~357 tỷ đồng (Q3/2025), cầu sân vượt cung, nhiều sân tennis/cầu lông chuyển đổi sang pickleball.

Các số beta target trong tài liệu này là **working hypotheses**, không phải forecast. Cần validate bằng phỏng vấn host và dữ liệu 8 tuần đầu.

Tham chiếu nội bộ cho quyết định 22/08 (không phải nguồn public): `./native-app-strategy.md` §1–4 (gate kỹ thuật của native) · `../decisions/analysis/dd-69-app-native-analysis.md` (PWA phase-1 / native phase-2, RN+Expo sau spike) · `../features/BE/feature_notifications_reminders_tech.md` (iOS chỉ cho web push khi PWA đã cài — cơ sở của Risk 9) · `../product/ROADMAP.md` §Canonical Delivery Groups hàng *App Native*.

---

## Changelog

| Ngày | Thay đổi |
|---|---|
| 22/08/2026 | **DD-114 — phase-1 = 7 nhóm feature, launch là subset.** Thêm ghi chú ở §Product roadmap by phase phân biệt phase *thị trường* (mục này) với phase-1 *kỹ thuật* (DD-114). Vế tiền của nhóm 6 chỉ mở cho `host_pro` ⇒ billing vào phase-1; toggle public/private chỉ mở sau khi land fence của public read model; A3 legal thành blocker. |
| 22/08/2026 | **GTM re-sequencing (owner-final).** Launch = webapp PWA + Zalo bot song song; native lùi về phase sau. Thêm §Launch surface sequencing (phân vai surface, launch scope 5 khối, negative scope, gate native). Bỏ framing "web fallback" khỏi Executive summary, Market reality, Week 0, Risk 8. Minimum wedge đổi thành bảng theo surface. Thêm pre-beta launch readiness gate, 4 metric surface, Phase 0, Risk 9 (giới hạn PWA/iOS push) và Risk 10 (hai surface một solo dev). Open decision #2 chốt; #8 reframe; thêm #11–13. Next step viết lại. **Mint DD-113 ✅ + mirror đủ cùng phiên: ROADMAP v3.6 · HANDOFF v1.36 · native-app-strategy 2.1 · BRD v3.9o · PRD v2.8n.** |
| 28/07/2026 | DD-91 + regional reconciliation: target dài hạn chuyển daily use sang In-app Chat; Host Pro auto-reconcile không phải capability toàn cầu; provider authority `sepay|apipay`. |
| 10/07/2026 | DD-37 / BRD v3.4: kênh phase-1 = Zalo + Facebook Messenger + web; bỏ Telegram. |
