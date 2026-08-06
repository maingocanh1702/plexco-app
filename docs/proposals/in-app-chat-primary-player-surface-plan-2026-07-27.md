<!-- review-readiness: enforce -->
# Plan — In-app Chat trở thành surface chính cho player/user

> **Ngày:** 2026-07-28
> **Version:** 1.8
> **Phạm vi:** chat người↔người trong Plexco, Club Assistant được gọi bằng `@mention`, private Club Bot thread, slash self-service như `/pay` (kể cả human DM 1-1) và vòng đời thông báo thanh toán trong app.
> **Mục tiêu sản phẩm:** player có thể dùng Plexco cho phần lớn trao đổi và thao tác hằng ngày thay vì phải quay lại Zalo/Messenger. Zalo/Messenger vẫn có thể là acquisition/fallback surface; chúng không còn là dependency cho daily club use khi initiative này đạt exit gate.
> **Trạng thái:** `PLAN_READY` · **KHÔNG phải coding authorization**. DD-86/DD-91..95 đã đóng đủ **13/13** lựa chọn sản phẩm trong scope (`OPEN_QUESTIONS_IN_SCOPE: 0`); Chat, Assistant, Player View, Notification và Tenant Authz companion specs đều `Reviewed`. G1–G5 PASS, G6 chỉ còn enablement-only, closure **12/12**. Blocker cuối — authority pack chưa có immutable commit — đã đóng bằng `90d292d`. `PLAN_READY` chỉ chứng minh **đủ contract để tách slice và viết execution plan**; nó **không** chứng minh slice nào code được. Mỗi slice 1–47 / A1–A21 / F0–F15 vẫn phải tự đạt strict `CODE_READY` trước khi mở worktree.
> **Authority live-repo đã đối chiếu:** `main@90d292d85fbe92db7a5afcd118a99e28f3d3b3b7` = `origin/main` (re-pin 2026-07-28); migration tail quan sát được là `0024`; `chat_*`, `/api/chat/*`, `/api/me*`, Assistant/KB runtime và product chat UI chưa tồn tại.
> **Provenance snapshot:** `90d292d` = commit `docs(chat): commit the in-app-chat primary-surface authority pack`, chứa **đúng 27 file** `TARGET_FILES` và không file nào khác; 73 file WIP không liên quan trong worktree được cố ý loại khỏi baseline. Toàn bộ nội dung review ở bản này (trừ chính metadata pin của v1.8) nằm tại `90d292d`.
> **Drift từ snapshot review trước:** `6ae2de6..81b4fe8` đã land scheduler/outbox (`a03d2d6`) và docs reconciliation; `81b4fe8..2dc9b8c` chỉ đổi readiness artifacts cho slice DB constraint-naming; `2dc9b8c..90d292d` là chính authority pack này. Các delta trước `90d292d` **không chạm** chat, Player View, Assistant, Notification contracts, payment helper hay migration tail; vì vậy không invalidate blast radius. Migration mới vẫn phải lấy **next available monotonic number sau khi sync main tại lúc author**, không hard-code `0025`.
> **Canonical liên quan:** `../decisions/analysis/dd-86-in-app-multi-channel-analysis.md` · `../features/README.md` · `../features/feature_inapp_chat.md` · `../features/BE/feature_inapp_chat_tech.md` · `../features/feature_club_assistant.md` · `../features/BE/feature_club_assistant_tech.md` · `../features/feature_player_view.md` · `../features/BE/feature_player_view_tech.md` · `../features/feature_notifications_reminders.md` · `../features/BE/feature_notifications_reminders_tech.md` · `../features/feature_tenant_routing_authz.md` · `../features/BE/feature_tenant_routing_authz_tech.md` · `../standards/decisions.md` · `../standards/core-db-architecture-principles.md`.

---

## 0. Executive direction

### 0.1 Kết quả cuối cần đạt

Plexco chat chỉ được coi là **primary player surface** khi một member có thể:

1. trao đổi trong các kênh CLB và DM người↔người với lịch sử bền, unread, reconnect, media và safety đầy đủ;
2. `@mention` Club Bot trong kênh CLB để hỏi nội dung đã có trong KB, có citation và `no_answer` thay vì bịa;
3. mở một **private Club Bot thread** của đúng CLB để hỏi riêng;
4. chạy exact slash catalog v1 trong các surface được phép: kênh CLB, private Club Bot thread hoặc command overlay riêng tư của human DM 1-1;
5. dùng `/pay` để xem nợ **của chính mình**; command và kết quả chỉ requester thấy trên mọi surface;
6. dùng exact `/sessions` trong kênh CLB hoặc private Club Bot thread mà không tạo business-logic implementation riêng cho chat;
7. nhận được unread/background notification đủ tin cậy để không cần mở Zalo/Messenger chỉ để biết có hoạt động mới;
8. nhận reminder, xác nhận đã thanh toán và correction trong Inbox Plexco; OS Web Push chỉ generic và mở authenticated detail.

### 0.2 Bất biến không được đánh đổi

- **Không đưa tiền/PII vào LLM.** `@mention` dùng KB-RAG; `/pay` và mọi self-service command đi deterministic command core riêng.
- **Không đăng command riêng tư vào kênh chung.** `/pay` input, amount, breakdown, QR/pay action và lỗi integrity không được ghi vào `chat_messages`, shared SSE topic, push body, analytics hay log.
- **Không dùng FE-only hiding.** `requester_only` là authorization + delivery contract ở server; CSS/DOM không phải privacy boundary.
- **Không tạo bot như `Person`.** Club Bot tiếp tục là tenant config theo DD-20.
- **Không biến private Club Bot thread thành human DM giả.** Human DM giữ đúng 2 `Person`; bot thread là person-within-tenant view riêng.
- **Không re-derive business state trong adapter chat.** Slash adapters chỉ gọi canonical services/handlers; money/session/identity owner không chuyển vào chat module.
- **Unknown fail-closed.** Không chứng minh được nợ bằng 0 thì trả `unknown/error`, không trả “Bạn không còn nợ”.
- **Không bridge nội dung chat sang Zalo/Messenger.** External channel chỉ có thể deep-link/fallback theo contract riêng; không có message multi-master.

---

## 1. Capability floor để thay phần lớn Zalo/Messenger

| Capability | Outcome bắt buộc | Canonical owner / dependency |
|---|---|---|
| Multi-channel CLB | Main + topic channels, một active default, channel lifecycle atomic | DD-86 + In-app Chat |
| Human messaging | Text, pagination, retry-safe send, reconnect, moderator tombstone/restore | In-app Chat |
| Media | Private upload, scan, ready-only attach, signed read, delete/tombstone | DD-55 / In-app Chat |
| Human DM | 1-1 đúng 2 người, block/report/rate-limit/audit, host không đọc | DD-55 / In-app Chat |
| Reply/mention/reaction | Same-channel reply, structured mention, one exact emoji reaction/person/message | DD-92 |
| Edit/delete/search | Bounded own edit, irreversible author tombstone, authorized PostgreSQL full-text search trước beta | DD-92 |
| Unread/digest | Per-channel cursor + generic coalesced offline signal; không durable item/content snapshot mỗi message | Chat read model + DD-94 |
| Club Assistant | Explicit `@ClubBot`, KB-only RAG, citation, no-answer | DD-16..23 + Assistant specs |
| Private Club Bot | Thread riêng theo `(tenant, requester)`; không dùng human DM | Assistant ask-panel evolution |
| Slash registry | Closed-set parser + typed command descriptors + thin adapters | Shared command core |
| `/pay` privacy | Own debt only, requester-only delivery, no LLM/no shared persistence | Player View person-self + Payment ledger |
| Payment lifecycle | `reminder|settled|correction` có durable in-app Inbox; generic Web Push mở authenticated detail | Notifications DD-70..72 + Player View self-payment projection |
| Player actions v1 | Exact zero-argument catalog theo surface; native UI remains primary cho form/picker | DD-93 + Player View / SessionService |

### 1.1 Không nằm trong first release

- Bridge/mirror message hai chiều với group Zalo/Messenger.
- E2EE; voice/video call; public/community channel ngoài tenant.
- Typing indicator, online/last-seen presence và granular per-message read receipt; v1 chỉ có canonical per-channel read cursor/unread, tránh mở thêm privacy/presence state trước khi core reliability đạt exit gate.
- LLM tự suy luận slash hoặc tự gọi money/session mutation.
- Multi-turn LLM memory lấy toàn bộ lịch sử channel.
- Private/subset club channel; DD-86 phase-1 auto-provision mọi active membership vào mọi active club channel.
- Host command mutation trước khi canonical service, capability, preview/confirm và audit owner đã land.

---

## 2. Parity map theo use case

| Use case hiện user tìm ở bot ngoài | Plexco in-app outcome | Surface | Visibility | Phase |
|---|---|---|---|---|
| Chat nhóm CLB | Multi-channel club chat | Club channel | Channel members | Chat floor |
| Nhắn riêng người khác | Human DM | DM | Exact 2 persons | Chat floor |
| Hỏi nội quy/FAQ | `@ClubBot <câu hỏi>` | Club channel | Public trong channel | Assistant |
| Hỏi riêng Club Bot | Free text trong private Club Bot thread | Bot thread | Requester only | Assistant |
| Xem mình còn nợ bao nhiêu | `/pay` | Club channel, bot thread hoặc private command overlay trong human DM | **Requester only; DM peer nhận zero bytes** | Read commands v1 |
| Xem kèo sắp tới | `/sessions` | Club channel hoặc bot thread | Requester only | Read commands v1 |
| Biết sắp tới hạn/đã thanh toán/bị điều chỉnh | Inbox item + generic Web Push | Notification Inbox → authenticated payment detail | Requester only | Primary-surface exit |

**Rule:** native app UI vẫn là primary interaction cho discovery/forms/pickers. Slash có thể route tới một deterministic screen/action; không cần ép mọi flow thành text conversation.

---

## 3. UX contract

### 3.1 Trong club channel

Composer có ba đường tách biệt:

```text
startsWith("/")          → Slash Command Router
contains explicit bot mention → Club Assistant ingress
otherwise                → Human Message send
```

- Gõ `/` mở command palette theo actor/surface/tenant capability hiện hành.
- Submit `/pay` **không tạo human message** và không hiện “Nguyễn đã dùng /pay” cho channel.
- Requester nhận private card có nhãn cố định `Chỉ bạn nhìn thấy`.
- Card private không có permalink dùng chung, không xuất hiện khi người khác reload history và không được quote/forward bằng message reference.
- `@ClubBot` là mention entity do server resolve, không chỉ regex tên display. Rename bot không làm mention cũ đổi target.
- Câu trả lời KB từ `@ClubBot` là message assistant visible trong channel, có citation/no-answer.
- Assistant ingress không có ledger/live-money tool nên câu hỏi mention về nợ chỉ có thể nhận KB guidance hoặc `no_answer`; không có actual amount. Phase đầu **không thêm semantic/fuzzy money-intent router**. User muốn số nợ thật phải dùng exact `/pay`.

### 3.2 Private Club Bot thread

Private Club Bot thread là **chat-like view trên Assistant ask-panel + slash router**, không phải `chat_channels(kind='dm')`.

- Thread identity phase đầu là deterministic `(tenant_id, requester_person_id)`; không cần bot membership hay bot `Person`.
- Tenant được pin bởi route `/clubs/:tenant/assistant`; global entry bắt buộc user chọn CLB, không đoán tenant.
- Free text → `bot.ask(surface='ask_panel')`; slash → command router.
- Chỉ requester đọc được raw question/answer. Host analytics chỉ aggregate; host/support/tenant admin không có transcript access mặc định.
- Phase đầu mỗi câu hỏi KB độc lập; không gửi toàn bộ prior thread làm LLM context. Multi-turn memory là decision/slice sau.
- `/pay` có thể hoạt động cho own historical obligation của membership `left` trong private thread nếu person-self relation còn hợp lệ; KB ask vẫn yêu cầu active membership như Assistant contract hiện tại.

### 3.3 Human DM

- Giữ `dm_key` + đúng 2 `Person`; không thêm bot làm thành viên thứ ba.
- Bot mention trong human DM không hoạt động ở phase đầu.
- Block/report/safety state tiếp tục gate create/reuse/send/read/SSE.
- Exact `/pay` được chặn **trước** human-message send và chạy trong private command overlay; nó không tạo assistant participant/message, unread, history, SSE event hay ref cho peer.
- Vì canonical human DM có `tenant_id=NULL`, server không được suy tenant từ peer, thread hay CLB chung. Server enumerate **các CLB requester được phép tự đọc nghĩa vụ**: đúng một CLB thì chọn trực tiếp; nhiều CLB thì trả requester-only picker; không có thì trả generic empty state. Membership `left` vẫn có thể xuất hiện nếu còn historical obligation hợp lệ.
- Picker option là opaque, short-lived và bind requester + DM + command + tenant + expiry; lựa chọn chỉ là input để server re-authorize, không phải authority và không phải persisted result ref.

### 3.4 Message-quality floor

- `reply_to_message_id` phải cùng channel và requester còn quyền đọc. Gửi reply mới vào target đã tombstone bị reject; reply đã tồn tại chỉ render tombstone, không resurrect body.
- Structured mention lưu immutable target ref + render snapshot an toàn; không có update path cho target/snapshot/reply/attachment.
- Reaction dùng exact closed set `👍|❤️|😂|😮|😢|🙏`; mỗi `(message, person)` có tối đa một reaction active. Add cùng value là idempotent; đổi value replace nguyên tử; remove lặp là no-op an toàn.
- Chỉ author được sửa **body** của human message trong `<15m`, tối đa 5 revision; author/channel/reply/attachment/mention immutable. Assistant/system không edit. Revision audit bị hạn chế quyền đọc.
- Author được soft-delete message của mình bất kỳ lúc nào; thao tác là irreversible với author và mọi reader chỉ thấy shared tombstone. Không hard delete.
- Search là beta gate, thuộc post-root slice riêng: chỉ current-readable channel/current-visible canonical body, optional channel filter, generated PostgreSQL `simple` `tsvector`; không index/trả tombstone, revision, requester-only slash hay private bot query/result.
- Club moderator có thể hide/restore thành tombstone qua `chat.message.moderate`; timed channel mute dùng `chat.member.mute`. Actor + reason nằm trong immutable restricted audit.
- Offline signal/digest theo DD-94 chỉ dùng opaque highest-unread cursor; không durable notification item/message snapshot/body/title/amount. Human-DM host/admin moderation/read vẫn bị cấm.
- Unread dùng monotonic per-channel message sequence/cursor; wall-clock `last_read_at` không phải ordering authority.
- Accessibility, Vietnamese/English system copy và offline/retry states là acceptance bắt buộc, không phải post-GA polish.

---

## 4. Interaction Router và command registry

### 4.1 Decision table

| Input | Condition | Owner | Expected |
|---|---|---|---|
| `/pay` | Exact registered slash | Command router | Không persist message; call self-payment handler |
| `/PAY` | ASCII case-insensitive canonical command | Command router | Cùng handler `/pay`; private result, không message/LLM |
| `/pay @An` | `/pay` không nhận target | Command router | Reject generic; không resolve người khác |
| `/unknown` | Không nằm registry | Command router | Private `/help` suggestion |
| `@ClubBot nội quy?` | Valid structured mention + channel Assistant gates pass | Assistant | KB ask → public assistant reply |
| `@ClubBot tôi nợ bao nhiêu?` | Valid mention nhưng Assistant không có ledger tool | Assistant KB boundary | KB guidance/no-answer; không actual amount, không ledger context; user dùng exact `/pay` |
| `tối nay ai đánh?` | Không slash/không bot mention | Human chat | Persist human message bình thường |
| Slash trong unsupported surface | Descriptor không cho surface đó | Command router | Private `COMMAND_NOT_AVAILABLE_HERE` |
| `/pay` trong human DM | Exact slash; DM tenant is NULL | Command router | Intercept trước message insert; auto-select một eligible club hoặc trả requester-only club picker; peer nhận zero bytes |

### 4.2 Descriptor tối thiểu

```ts
type ChatCommandDescriptor = {
  name: string;
  actor: "player" | "host" | "both";
  surfaces: readonly ("club_channel" | "club_bot_thread" | "human_dm_overlay")[];
  visibility: "requester_only" | "explicit_broadcast";
  risk: "read_only" | "mutation" | "money_mutation";
  authz: string;
  handler: string;
  confirmPolicy: "none" | "preview_confirm" | "domain_owned";
};
```

Registry là closed set trong code. LLM/KB không được thêm alias, handler hoặc capability. Unknown command không silent-fall-through thành human message vì slash có thể chứa dữ liệu riêng tư.

Grammar v1 trim outer whitespace rồi canonicalize **ASCII case-insensitive**, không Unicode folding, không alias và **zero arguments**. `/help|/pay|/me|/myclubs|/discover|/name` chạy ở club channel, private Club Bot thread và human-DM overlay; `/sessions|/waitlist` chỉ chạy ở club/bot. Unknown command, extra argument hoặc unsupported surface đều trả private typed error trước message insert/rate-consume/Assistant routing. `/help` derive trực tiếp từ registry **sau authz** và chỉ liệt kê command actor dùng được tại surface hiện hành.

### 4.3 Shared-core rule

```text
Chat adapter
  → resolve trusted actor + trusted surface context
  → Command Registry
  → canonical domain handler
  → typed private response renderer
```

- Chat, web, Zalo/Messenger adapters (nếu còn) dùng cùng domain handler.
- Read-only “show/display” route tới existing deterministic read service.
- Mutation route tới existing preview/confirm/final handler; chat không copy state machine.
- Adapter không tự query `charges`, tự tính slot, tự join/leave hay tự update ledger.

---

## 5. `/pay` canonical contract

### 5.1 Input và authority

- Command hợp lệ phase đầu: exact `/pay`, **không nhận tên/person ID**.
- Trong club channel: derive `tenant_id` từ authorized channel; derive `person_id` từ authenticated session.
- Trong private Club Bot thread: derive tenant từ route/thread; person từ session.
- Trong human DM: derive person từ session; **không derive tenant từ DM/peer**. Server auto-select khi requester chỉ có một eligible club, còn nhiều club thì trả picker opaque và re-authorize lựa chọn.
- Không nhận `tenantId`, `personId`, membership ID hoặc charge ID tuỳ ý từ request body.

### 5.2 Single source of truth

`/pay` phải dùng cùng person-self service với `GET /api/me/charges`, không query ledger trực tiếp trong chat.

```text
getSelfPaymentStatus({ trustedPerson, trustedTenant })
  → memberships/players/charges/payment_allocations under authorized context
  → canonical remainingAmount primitive  # effectiveFee giữ null rồi delegate
  → typed SelfPaymentStatus
```

`charges.amount_due` + `charges.amount_allocated` là canonical aggregate fields hiện có. Theo DD-91, extract đúng một primitive domain-neutral:

```ts
remainingAmount(amountDue: number, amountAllocated: number): number =
  Math.max(0, amountDue - amountAllocated);
```

`effectiveFee(d: OpenDebt): number | null` **giữ nguyên** nhánh `fee == null → null`, rồi delegate `remainingAmount(d.fee, d.paid_amount ?? 0)`. Player View service validate charge integrity (`amount_due >= 0`, `amount_allocated >= 0`, `amount_allocated <= amount_due`) trước khi gọi primitive. Authz/integrity/decryption/dependency failure thuộc service layer và map thành `SelfPaymentStatus.kind="unknown"`; primitive không sở hữu `unknown`, và `null` của `effectiveFee` không bao giờ được coerce thành `known_zero`.

`SelfPaymentStatus` luôn là projection của **một authorized club**. `GET /api/me/charges` enumerate own eligible clubs rồi bọc từng kết quả trong `{clubRef, clubLabel, status}`; chat `/pay` và notification detail gọi đúng cùng service cho trusted channel/thread/opaque club selection. Wrapper không chứa raw tenant ID và không thay công thức/serializer money.

Impact analysis live sau refresh graph: **MEDIUM**, bốn production caller trong một core module (`coverRemaining`, `classifyDeposit`, `classifyIncoming`, `classifyCoverage`) + focused tests; đủ bounded cho slice riêng `≤3 modules/≤300 LOC`. Slice chỉ đổi `effectiveFee` để delegate primitive; bốn caller giữ nguyên và regression suite phải chạy đủ bốn path, không để hai công thức song song.

### 5.3 Typed result

```ts
type SelfPaymentStatus =
  | { kind: "known_zero"; currency: "VND"; asOf: string }
  | {
      kind: "known_amount";
      currency: "VND";
      totalOutstanding: number;
      chargeCount: number;
      items: readonly {
        sessionRef: string;
        startsAt: string;
        amountDue: number;
        amountAllocated: number;
        remaining: number;
        status: "open" | "partial";
      }[];
      payAction?: { kind: "open_protected_pay"; href: string };
      asOf: string;
    }
  | { kind: "unknown"; reasonCode: string; retryable: boolean };
```

- `known_zero` chỉ trả khi identity + tenant relation + authoritative query hoàn tất thành công và không có open/partial remaining.
- DB/authz/integrity/decryption/dependency failure → `unknown`, không coerce về zero.
- QR/pay action chỉ xuất hiện sau khi protected `/pay` renderer/destination tuple contract riêng được owner chốt và implementation land. Plan này không tự chốt VietQR proposal.
- Response không liệt kê other player, payer name, roster hay bank secret.

### 5.4 Delivery/privacy

- Theo DD-91, command endpoint trả **synchronous authenticated response** cho requester với `Cache-Control: private, no-store`; client render ephemeral card/picker cục bộ.
- Không có result row, result ID/ref, private SSE topic, replay store, outbox, shared event, notification hay history entry. Peer không có endpoint/ref để thử replay.
- Không persist amount/breakdown vào `chat_messages`, `processed_commands.result_ref`, outbox, shared channel event, push body, logs hay analytics.
- Audit tối thiểu chỉ gồm opaque actor/tenant, command enum, outcome class (`known_zero|known_amount|unknown`), latency bucket và reason code; không amount.

---

## 6. Slash catalog và ship order

### 6.1 Read/navigation commands v1

Mọi row dùng ASCII case-insensitive canonicalization, zero arguments, no aliases và response requester-only:

| Command | Canonical behavior | Surfaces | Dependency |
|---|---|---|---|
| `/help` | Registry-derived available commands sau authz | Club · Bot thread · Human-DM overlay | Command registry |
| `/pay` | §5 self-payment status | Club · Bot thread · Human-DM overlay | Player View + ledger read core |
| `/me` | Mở/hiển thị own profile summary | Club · Bot thread · Human-DM overlay | Player View person-self |
| `/myclubs` | Danh sách CLB requester được phép xem | Club · Bot thread · Human-DM overlay | Player View person-self |
| `/discover` | Route tới discovery surface, không reimplement ranking trong Chat | Club · Bot thread · Human-DM overlay | Marketplace discovery |
| `/name` | Route tới canonical self-name flow | Club · Bot thread · Human-DM overlay | Identity |
| `/sessions` | Own upcoming sessions trong current/selected club | Club · Bot thread | Player View service |
| `/waitlist` | Own waitlist state trong current/selected club | Club · Bot thread | Player View / SessionService |

### 6.2 Command negative scope

Every command-like input outside exact catalog ở §6.1 là private reject trong v1. Mutation/host commands vẫn cần separate future decision; catalog read/navigation chỉ route deterministic handler hiện hữu, không chuyển business ownership vào Chat.

### 6.4 Moderation floor

- `chat.message.moderate` cho hide/restore soft tombstone; `chat.member.mute` cho timed channel mute với DB-owned expiry.
- Timed mute chỉ nhận exact `1h|24h|7d`. Reason chỉ nhận `spam|harassment|unsafe|off_topic|other`; `other` bắt buộc bounded note.
- Mọi mutation dùng actor-scoped UUID receipt + canonical fingerprint; exact replay trả prior result, mismatch reject. Actor + reason được ghi immutable append-only audit.
- Mute chặn message write nhưng không xoá read access; expiry được evaluate live tại canonical send choke-point.
- Không có host moderation/read trong human DM, hard delete, sửa body, permanent ban hoặc moderation system message.

---

## 7. Data planes và storage boundary

| Data | Plane | Storage/render rule |
|---|---|---|
| Club human messages | Tenant-private | `chat_messages`; channel membership + RLS |
| Public Club Bot KB answer | Tenant-private | `bot_queries` + canonical assistant `chat_messages` |
| Human DM | Person-self | Canonical DM rows; exact 2 persons |
| Private Club Bot questions | Person-within-tenant | `bot_queries(asker_person_id)` through narrow asker read; tenant RLS alone không đủ cấp transcript |
| Slash input/result | Requester-only transient | Không `chat_messages`; synchronous `private, no-store` typed response; không result row/ref/SSE |
| Command audit | Tenant-private/minimized | Enum/outcome/reason/opaque refs; no body/amount |
| Moderation | Tenant-private club only | Tombstone/mute/audit qua exact capabilities; tuyệt đối không mở DM transcript |
| Message revisions/search | Tenant-private/person-self authz | Restricted revision audit; generated PostgreSQL `simple` vector trên current canonical body; live readability/visibility filter |
| Unread | Chat-owned read model | Per channel/person monotonic cursor; realtime history/badge độc lập Notification |
| Offline chat signal | Delivery-only | DD-94 opaque coalesced highest-unread cursor; không durable item/content snapshot |
| Payment lifecycle Inbox | Tenant notification plane | Canonical `reminder|settled|correction` durable item; authenticated detail dùng self-payment projection |
| Push | Global device route, content generic | Opaque ref/i18n key only; authenticated app fetch renders detail |

**Boundary DD-94/DD-88:** core chat history/cursor/reconnect/unread chạy độc lập. DD-94 cho phép một generic delivery-only digest/signal lấy từ Chat unread: DM/direct mention/reply default ON; club preference `all|mentions|off`, default `mentions`; coalesce theo `(person,channel,highest_unread_cursor)` và mark-read làm pending cursor cũ obsolete. Ngay trước provider write phải re-check membership hoặc DM block+safety, preference, device active/trust epoch và cursor còn unread; false/unknown thì skip+audit, retry/unknown không duplicate. Timing là enablement-only config, thiếu/chưa test thì route OFF. DD-88 chỉ là broader `DEFERRED_PROPOSAL`, không sở hữu/chặn DD-94. Payment `reminder|settled|correction` tiếp tục thuộc Notification DD-70..72.

**Negative scope — external-channel state hiện có.** `packages/db/schema.ts:744` đã có bảng `player_chat_context (person_id, platform, tenant_id)` — binding person↔external platform (default `telegram`) của lane bot ngoài. Bảng này **không** thuộc namespace `chat_*` và **không** được đọc, ghi, mở rộng hay dùng làm routing input bởi bất kỳ slice nào trong plan này. Bất biến "không bridge nội dung chat sang Zalo/Messenger" (§0.2) áp dụng luôn cho `player_chat_context`: in-app chat không suy ra external identity từ nó, và không có slice nào ở §9 chạm tới nó.

### 7.1 Assistant boundary

- `@mention` and private free-text use `bot.ask`; KB retrieve remains DLP-cleared, tenant-scoped and KB-only. Phase đầu không semantic-route natural language sang money/session commands.
- `/pay` never becomes `bot.ask`, never becomes a tool selected by the LLM and never appends ledger state to prompt context.
- DD-28 live-context tools remain separate; adding a new command does not silently broaden Assistant context.
- Private Club Bot raw content uses canonical `bot_queries` 30-day retention/redaction; host sees aggregate analytics only. Thread shell derives `(tenant,requester)` and không gửi prior transcript vào prompt ở phase đầu.

### 7.2 Notification boundary

- Chat owns history/reconnect/unread/badge; Notification delivery không tạo read authority thứ hai.
- DD-94 digest là generic opaque signal/coalescer, không durable Inbox item per source message và không snapshot body/title/amount.
- Timing/coalescing config, Web Push consent/device/provider readiness là enablement-only; absent/untested route phải OFF.
- DD-88 grouping/message-request/scoped-bulk extensions ở ngoài initiative này và không được suy từ DD-94.

---

## 8. Live-repo truth và dependency graph

### 8.1 Đã có thật trên `main@90d292d`

- Ledger tables `charges`/`payment_allocations`, tenant RLS baseline và same-tenant integrity FKs.
- `charges.amount_due`, `amount_allocated`, status constraints.
- Pure payment helpers trong `packages/core/src/payments-logic.ts`; chưa có player-self debt service runtime.
- `processed_commands`, outbox tables, pg-boss worker shell, claim/lease core, outbox ack marker và scheduler path đã land sau snapshot trước.
- Auth session/onboarding routes và `tenant_admins` role labels; Google lane code đã merge nhưng enablement còn gate riêng.
- Specs Reviewed cho Player View, Chat, Assistant, Notification và Tenant Authz; authority pack này chưa có product runtime.

### 8.2 Chưa có runtime

- `chat_channels`, `chat_members`, `chat_messages`, safety/media tables hoặc `/api/chat/*`.
- DD-56 action/capability registry, grant storage và fail-closed `authorize` primitive; live `tenant_admins`/`tenantsForPerson` chỉ trả role label.
- `/api/me`, `/api/me/charges` và Player View service.
- SessionService/join/leave runtime.
- KB/Assistant tables, ingest, provider worker, `bot.ask` route/projector.
- Command registry/router/private response transport.
- Chat offline digest/signal, PWA push runtime.
- Product chat screens.

### 8.3 Dependency order

```text
Immutable owner-final authority pack
  ├─ serialized DB lane:
  │   chat_definer → DM safety → Chat schema → DD-56 capability + append-only grant audit
  │     └─ channel lifecycle → current-channel safe member targets
  │         └─ DD-95 moderation (dark) → shared send/read
  │         ├─ DM lifecycle
  │         ├─ realtime/unread
  │         ├─ upload/scan → attachment/read/delete
  │         └─ reaction | edit/delete → authorized search
  ├─ remainingAmount primitive
  │   └─ Player-self charge read core
  ├─ self profile/clubs | sessions/waitlist | discovery | self-name route owners
  │   └─ slash registry → requester-only response → thin domain adapters
  ├─ KB storage/config → text ingest → URL/file adapters
  │   └─ index/CAS activation → retrieval → bot.ask
  │       ├─ structured @ClubBot adapter
  │       └─ private Club Bot thread
  ├─ DD-67 route integrity → protected Web Push subscription → provider attempts
  │   └─ installable PWA shell → registration client → display/telemetry client
  │       └─ DD-94 Chat unread notification
  └─ payment lifecycle intent
      ├─ reminder producer
      └─ settled/correction projector
          └─ Inbox/detail → generic payment push adapter

Every user-visible path then follows:
  one canonical core owner → one thin API adapter → one tracked-design FE slice
```

---

## 9. Implementation slices

Mỗi slice dưới đây là mechanism-named, target khoảng `≤300 LOC`, `≤3 modules`, tối đa một migration monotonic. Số là **stable catalog ID, không thay dependency graph**; cột dependency mới quyết định thứ tự chạy, nên slice 9 phải land trước 6/7/8. Từng runtime slice vẫn phải có manifest/prompt riêng và strict `CODE_READY` trên immutable authority SHA trước khi mở worktree. Slice 1 là executable first slice đã pin exact file budget ở §9.2.

**Explicit gate §B3 budget exception cho slices 2, 3, 4, 27, 36 và 37.** Sáu slice này là core migration nặng role/RLS/grants/authz, và precedent đo được trên chính repo cho thấy lớp migration đó thường vượt budget mặc định:

| Migration precedent trên `main` | LOC |
|---|---|
| `0021_non_money_tenant_integrity_fks.sql` | 222 |
| `0023_outbox_ack_marker.sql` | 301 |
| `0017_oauth_transactions.sql` | 478 |
| `0022_job_claim_lease_core.sql` (role + claim/lease + grants) | 568 |
| `0016_account_email_token_core.sql` | 824 |

Slice 2 (safety storage + pure predicates + `assert_dm_allowed` + grants + retention + invariant tests), slice 3 (final `chat_*` shape + DM read adapter + RLS/policies + read-helper owner/grants + invariant tests), slice 4 (cross-feature DD-56 capability authority), slice 27 (Assistant KB storage), slice 36 (DD-67 route integrity) và slice 37 (DD-72 subscription authority) đều thuộc lớp migration security/RLS tương tự `0022`. Owner chấp thuận ngoại lệ **scope ceiling, không phải target**:

- Slice 2: tối đa `750 changed LOC`, `≤3 modules`, đúng `1` migration monotonic; module set = migration + schema mirror + focused invariant test.
- Slice 3: tối đa `1,000 changed LOC`, `≤3 modules`, đúng `1` migration monotonic; module set = migration + schema mirror + focused RLS/catalog invariant test.
- Slice 4: tối đa `750 changed LOC`, `≤3 modules`, đúng `1` migration monotonic; module set = capability authority migration + schema/service mirror + focused role/grant/expiry/isolation/audit test. Sensitive grant/revoke UI/workflow tách follow-up nếu vượt scope; bốn Chat key chỉ dùng default DD-56 preset.
- Slice 27: tối đa `1,000 changed LOC`, `≤3 modules`, đúng `1` migration monotonic; module set = tenant KB storage/RLS migration + schema mirror + focused storage/isolation/DLP-state test. Ingest/retrieval/provider không thuộc slice này.
- Slice 36: tối đa `750 changed LOC`, `≤3 modules`, đúng `1` migration monotonic; module set = DD-67 route-integrity migration + schema mirror + focused same-Person/route-class/grant test.
- Slice 37: tối đa `1,000 changed LOC`, `≤3 modules`, đúng `1` migration monotonic; module set = protected Web Push subscription/receipt/trust migration + schema mirror + focused crypto/RLS/rebind test. Provider, service worker và business adapters không thuộc slice này.
- Compatibility proof: live repo chưa có `chat_*`, capability/KB/Web-Push target storage hoặc user chat/push data nên các migrations là additive/fresh-create; không rewrite lịch sử hoặc destructive backfill. Dù capability semantics độc lập với Chat schema, **actual worktrees 1→2→3→4 phải serialize** vì cùng chạm migration tail, `packages/db/schema.ts`, DB catalog tests và schema/authz invariants. Các route vẫn OFF; real app/migration/worker-role tests chứng minh owner/grants/RLS/catalog và failed migration rollback nguyên transaction.
- Vượt ceiling hoặc cần module thứ tư → `SCOPE_DESIGN` hard stop và re-slice. Cấm cắt grants, rollback proof hoặc invariant tests để ép budget.

| ID | Slice | In scope | Explicit out of scope / dependency |
|---|---|---|---|
| 0 | `docs-chat-primary-surface-contract` | Commit/push/re-pin exact DD-86/DD-91..95 pack và reconciled Chat/Assistant/Notification/Player/global mirrors | Không code; immutable SHA là gate trước mọi worktree |
| 1 | `chat-definer-role-provisioning` | Idempotent exact `chat_definer NOLOGIN NOSUPERUSER BYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION`; grant migration-role membership; production-equivalent attribute/membership/idempotency tests | Không chat table/function; exact executable packet ở §9.2 |
| 2 | `chat-dm-safety-authority-core` | Một migration độc lập `chat_*`: block/report/rate/audit storage + pure predicates + `assert_dm_allowed`; exact grants/retention/invariant tests | Hard-dep slice 1; §B3 exception `≤750 LOC/3 modules/1 migration` |
| 3 | `dd38-dd86-chat-schema-core` | Final `chat_channels/chat_members/chat_messages` shape, revision/search-ready message columns, pure DM read adapter, RLS/policies, owner/grants, invariants | Consumes slice 2; không moderation/mute/notification/command/API/UI; §B3 exception `≤1,000 LOC/3 modules/1 migration` |
| 4 | `tenant-capability-authority-core` | Canonical closed DD-56 action registry + least-privilege preset (`admin|co_admin` map cùng preset, never owner), tenant/person authority resolver, tenant-private grant-read storage with expiry/revocation constraints, append-only grant audit and fail-closed `authorize`; includes exact four Chat keys | Semantic core độc lập nhưng execution hard-dep 3 vì shared migration/schema/test scope; §B3 `≤750 LOC/3 modules/1 migration`; no feature mutation, Chat-local registry, `role.manage`/global grant, or sensitive grant UI/workflow |
| 5 | `chat-club-channel-lifecycle-core` | Create/rename/default/archive + atomic membership provisioning + DD-86 Assistant defaults/mutation + capability/idempotency | Hard-dep 3/4; không send/read |
| 6 | `chat-club-moderation-core` | DD-95-owned mute storage + club hide/restore/mute writers, exact `1h|24h|7d`, reasons/bounded other-note, receipts/audit; land dark trước send | Hard-dep 3/4/5/9; zero DM read/moderation, hard delete, content edit, permanent ban/system message |
| 7 | `chat-shared-message-command-core` | Sole `send_chat_message`, history/list và mark-read cho club+DM; reply + structured mention insert nguyên tử; idempotency, read-only active-mute/live-safety checks, leading-slash pre-insert fence | Hard-dep 2/3/4/5/6/9; không sở hữu mute storage/writer/receipt, create-DM/block/report/SSE/media/reaction |
| 8 | `chat-dm-lifecycle-command-core` | Sole create/reuse/block/report lifecycle trên safety guards; delegate send/read cho slice 7 and consume canonical opaque target resolution | Hard-dep 2/3/7/9; DM remains OFF tới safety E2E; không media/shared-core duplication |
| 9 | `chat-authorized-member-target-read-core` | Current-channel active human member DTO with short-lived requester+channel-bound opaque target ref + safe label plus canonical consume-time resolver for structured mention, timed mute and start-DM | Hard-dep 3/4/5; re-authorize membership/action at consume; no contact/gender/debt/global people search/fuzzy lookup, raw UUID authority or persistent target directory |
| 10 | `chat-realtime-unread-core` | Authorized topics, monotonic cursor, reconnect/history catch-up/unread/badge | Hard-dep 7/8; không provider delivery; không phụ thuộc DD-88 |
| 11 | `chat-media-upload-scan-core` | Private upload intent/storage grant, exact type/size/quota guards, malware scan worker and `pending|ready|quarantined` lifecycle | Hard-dep 7/8; no message attach, signed read, delete/orphan cleanup, interaction or Assistant |
| 12 | `chat-media-attachment-read-lifecycle` | Ready-only message attach, live-authorized signed read, delete/tombstone and bounded orphan cleanup | Hard-dep 7/8/11; no upload/scan implementation, reaction or Assistant |
| 13 | `chat-message-reaction-core` | Exact `👍|❤️|😂|😮|😢|🙏` desired state | Hard-dep 7; không reply/mention/edit/search/moderation |
| 14 | `chat-author-edit-delete-revision-core` | Own human body edit `<15m`, max 5 restricted revisions; irreversible author soft-delete/shared tombstone | Hard-dep 7; không hard delete, Assistant/system edit hoặc moderator content edit |
| 15 | `chat-authorized-search-core` | Generated PostgreSQL `simple` vector + current-readable/current-visible query, optional channel filter | Hard-dep 3/6/7/14; no revisions/tombstones/slash/private-bot content |
| 16 | `core-payment-remaining-primitive` | Extract `remainingAmount`; `effectiveFee` giữ null rồi delegate; regression đủ bốn current callers | Không DB/API; impact MEDIUM, bounded core + tests |
| 17 | `player-self-charge-read-core` | `getSelfPaymentStatus` + `/api/me/charges`, own eligible clubs/historical obligations, known amount/zero/unknown | Hard-dep 16; không Chat adapter |
| 18 | `player-self-profile-clubs-read-core` | `/api/me` + `/api/me/clubs` person-self DTO | Không charges/sessions |
| 19 | `player-self-sessions-waitlist-read-core` | Person-self read query over existing `players JOIN memberships JOIN sessions`; own upcoming/session status/waitlist DTO | Baseline tables merged; no full SessionService dependency, join/leave/mutation, roster-other-person or session business rule duplication |
| 20 | `marketplace-discovery-navigation-read` | Canonical safe discovery destination/read contract over guarded `public_sessions`; Chat only receives route/summary DTO | No Chat ranking/index, private session field or join mutation |
| 21 | `identity-self-name-navigation-flow` | Canonical authenticated self-name/profile-settings destination + current safe summary | No name mutation inside Chat, other-person lookup or raw person authority |
| 22 | `chat-slash-command-registry-core` | ASCII case-insensitive, zero-alias/arg eight-command catalog, precedence and exact surface matrix | Không private transport, domain handler hoặc LLM routing |
| 23 | `chat-requester-only-sync-response` | Authenticated transient renderer/picker; `private, no-store`; no result row/ref/SSE/outbox | Hard-dep 22; không `/pay` formula hoặc domain adapter |
| 24 | `chat-pay-command-adapter` | `/pay` thin adapter across three surfaces; eligible-club opaque selector | Hard-dep 17/22/23 |
| 25 | `chat-profile-navigation-command-adapters` | Thin `/me|/myclubs|/discover|/name` routes to canonical owners | Hard-dep 18/20/21/22/23; no duplicate business logic |
| 26 | `chat-session-command-adapters` | Thin `/sessions|/waitlist` club/bot-only adapters | Hard-dep 19/22/23; no session mutation/business logic |
| 27 | `assistant-kb-storage-authority-core` | Tenant-private KB source/document/chunk/job state plus bounded tone/config authority, RLS/grants, DLP state fence and deterministic source keys | §B3 `≤1,000 LOC/3 modules/1 migration`; no fetch/extract/chunk/embed/retrieve/provider |
| 28 | `assistant-kb-text-ingest-core` | FAQ/paste normalization, DLP-before-outbox, deterministic generation input | Hard-dep 27; no URL/file fetch, embedding provider or retrieval |
| 29 | `assistant-kb-url-ingest-adapter` | URL allowlist/SSRF/redirect/size/content extract feeding slice 28 | Hard-dep 27/28; no scheduler/global KB/provider answer |
| 30 | `assistant-kb-file-ingest-adapter` | Private PDF/DOCX/MD/TXT lifecycle/extract/DLP-before-provider feeding slice 28 | Hard-dep 27/28; no URL fetch/retrieval |
| 31 | `assistant-kb-index-activation-worker` | Generation re-check, deterministic chunk/FTS, embed provider outside transaction, provider-attempt audit and CAS activation; stale generation discard | Hard-dep 27/28; URL/file adapters optional; no answer provider or Chat projection |
| 32 | `assistant-kb-retrieval-core` | Tenant-isolated hybrid retrieval over active generation, citation contract, no-answer threshold and zero ledger/PII context | Hard-dep 27/31; no provider answer/message projection |
| 33 | `assistant-bot-ask-worker` | Async ask/provider attempts/result + 30-day raw retention/redaction | Hard-dep 32; DD-18 enablement gate khi bật provider |
| 34 | `assistant-chat-mention-adapter` | Structured mention → `bot.ask` → canonical assistant message | Hard-dep 7/9/33; consume-time gates; không phụ thuộc reaction |
| 35 | `assistant-private-thread-surface` | Derived `(tenant,person)` ask-panel thread + full slash composition | Hard-dep 22/23/24/25/26/33; no human DM/multi-turn memory |
| 36 | `notification-route-integrity-core` | DD-67 `platform`/`route_class`, person-bound delivery/attempt identity and one-route integrity prerequisites | §B3 `≤750 LOC/3 modules/1 migration`; no subscription secret/provider/business intent |
| 37 | `notification-web-push-subscription-authority-core` | DD-72 global-protected web subscription, registration/rebind/trust receipts, crypto key epoch and exact worker grant boundary | Hard-dep 36; §B3 `≤1,000 LOC/3 modules/1 migration`; consent remains enablement-only; no provider/SW/business adapter |
| 38 | `notification-web-push-provider-attempt-core` | Direct VAPID port, generic payload allowlist, stable topic, sticky attempt/retry outcome and server telemetry | Hard-dep 36/37 + worker substrate; no Chat/payment content, native provider or service worker |
| 39 | `pwa-installable-shell-core` | Minimal tracked manifest/installable shell, offline-safe app shell and service-worker registration boundary | Hard-dep F0 design authority; no push permission, notification display, business cache or native app |
| 40 | `web-push-registration-client` | Contextual permission prompt, register/revoke/device management client calling protected subscription API | Hard-dep 37/39; no provider send/display telemetry or forced prompt |
| 41 | `web-push-display-telemetry-client` | Generic service-worker notification display/deep-link plus scoped delivered/opened reporting and no-sensitive-cache fence | Hard-dep 38/39/40; no business detail rendering/native app |
| 42 | `chat-unread-notification-core` | DD-94 generic coalesced highest-unread signal, preferences, mark-read cancellation, send-time reauth/idempotency | Hard-dep 10/36/37/38/41; no durable item/content snapshot; timing config OFF until tested |
| 43 | `notification-payment-lifecycle-intent-core` | Canonical durable `reminder|settled|correction` intent/read contract + source-version idempotency | Notification DD-70..72; no scheduler/ledger-event producer/provider |
| 44 | `notification-payment-reminder-producer` | Bounded scheduler re-reads current open/partial ledger policy and emits exact reminder intent | Hard-dep 43 + scheduler/ledger outbox; no settled/correction or provider send |
| 45 | `notification-payment-settled-correction-projector` | Consume canonical settlement/reversal events and emit exactly-one settled then versioned correction | Hard-dep 43 + real payment/reconcile producer; no reminder scheduler/provider |
| 46 | `notification-inbox-payment-detail` | Durable Inbox + authenticated detail dùng `getSelfPaymentStatus` | Hard-dep 17/43/44/45 |
| 47 | `notification-web-push-payment-adapter` | Thin payment-intent → generic push/open-deep-link adapter, no amount | Hard-dep 38/41/43/44/45/46; no second provider/subscription/telemetry implementation |

### 9.1 API adapter workstream — required delivery boundary

Mỗi `A*` slice là thin HTTP adapter `≤300 changed LOC`, `≤3 modules`: app-role/session/authn, exact action authorization, validation, cache/privacy headers, DTO mapping và production-shaped route/security tests. Core slices `1–47` không ngầm sở hữu HTTP route; adapter không được re-derive money, membership, moderation, unread, KB hoặc notification state.

| Order | Slice | In scope | Explicit out of scope / dependency |
|---|---|---|---|
| A1 | `chat-channel-list-create-update-api` | Authorized club-channel list/create/rename routes | Hard-dep 5; no default/archive/send |
| A2 | `chat-channel-default-archive-api` | Atomic default switch/archive routes and receipts | Hard-dep 5; no lifecycle formula duplication |
| A3 | `chat-history-send-read-api` | History/cursor, send and mark-read routes for club+DM | Hard-dep 7/9/10; no DM creation or slash result persistence |
| A4 | `chat-dm-list-create-api` | Authorized DM list/create/reuse route | Hard-dep 8; no block/report/member discovery |
| A5 | `chat-dm-block-report-api` | Actor-scoped block/unblock/report routes with idempotency fingerprint | Hard-dep 8; no club moderation or DM-read grant |
| A6 | `chat-current-member-target-api` | Current-channel safe target list and start-DM delegation using short-lived requester+channel-bound opaque refs | Hard-dep 8/9/A4; no global people search, raw UUID, persistent directory or PII |
| A7 | `chat-reaction-api` | Exact desired-state reaction route | Hard-dep 13; no custom emoji |
| A8 | `chat-author-edit-delete-api` | Own edit/delete routes and bounded revision DTO | Hard-dep 14; no moderator edit/hard delete |
| A9 | `chat-authorized-search-api` | Current-readable search route and optional channel filter | Hard-dep 15; no count/oracle for excluded rows |
| A10 | `chat-media-upload-status-api` | Private upload intent and scan-status route | Hard-dep 11; no attachment/signed read |
| A11 | `chat-media-attachment-read-delete-api` | Ready-only attach, signed read and delete route | Hard-dep 12; no client-trusted authorization |
| A12 | `chat-club-moderation-api` | Hide/restore/timed-mute routes with exact reasons/receipts | Hard-dep 6/9; no DM moderation/read |
| A13 | `chat-slash-execute-private-picker-api` | Exact command execute + requester-only opaque picker continuation | Hard-dep 22–26; `private, no-store`, no result ref/replay endpoint |
| A14 | `assistant-private-thread-ask-api` | Derived private Club Bot thread list/ask route and mention status projection | Hard-dep 33–35; no human-DM transcript or ledger context |
| A15 | `assistant-kb-text-url-config-api` | Host-authorized FAQ/paste/URL source CRUD, tone/config and aggregate analytics routes | Hard-dep 27–29/33; no raw member transcript or provider secret |
| A16 | `assistant-kb-file-status-api` | Private file upload, ingest/index status and quarantine/error route | Hard-dep 27/30/31; no public object URL |
| A17 | `chat-notification-preference-api` | Chat unread preference read/update route | Hard-dep 42; no subscription/provider logic |
| A18 | `notification-inbox-payment-detail-api` | Authenticated payment Inbox list/detail route | Hard-dep 46; no amount snapshot/local formula |
| A19 | `web-push-subscription-device-telemetry-api` | Protected register/rebind/revoke/device and delivered/opened telemetry routes | Hard-dep 37/41; no business content/provider send |
| A20 | `marketplace-discovery-navigation-api` | Guarded discovery route/summary adapter | Hard-dep 20; no private fields or join mutation |
| A21 | `identity-self-name-navigation-api` | Authenticated self-name summary/settings destination | Hard-dep 21; no mutation/other-person lookup |

### 9.2 Executable first slice packet

Sau khi slice 0 có immutable SHA, first runtime slice là `chat-definer-role-provisioning`:

- **Exact files:** `infra/postgres-init/02-chat-definer.sql` (new), root `package.json` bootstrap command, `packages/db/src/migrate.test.ts`.
- **Budget:** `≤300 changed LOC`, `3 modules`, zero domain migration/table/API.
- **Acceptance:** first run creates exact role attributes and grants membership only to validated migration role; exact replay is no-op; wrong existing attribute, runtime-role target, missing/invalid migration role or concurrent bootstrap fails closed without partial grants; production-equivalent bootstrap precedes any migration referencing `chat_definer`.
- **Negative scope:** không chạm `job_definer`, `RUNTIME_ROLES`, app/runtime grants, `chat_*`, safety tables/functions hoặc queue provisioning.
- **Verification:** focused bootstrap/catalog tests + canonical DB suite; non-empty diff; strict G1–G6/12-of-12 `CODE_READY` packet on the re-pinned SHA before worktree.

### 9.3 FE/design workstream — required for primary-surface outcome

Các production FE slices `F1–F15` giữ `≤300 changed LOC`, `≤3 modules`, dùng real API contract (không mock business logic), đủ `loading|ready|empty|error`, keyboard/focus/screen-reader/WCAG contrast và responsive PWA. `F0` là một tracked design-authority handoff trong `design.pen`, không phải code-LOC slice; từng screen/state phải có owner acceptance. Chưa có F0 accepted thì mọi production FE slice HOLD.

| Order | Slice | In scope | Explicit out of scope / dependency |
|---|---|---|---|
| F0 | `chat-design-authority-handoff` | Persist/track root `design.pen`; owner approve Chat channel/thread/composer/command/bot/search/media/safety/moderation, Assistant KB manager/config/analytics, notification preferences/push onboarding/device/Inbox; pin token/component/API-state mapping | Không production FE; unresolved visual/state mapping keeps F1–F15 HOLD |
| F1 | `chat-fe-channel-list-shell` | Club/DM/bot-thread list, switcher, unread badges, four states, responsive nav | Hard-dep F0 + A1/A2/A4/A14; no thread/composer |
| F2 | `chat-fe-safe-member-target-picker` | Current-channel target picker for mention/mute/start DM using opaque refs and safe labels | Hard-dep F0/F1 + 9/A6; no global fuzzy search, raw UUID or PII |
| F3 | `chat-fe-thread-history-realtime` | Paginated history, reconnect/catch-up, tombstone/reply/mention render and scroll/unread affordance | Hard-dep F0/F1 + 7/10/A3; no composer/actions |
| F4 | `chat-fe-text-composer-send` | Accessible text composer, retry-safe send, structured mention selection and exact slash interception | Hard-dep F0/F2/F3 + 7/9/22/A3/A6; no command result/media |
| F5 | `chat-fe-requester-command-overlay` | Slash discovery/help, private typed card/picker/error, no-store/no-history UX | Hard-dep F0/F4 + 22–26/A13; no domain reimplementation |
| F6 | `chat-fe-private-bot-mention` | Structured `@ClubBot` progress/citation/no-answer and private Club Bot thread composition | Hard-dep F0/F3/F5 + 33–35/A14; no human-DM masquerade or ledger prompt |
| F7 | `chat-fe-message-interactions` | Exact reactions, own edit countdown/revision limit, irreversible author-delete confirmation/tombstone | Hard-dep F0/F3 + 13/14/A7/A8; no moderator edit/hard delete |
| F8 | `chat-fe-authorized-search` | Search entry/results/channel filter/four states, live auth-loss handling | Hard-dep F0/F3 + 15/A9; no local index/forbidden count |
| F9 | `chat-fe-media-lifecycle` | Upload/scan progress, ready preview, quarantine/error, signed viewer and deleted tombstone | Hard-dep F0/F3/F4 + 11/12/A10/A11; no client-trusted MIME/auth |
| F10 | `chat-fe-safety-moderation` | Block/unblock/report and capability-gated club hide/restore/timed-mute/reason UX | Hard-dep F0/F2/F3 + 6/8/9/A5/A6/A12; no DM moderation/read, hard delete or permanent ban |
| F11 | `notification-fe-inbox-payment-detail` | Inbox reminder/settled/correction list/detail, generic push deep-link and authenticated current self-payment render | Hard-dep F0 + 17/41/43–47/A18/A19; no amount in lock-screen payload/local formula |
| F12 | `assistant-fe-kb-source-manager` | Host FAQ/paste/URL/file source manager, upload/index progress, quarantine/error and active-generation state | Hard-dep F0 + 27–31/A15/A16; no public object URL/provider secret |
| F13 | `assistant-fe-config-tone-analytics` | Bounded Assistant tone/config controls and aggregate citation/no-answer/latency analytics | Hard-dep F0 + 27/33/A15; no raw private transcript/member-level surveillance |
| F14 | `chat-fe-notification-preferences` | Chat unread preference controls with exact defaults and four states | Hard-dep F0 + 42/A17; no push permission/subscription mutation |
| F15 | `web-push-fe-contextual-onboarding-devices` | Contextual install/permission education, register/revoke and device management | Hard-dep F0 + 37/39/40/41/A19; no forced prompt or business-detail cache |

### 9.4 Functional producer và enablement gates

- Slice 19 có thể author read-only từ baseline `players/memberships/sessions` đã merge, không chờ full SessionService. Tuy nhiên enable `/sessions|/waitlist` beta bắt buộc strict current-authority packets cho `svc-session-crud`, `svc-session-join-leave`, `svc-waitlist-promotion-core` và production-shaped data E2E. Tên cơ chế từ analysis cũ không tự là authority; từng packet phải re-author từ Session authority hiện tại.
- Payment Inbox/push không được enable chỉ vì read/adapter compile: phải có slices 43–45, real payment/reconciliation source producer, exactly-once/correction E2E và authenticated-detail parity.
- `/discover` và `/name` không còn dependency vô danh: authoring owner lần lượt là 20/A20 và 21/A21; mọi mutation/join vẫn ngoài scope.
- KB URL/file/provider và media chỉ enable khi DLP, object-storage region/credentials, malware/moderation scanner, provider/privacy/ToS và quarantine/CAS tests pass. Missing/unknown config giữ route OFF.
- Web Push chỉ enable sau DD-67 route integrity, protected subscription, provider attempts, installable shell, registration/display clients, explicit consent/device evidence và production telemetry.
- Scheduler luôn chọn dependency thấp nhất đã strict `CODE_READY`; initiative không tự vượt project roadmap hay biến enablement gate thành runtime proof.

---

## 10. Acceptance matrix

| Group | Input / precondition | Expected result | Test layer |
|---|---|---|---|
| Happy | Active member sends human message | One canonical message; authorized peers see after refetch | Integration/E2E |
| Happy | Active member `@ClubBot` with KB-covered question | One cited assistant answer in same channel | Integration/E2E |
| Happy | Player runs `/pay` in club channel | Requester sees current own amount; peer sees no command/result | Security E2E |
| Happy | Player runs `/pay` in private Club Bot thread | Same canonical status as protected Player View | Contract/E2E |
| Happy | Player runs `/pay` in human DM and has exactly one eligible club | Requester gets sync self-payment card; peer gets no command/event/unread/ref/result | Security E2E |
| Boundary | Human-DM requester has 0 / 2+ eligible clubs | Generic empty / requester-only opaque club picker; chosen club is re-authorized | API/E2E |
| Boundary | No open/partial charges after successful authoritative query | `known_zero` | Unit/integration |
| Boundary | Ledger/dependency/integrity cannot prove result | `unknown`; never zero | Fault injection |
| Boundary | `/pay @other` or body-supplied person/tenant | Reject; zero other-person lookup | API/security |
| Boundary | `/PAY`, `/pay arg`, unknown command and `/sessions` in human DM | `/PAY` canonicalizes to `/pay`; invalid-arg/unknown/unsupported cases return private typed error with zero message/Assistant mutation | Parser/API |
| Authorization | User B inspects A's DOM/history/SSE/cache and command APIs | No command input, amount, result, result ref or oracle | E2E/pen test |
| Authorization | Inspect success/picker/error command response and cache/proxy behavior | `Cache-Control: private, no-store`; typed outcome only; no `messageId|resultRef|eventId`, raw tenant/person authority or replay endpoint | API/security |
| Authorization | Cross-tenant channel/thread/ref guess | Generic deny/empty; no club/debt existence leak | DB/API |
| Authorization | Host/support reads private Club Bot transcript or human DM | Denied; aggregate analytics only | RLS/API |
| Authorization | Root migration catalog before post-root command slices | No `create_dm`, `send_chat_message`, `mark_read` or command HTTP route exists; pre-root safety owner unchanged | Migration/catalog test |
| Authorization | Iterate exact four Chat action keys across owner/legacy-admin/co-admin/player, typo/unknown/unavailable registry, expired/revoked/wrong-tenant grant and mid-request change | One DD-56 `authorize` authority serves every surface; `admin|co_admin` receive the same least-privilege preset and never owner rights; eligible owner/preset actions pass, player/unknown/stale deny, consume-time re-check prevents partial mutation, and no key grants human-DM read/moderation | DB/API/security |
| Authorization | List current-channel targets, then replay ref from another requester/channel, expire it, or remove membership/change tenant/block before mention, mute or start-DM consume | DTO contains short-lived requester+channel-bound opaque ref + safe label only; no contact/gender/debt/raw UUID/global-search oracle; wrong/replayed/stale ref fails generically and each consumer re-authorizes before mutation/message | DB/API/security |
| Authorization | `admins_only` post with role label admin but missing/unknown capability | Deny at canonical send core; only live `chat.channel.post_restricted` passes | DB/API |
| Failure | Assistant provider unavailable | Human chat works; KB ask generic error; `/pay` still deterministic | Integration |
| Failure | Command registry unavailable/unknown command | Private fail-closed help; never post raw slash | Unit/E2E |
| Concurrency | Duplicate human send | One message; one notify | DB/integration |
| Concurrency | Duplicate `bot.ask`/projector | One durable answer/message; attempts visible | Worker/integration |
| Concurrency | Duplicate `/pay` reads | Same current result; no duplicated audit/body storage | Integration |
| Concurrency | KB source generation N+1 supersedes N while old chunk/embed worker finishes late | Worker N records stale outcome but CAS cannot activate it; retrieval reads only complete active N+1 generation; no mixed chunks/provider attempt loss | Worker/DB |
| Migration | Sync main, allocate next available monotonic migration number, run with real migration/app roles | Safety objects precede root DM read policies; root has no command wrapper; post-root `create_dm` lands only in its sole-owner slice; objects/grants/RLS valid; no historical rewrite | DB migration |
| Security/privacy | Safety primitive missing/disabled/errors during migration/runtime probe | RLS/read false or generic deny; no chat/DM mutation | DB/integration |
| Security/privacy | Inspect prompt, outbox, shared NOTIFY, push, logs, analytics after `/pay` | No amount/charge/body/other-person data | Invariant scan |
| Security/privacy | Mention asks for debt | No ledger field in LLM context; KB guidance/no-answer only; no actual amount | Unit/E2E |
| Security/privacy | Exact retry/concurrent block, unblock or report; same key with changed fingerprint | One deterministic block transition or append-only report/audit effect; exact replay returns prior result; mismatch rejects before mutation | DB/API concurrency |
| Security/privacy | Numeric DM/media/report limits are not configured | Corresponding route stays OFF/fail-closed; no guessed unbounded/default path | Config/integration |
| Regression | Human DM block during live SSE | Stream closes by next event/heartbeat; no new body | Integration |
| Regression | Player View and `/pay` render same fixture | Same helper/status/remaining values | Contract test |
| Regression | Realtime unread runs with DD-94 delivery disabled | Cursor/history/badge work; zero provider delivery/durable item; enabling generic delivery does not create a second read state | Integration |
| Payment producer | Reminder scheduler retries; settlement event retries; later reversal/correction | Scheduler re-reads live open/partial state; exactly one source-version reminder/settled intent, later versioned correction, zero stale settled replay | Worker/domain/integration |
| Payment lifecycle | Open obligation → reminder; settlement; later reversal | Durable Inbox reminder; exactly one settled; later correction (not second settled) | Domain/integration |
| Payment privacy | Payment Web Push succeeds or provider fails | OS payload generic/no amount; authenticated detail matches `/pay`; provider failure does not remove Inbox item or change ledger | Integration/E2E |
| Retention | Advance chat clocks; moderator hides/restores | Không TTL/auto-delete/hard purge; shared view tombstone toggles; immutable actor/reason audit remains restricted | API/catalog |
| Retention | Inspect/mutate payment Inbox item | Fixed type + opaque source/event refs only; no title/amount/arbitrary snapshot; no mark-unread/archive/user-delete/hard purge | DB/API |
| Media | Upload wrong MIME/malware/over quota; attach before ready; read after auth loss/delete | Reject before attach/serve; signed access re-authorizes; deletion tombstones; orphan cleanup is bounded | Storage/integration |
| Reply/reaction | Cross-channel/tombstoned-target reply; forged mention; add/change/remove `👍|❤️|😂|😮|😢|🙏`; duplicate/out-of-set token | New tombstoned-target reply rejects; existing reply renders tombstone; mention targets immutable; exactly one allowed reaction/person/message, atomic replace/remove | DB/API concurrency |
| Author edit/delete | Own human message at `14:59`/`15:00`, revision 5/6; other actor; Assistant/system; author soft-delete retry | Only `<15m` and first 5 body edits pass; immutable fields cannot change; restricted revision audit preserved; author delete is idempotent, irreversible shared tombstone, never hard delete | DB/API/security |
| Search | Same words across readable/unreadable channels, visible/tombstoned rows, revisions, requester slash/private bot result; optional channel filter | Generated `simple` vector returns only current-visible canonical body from live-readable scope; auth loss removes result immediately; no oracle from excluded planes | DB/API/security |
| DD-72 push substrate | Register/rebind/revoke web subscription; generic payload; provider success/410/timeout; delivered/opened capability; reuse from Chat and payment | DD-67 route integrity → protected subscription → provider attempts → installable PWA shell → registration client → display/telemetry client; stable topic/sticky outcome; zero business content/amount; both adapters reuse the chain without a second sender | DB/worker/PWA/security |
| DD-94 digest | DM/direct mention/reply and club preference permutations; cursor coalescing; mark-read; auth/block/device/trust changes before send; timeout/retry | Defaults exact; one highest-cursor generic signal after realtime unread + full DD-67→DD-72 chain; obsolete pending cancelled; live false/unknown skip+audit; retry/unknown never duplicates; zero content/durable item | Worker/integration/security |
| DD-86 final | Option-B DM-null metadata, default swap race, auto-provision, capability/idempotency/creator/Assistant defaults | Exactly-one default; `all_members` starts Assistant true, `admins_only` false; both mutable only with manage + full gates; every invariant Q1–Q4/Q6–Q10 fails closed | DB/concurrency/security |
| Moderation | Hide/restore; `1h|24h|7d` mute; exact reasons/other-note; replay/mismatch; host probes DM/system/permanent ban | Exact capability + immutable actor/reason audit; mute blocks write not read and expires by DB time; every forbidden scope denies without DM-read grant/hard delete | API/security/concurrency |
| API adapters | Exercise A1–A21 with real app role/session, auth loss, malformed/stale opaque refs and cache inspection | Adapter delegates to exactly one core owner, maps bounded DTO/error, applies exact auth/privacy headers, and introduces no second state/formula or route-local authorization shortcut | Route/contract/security |
| Host Assistant UI | Exercise F12/F13 source CRUD, file quarantine/index progress, tone/config and aggregate analytics | Four states map to A15/A16; stale generation cannot appear active; no provider secret/public URL/raw private transcript/member-level analytics | Component/E2E/security |
| Chat notification UI | Exercise F14/F15 defaults, deny/dismiss/grant, install unavailable, device revoke and auth loss | Preferences remain separate from consent; prompt is contextual/non-forced; revocation/device state converges through A17/A19; no sensitive local cache | Component/PWA/E2E |
| Observability | Success/deny/unknown | Enum/outcome/latency metrics only; no raw content/amount | Telemetry test |
| FE/accessibility | Run F1–F15 against production-shaped APIs at phone/tablet/desktop widths, keyboard-only, screen reader and auth-loss/error states | Exact design-authority states render; no mock business logic/private result leakage; focus/contrast/announcements pass WCAG checks; responsive PWA remains usable offline/read-only where specified | Component/E2E/visual/a11y |

### 10.1 `/pay` privacy invariant bắt buộc

Test production-shaped có hai member A/B cùng một club channel:

1. A submit `/pay`.
2. A nhận typed private result.
3. B đang online không nhận shared event/result và không có private result ref nào tồn tại.
4. B reload history/unread không thấy slash hoặc card.
5. DB `chat_messages`, outbox, `processed_commands.result_ref`, notification rows không chứa command body/amount; command result không có persisted row/ref.
6. Logs/analytics/push payload không chứa amount, charge/session ref hay club name.
7. B gọi command endpoint bằng session của B chỉ có thể nhận dữ liệu của B; không có ref/replay surface của A để probe.

---

## 11. Rollout và exit gates

### 11.1 Rollout

1. **Dogfood staff/tenant #1:** club channel + read commands; Assistant và DM có kill switch riêng.
2. **Closed beta 3–5 clubs:** enable Assistant KB + private Club Bot thread; keep mutation slash OFF.
3. **Player self-service beta:** enable `/pay`/read commands after privacy invariant and Player View parity green.
4. **Primary-surface cohort:** enable DD-94 generic Chat digest only after unread/push/privacy gates; enable payment Inbox `reminder|settled|correction` + generic Web Push independently. External chat remains fallback/deep-link.
5. **GA:** only after exit gates below and provider/privacy/ops enablement gates pass.

### 11.2 Owner-final product exit gates

- `0` confirmed cross-person/cross-tenant privacy leak; any leak = immediate disable affected surface.
- `100%` automated `/pay` privacy matrix pass on every deploy.
- `100%` payment lifecycle matrix pass: reminder durable, settled exactly once, reversal tạo correction, generic push và authenticated detail parity.
- Online message send→visible p95 target `≤2s`; reconnect catch-up has no loss/duplicate in soak test.
- ≥`80%` of defined player self-service intent catalog completes in-app without Zalo/Messenger.
- ≥`90%` KB answers carry valid citation or explicit `no_answer`; zero unsupported factual answer in golden set.
- Payment Web Push timing/cooldown remains evidence-based enablement config under DD-72. Chat digest timing/coalescing remains enablement-only under DD-94; missing/untested config keeps it OFF. DD-88 không chi phối hai contract này.
- Cohort support tickets show users can discover `/pay`, private bot thread, unread và channel switching without operator training.

### 11.3 Kill switches / rollback

- Separate flags: club messaging write, DM, media, Assistant, slash read, slash mutation, push.
- Disable Assistant không chặn human chat hoặc deterministic `/pay`.
- Disable mutation slash giữ read slash và native UI handlers.
- Sau user data, rollback schema bằng forward-fix + surface disable; không drop chat/history.
- Push failure không rollback canonical message/command result.
- Payment push failure không xoá durable Inbox item và không rollback/change ledger state.

---

## 12. Decision/readiness register

| ID | Decision/blocker | Owner-final state 2026-07-28 | Authority |
|---|---|---|---|
| CHAT-PRIMARY-Q1 | **Roll-up DD-86**: 9 in-scope channel decisions | **RESOLVED · 9/9** — Option B, all-active-member auto-provision, Announcements = admins-only chat surface tách DD-71, exact capabilities, Assistant defaults true `all_members`/false `admins_only` and mutable on both under full gates, exact-one lifecycle, receipts, creator composite FK, no public URL | DD-86 ✅ |
| CHAT-PRIMARY-Q2 | Reply/reaction/edit/delete/search floor | **RESOLVED** — reply/structured mention, exact emoji reactions, bounded own edit/revisions, irreversible author tombstone, beta-required authorized PostgreSQL search; no hard delete | DD-92 ✅ |
| CHAT-PRIMARY-Q3 | Private Club Bot model | **RESOLVED DD-91** — derived `(tenant,person)` ask-panel; không human DM/bot Person | Mirror vào Assistant pair |
| CHAT-PRIMARY-Q4 | Assistant entitlement | **CLOSED trước plan** — DD-22/DD-29: Host Pro, exact `assistant_ai_kb` | Không mở limited-free mode trong initiative này |
| CHAT-PRIMARY-Q5 | Slash grammar/catalog × surface | **RESOLVED** — ASCII case-insensitive, zero alias/arg; six common commands trên cả ba surfaces, thêm `/sessions|/waitlist` chỉ club/bot; invalid/unsupported private reject | DD-93 ✅ |
| CHAT-PRIMARY-Q6 | `/pay` detail/pay action | **RESOLVED DD-91 cho v1** — own total + breakdown + zero/unknown; QR/action chỉ xuất hiện khi protected renderer dependency land | Payment DTO/contract tests |
| CHAT-PRIMARY-Q7 | Private retention | **RESOLVED trong contract hiện có** — slash sync không persist body/amount/ref; private Assistant thread tái dùng `bot_queries` TTL mặc định 30 ngày + purge hằng ngày redact question/answer, giữ metadata phi-PII | V1 không có host retention override/UI; tests Assistant BE #21/#25 |
| CHAT-PRIMARY-Q8 | Unread/push/digest | **RESOLVED** — Chat unread sole source; generic highest-cursor coalescing, exact preferences/defaults, mark-read cancellation, pre-provider live reauth, sticky retry; zero durable item/content snapshot | DD-94 ✅ |
| CHAT-PRIMARY-Q9 | Moderation granularity | **RESOLVED** — exact club-only capabilities, `1h|24h|7d`, exact reasons/bounded other-note, receipts/audit; mute blocks write not read; zero DM moderation/read | DD-95 ✅ |
| CHAT-PRIMARY-Q10 | Product exit thresholds | **RESOLVED CONTRACT / ENABLEMENT_ONLY EVIDENCE** — numerical quality/privacy gates §11.2 final; delivery timing remains measured config | Owner 2026-07-28 |
| CHAT-PRIMARY-Q11 | Requester-only result transport | **RESOLVED DD-91** — sync authenticated `private, no-store`; no result row/ref/SSE/replay store | Slice 23 implements exact invariant |
| CHAT-PRIMARY-Q12 | Remaining formula owner | **RESOLVED DD-91** — extract `remainingAmount`; `effectiveFee` keeps null then delegates; service owns unknown | Impact MEDIUM verified; only `effectiveFee` changes, four callers remain unchanged and get regression coverage |
| CHAT-PRIMARY-Q13 | Block/report command replay | **RESOLVED v1 contract** — actor-scoped UUID receipt + canonical fingerprint; exact replay returns prior safe result, mismatch rejects; one append-only report/audit effect | Safety contract + tests #62 |
| CHAT-PRIMARY-Q14 | Human-message retention | **RESOLVED** — no TTL/auto-purge/hard delete; author/moderator tombstones and restricted revisions/audit preserve canonical record | DD-92/DD-95 |
| CHAT-PRIMARY-Q15 | Notification mirror classification | **RESOLVED/CLASSIFIED** — DD-94 owns exact delivery-only digest; DD-88 is broader `DEFERRED_PROPOSAL`; payment lifecycle unchanged | DD-70..72/DD-88/DD-94 |

**Cách đếm 13/13 owner choices.** Chín câu DD-86 + bốn contract clusters DD-92..95 = **13/13** product decisions ratified. Các row Q3/Q4/Q6/Q7/Q10–Q15 là propagation/readiness checks của authority đã có, không phải product choice còn mở. `OPEN_QUESTIONS_IN_SCOPE: 0`. DD-18 provider/privacy, Web Push consent/device và DD-94 timing config không đổi dark contract nên chỉ là named `ENABLEMENT_ONLY`.

---

## 13. Canonical readiness verdict

```text
REVIEW_POLICY_VERSION: 1.3
REVIEW_VERDICT: PLAN_READY
REVIEWED_AT: 2026-07-28
AUTHORITY_SHA: 90d292d85fbe92db7a5afcd118a99e28f3d3b3b7
BASE_BRANCH: main
BASE_REMOTE_RELATION: MAIN_EQUALS_ORIGIN_MAIN
PRIOR_SNAPSHOT: 2dc9b8c760c3b437af08ca1fc5fcbaea1492ad39 (v1.7); delta to current = this authority pack only, 27 files, no unrelated WIP
WORKTREE_STATE: AUTHORITY_PACK_COMMITTED_AND_PUSHED; 73 unrelated WIP files remain dirty and are outside this baseline
TARGET_FILES:
  - docs/proposals/in-app-chat-primary-player-surface-plan-2026-07-27.md
  - docs/decisions/analysis/dd-86-in-app-multi-channel-analysis.md
  - docs/features/feature_inapp_chat.md
  - docs/features/BE/feature_inapp_chat_tech.md
  - docs/features/feature_club_assistant.md
  - docs/features/BE/feature_club_assistant_tech.md
  - docs/features/feature_player_view.md
  - docs/features/BE/feature_player_view_tech.md
  - docs/features/feature_notifications_reminders.md
  - docs/features/BE/feature_notifications_reminders_tech.md
  - docs/features/feature_tenant_routing_authz.md
  - docs/features/BE/feature_tenant_routing_authz_tech.md
  - docs/features/README.md
  - docs/proposals/club-ai-bot-knowledge-base.md
  - docs/proposals/plexco-global-kb-and-kb-autosync.md
  - docs/proposals/notification-grouping.md
  - docs/product/BRD.md
  - docs/product/PRD.md
  - docs/product/TDD.md
  - docs/product/ROADMAP.md
  - docs/README.md
  - docs/00-start-here/HANDOFF.md
  - docs/autopilot-backlog.md
  - docs/standards/decisions.md
  - docs/standards/feature-dependency-graph.md
  - docs/standards/business-rules.md
  - docs/standards/BUILD-STATUS.md
SLICE: inapp-chat-primary-player-surface-plan
IN_SCOPE: club/human chat floor; Club Assistant mention/private thread; requester-only slash architecture including human DM; /pay self-payment contract; payment notification parity; dependency-ordered slices
OUT_OF_SCOPE: runtime implementation; external chat bridge; E2EE/voice/video; typing/presence/granular read receipts; LLM-selected money/session tools; unowned host-money commands; autopilot artifacts/worktree
G1_DECISION: PASS
G2_SPEC: PASS
G3_DEPENDENCY: PASS
G4_TEST: PASS
G5_SCOPE: PASS
G6_EXTERNAL: ENABLEMENT_ONLY:DD-18-provider-privacy-ToS;DD-72-Web-Push-user-consent;DD-94-digest-timing-config;MEDIA-private-object-storage-region-credentials;MEDIA-malware-moderation-scanner;DD-55-DM-media-report-bounded-config
HARD_DEPENDENCIES: baseline memberships/persons/tenants/tenant_admins/outbox/job substrate MERGED; missing DD-56, Chat/Assistant/Player/Notification/Web-Push runtime and product delivery are fully ordered and owned by bounded mechanism slices 1-47, thin API slices A1-A21 and tracked-design FE slices F0-F15; /sessions|/waitlist beta additionally requires strict current-authority svc-session-crud, svc-session-join-leave and svc-waitlist-promotion-core packets plus production-shaped data E2E
PRIOR_SLICES: immutable authority commit/re-pin -> serialized DB lane chat-definer-role-provisioning -> chat-dm-safety-authority-core -> dd38-dd86-chat-schema-core -> tenant-capability-authority-core -> chat-club-channel-lifecycle-core -> chat-authorized-member-target-read-core -> chat-club-moderation-core -> chat-shared-message-command-core; catalog IDs remain stable but actual worktree order follows explicit dependencies; every later BE/worker/client/FE slice requires its own strict CODE_READY
OPEN_QUESTIONS_IN_SCOPE: 0
ENABLEMENT_ONLY_GATES: DD-18 provider/privacy/ToS for Assistant; Web Push permission/device evidence; DD-94 measured timing/coalescing config; private object-storage region/credentials; malware/moderation scanner; bounded DM/media/report numeric config; current Session producer packets and data E2E for /sessions|/waitlist; real payment/reconciliation producer E2E for payment Inbox/push; cohort telemetry thresholds
LIVE_REPO_VERIFICATION: PASS
CONTRACT_MATRIX: PASS
CLOSURE_MATRIX: PASS — 12/12; row 1 closed by immutable commit 90d292d
ACCEPTANCE_MATRIX: PASS
SECURITY_AND_MIGRATION_GATE: PASS
IMPLEMENTATION_ARTIFACTS: NOT_REQUIRED_FOR_PLAN_READY — §9.2 pins an executable first-slice file/budget/acceptance/negative-scope packet equivalent to gate B1-B3; gate B4 items 4-7 (autopilot slice doc, manifest, launcher, worktree, scope gate) are deliberately not authored and are owed by the slice-local CODE_READY packet
FIRST_IMPLEMENTATION_STEP: author the chat-definer-role-provisioning readiness packet per §9.2 and take it through its own strict CODE_READY; no worktree before that verdict
REMAINING_BLOCKERS: none
```

### 13.1 Closure matrix 12/12

| # | Gate | Evidence | PASS/FAIL |
|---|---|---|---|
| 1 | Authority snapshot pin theo SHA | `90d292d85fbe92db7a5afcd118a99e28f3d3b3b7` trên `origin/main`; commit chứa đúng 27 `TARGET_FILES`, 0 file lạ | PASS |
| 2 | Decision trong scope đã chốt | DD-86 `DECISION_FINAL` (Q1..Q10 ratified) + DD-91..95 ✅ trong `../standards/decisions.md`; §12 = 13/13 | PASS |
| 3 | Scope IN/OUT và owner rõ | §13 `IN_SCOPE`/`OUT_OF_SCOPE`; mọi mechanism có owner slice 1–47 / A1–A21 / F0–F15 | PASS |
| 4 | Dependency phân loại đủ | §8.3 DAG; baseline substrate `MERGED`, phần còn lại `PRIOR_SLICE` có owner + thứ tự, gate ngoài là `ENABLEMENT_ONLY` | PASS |
| 5 | Live schema/code khớp doc | §8.1/§8.2 đối chiếu `90d292d`: migration tail `0024`, `chat_*` và `/api/me*` chưa tồn tại, `payments-logic.ts` 4 caller | PASS |
| 6 | Data/API/state/auth contract đủ | Năm cặp Product+BE `Reviewed` (Chat, Assistant, Player View, Notification, Tenant Routing/Authz) | PASS |
| 7 | Fail-closed/idempotency/order đủ | §4.1 decision table; §5.3 `unknown` không coerce về zero; receipt/fingerprint theo DD-92/93/95 | PASS |
| 8 | Open question trong scope = 0 | §12 register; `OPEN_QUESTIONS_IN_SCOPE: 0` | PASS |
| 9 | Acceptance matrix có expected result | §10 + §10.1 privacy invariant 7 bước production-shaped | PASS |
| 10 | Migration/security/rollback pin | §9 budget exception có ceiling + hard stop; §11.3 kill switch/rollback; next monotonic number, không hard-code `0025` | PASS |
| 11 | First slice có hard dependency merged | Slice 1 `chat-definer-role-provisioning` chỉ dựa `infra/postgres-init/` + `packages/db/src/migrate.test.ts`, cả hai đã có trên default branch | PASS |
| 12 | Implementation handoff sẵn sàng | §9.2 packet: exact files, budget, acceptance, negative scope, verification commands | PASS |

**Kết luận:** 13/13 product choices đã đóng, companion contracts + dependency/scope/acceptance/security gates PASS, và immutable-authority row đóng bằng `90d292d`. Initiative đạt **`PLAN_READY`**.

`PLAN_READY` nghĩa là **đủ contract để tách slice và viết execution plan** — không hơn. Nó **không** chứng minh dependency đã merge, **không** chứng minh slice nào code được, và **không** authorize mở worktree. Bước kế tiếp là author readiness packet cho slice 1 `chat-definer-role-provisioning` và đưa nó qua strict `CODE_READY` của riêng nó. Directive của file này giữ `enforce`, không phải `code-ready`: đây không phải coding handoff.

---

## 14. Changelog

| Ngày | Version | Thay đổi |
|---|---|---|
| 28/07/2026 | v1.8 | **`NOT_PLAN_READY` → `PLAN_READY`.** Blocker cuối cùng và duy nhất — authority pack chưa nằm trong commit bất biến — đã đóng: `90d292d` chứa **đúng 27 `TARGET_FILES`**, 0 file lạ, 73 file WIP không liên quan cố ý loại khỏi baseline; đã push lên `origin/main`. Re-pin `AUTHORITY_SHA` `2dc9b8c` → `90d292d`, `PRIOR_SNAPSHOT` → `2dc9b8c`, `WORKTREE_STATE` → committed/pushed, `CLOSURE_MATRIX` `PARTIAL 11/12` → `PASS 12/12`, `REMAINING_BLOCKERS` → `none`, bỏ `NEXT_REVIEW_TRIGGER` (field của nhánh fail). Thêm §13.1 bảng closure 12/12 có evidence từng dòng thay vì chỉ khẳng định con số. Hạ `IMPLEMENTATION_ARTIFACTS` `PASS` → `NOT_REQUIRED_FOR_PLAN_READY` cho đúng: §9.2 tương đương B1–B3, còn B4 mục 4–7 (autopilot doc/manifest/launcher/worktree/scope gate) cố ý chưa author và do slice-local `CODE_READY` nợ. Directive giữ `enforce`. Không thêm feature, không đổi decision, không authorize code. |
| 28/07/2026 | v1.7 | **13/13 owner-final closure + full readiness reconciliation.** Mirror DD-86 defaults true `all_members`/false `admins_only`; DD-92 exact emoji reaction, bounded edit/author tombstone/search; DD-93 ASCII case-insensitive eight-command surface matrix; DD-94 generic coalesced digest; DD-95 exact club moderation. Promote Assistant/Notification/Authz companion authority to Reviewed; expand the bounded delivery graph to mechanism slices 0–47, thin HTTP adapters A1–A21 and tracked-design FE slices F0–F15; pin the executable first slice. Final semantic freeze adds DD-56 authority + append-only grant audit, safe current-channel member targeting, KB generation/CAS activation, DD-67→DD-72 full Web Push client chain, payment reminder/settled/correction producers and explicit Session/payment/media/provider enablement gates; serializes colliding DB worktrees and canonicalizes mechanism IDs across plan/graph/BE. G1–G5, contract, acceptance and security/migration gates PASS; `NOT_PLAN_READY` remains solely because exact authority pack has no immutable commit SHA. No runtime/code authorization. |
| 28/07/2026 | v1.6 | **Historical snapshot superseded by v1.7.** It temporarily treated the broader interaction/command/digest contract as unratified and listed four readiness blockers; owner-final DD-92..95 and reconciled companion specs close those content blockers. |
| 28/07/2026 | v1.5 | **Re-review fix pass; verdict giữ `NOT_PLAN_READY`.** Live-truth re-verify tại `2dc9b8c` xác nhận DD-91 đóng Q11/Q12 hợp lệ, `remainingAmount` giữ `Math.max(0,…)` nên bốn caller bất biến, `assistant_ai_kb` là owner-final contract key còn `job_definer` là live runtime entity. Hai finding còn lại được đóng: (1) **`G5_SCOPE` PASS → PARTIAL** — slice 3/4 lặp lại budget `≤300 LOC` mà chưa đo; §9 nay ghi precedent đo được trên repo (`0022` = 568, `0016` = 824, `0017` = 478) và pin điều kiện nhị phân tại author time: đo `≤300`, hoặc explicit §B3 exception + compatibility proof, hoặc tách — cấm ép budget bằng cách cắt invariant tests/grants. Blocker tương ứng thêm vào §13. (2) `feature_player_view_tech.md` snippet thu hẹp signature `effectiveFee` thành object literal `paid_amount: number \| null`, bỏ optional của live `OpenDebt` — implement đúng chữ sẽ vỡ typecheck bốn caller, mâu thuẫn chính ràng buộc DD-91; đã trả về `(d: OpenDebt)` + guard `undefined` (spec v2.6). Không thêm feature, không tự chốt decision. |
| 27/07/2026 | v1.4 | Semantic-audit closure: root chỉ owns schema + pure read adapters/RLS; shared post-root core owns send/history/mark-read, DM lifecycle core owns create/reuse/block/report. Safety authority có thể land song song với DD-86 closure; root waits both. Fix `remainingAmount` scope để bốn callers tiếp tục gọi `effectiveFee`. Close stale Assistant retention/ask/async OQ, pin block/report idempotency + no-purge chat retention, classify Notification snapshot/retention/enablement gates. Open count 14→13; add missing acceptance rows nhưng honest gate hạ `G4_TEST`→PARTIAL và `ACCEPTANCE_MATRIX`→FAIL tới khi 13 decisions được đóng. |
| 27/07/2026 | v1.3 | Re-pin `main==origin/main@2dc9b8c`; delta sau v1.2 chỉ là readiness artifacts của slice DB constraint-naming, không chạm blast radius và không đổi `NOT_PLAN_READY`, 14 open questions hay dependency order. |
| 27/07/2026 | v1.2 | **Full fix pass; verdict giữ `NOT_PLAN_READY` nhưng loại toàn bộ blocker giả.** Re-pin `main==origin/main@81b4fe8`; migration dùng next monotonic number thay vì hard-code sau `0024`. Pin DD-91: `/pay` chạy trong human-DM requester-only overlay với one/many/none eligible-club selection; sync authenticated `no-store`, không result row/ref/SSE/outbox/push/history; Assistant giữ Host Pro `assistant_ai_kb`; extract `remainingAmount`, `effectiveFee` giữ null rồi delegate; payment reminder/settled/correction dùng durable Inbox + generic Web Push/authenticated detail. Sửa DAG thành safety contract → `chat_definer` provisioning → safety-authority migration → root chat migration; payment primitive đứng trước Player View; core unread và payment parity không còn chờ DD-88, chỉ offline digest chờ. Thêm production-shaped acceptance cho human DM, safety ordering, no-ref transport, notification lifecycle và DD-88-off. Reclassify Q4/Q11/Q12 closed, Q10 enablement-only; open count 20→14. Mirror đồng bộ DD-86, decisions, Chat, Assistant, Player View và Notification Product/BE; không runtime/code authorization. |
| 27/07/2026 | v1.1 | **Review-fix pass, verdict giữ nguyên `NOT_PLAN_READY`.** (1) Re-pin `AUTHORITY_SHA` sang `6ae2de6` — v1 khẳng định `main == origin/main` tại `03a134e` trong khi main đã đi trước 1 commit docs-only; ghi delta là out-of-blast-radius thay vì im lặng. (2) `OPEN_QUESTIONS_IN_SCOPE` 10 → 20: v1 đếm số row §12, nhưng row Q1 gộp 9 blocker rời của DD-86 (`DD-86-Q5` deferred, không tính); thêm quy tắc đếm tường minh. (3) Thêm `CHAT-PRIMARY-Q11` — transport của requester-only result (§5.4) từng là "khi khả thi / nếu async" không owner; giờ là hard gate của slice 10. (4) Thêm `CHAT-PRIMARY-Q12` — design probe slice 8 từng nằm ngoài register; §5.2 nay pin ba điều probe phải trả lời: lệch nullability `OpenDebt` vs `charges` (cả `max(0,…)` lẫn nhánh `null` là dead code qua mapper), owner của `unknown` là service layer chứ không phải null-fee, và impact analysis trên ≥4 caller trước khi author. (5) §7 dòng `Unread` đổi thành conditional delta theo DD-88 (🟡 proposal, chưa authority) + gate vào slice 4/17. (6) Thêm negative scope cho `player_chat_context` (`schema.ts:744`) — không slice nào chạm. Không thêm feature, không tự chốt product decision nào; ba blocker mới đều có owner + binary resolution. |
| 27/07/2026 | v1.0 | Bản đầu: capability floor, parity map, UX contract, interaction router, `/pay` canonical contract, slice order, acceptance matrix, rollout/exit gates, decision register và verdict `NOT_PLAN_READY`. |
