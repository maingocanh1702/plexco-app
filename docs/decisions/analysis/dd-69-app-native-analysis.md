# 📱 DD-69 Analysis — App-native (phase-2) + Shared API contract (web PWA ⇄ native)

> **Mục đích:** (A) đề xuất framework native cho phase-2, (B) pin shared API/auth/push/offline boundary để **web app PWA (phase-1)** và **app native (phase-2)** dùng chung một backend canonical mà không fork business rules.
> **Ngày:** 2026-07-18 · **Trạng thái:** ✅ Định hướng accepted (owner 18/07, decisions v1.47); technical gates mở tới phase-2 · **Canonical:** HANDOFF §1–2 (stack) · `feature_web_auth_onboarding(.md/_tech)` (cookie/`web_sessions`) · `player-side-saas-AUDIT.md` G2 (native token) · DD-07 (SSE) · DD-67 (channel endpoint reachability) · DD-10 (Next.js) · companion `strategy/native-app-strategy.md`. Ghi → `standards/decisions.md` DD-69.

---

## 0. TL;DR (đề xuất)

- **Framework target phase-2: React Native + Expo.** Một codebase TypeScript cho iOS+Android phù hợp solo founder. Lợi thế reuse nằm ở **client-safe contracts/format helpers cần tách rõ trước khi native build**, không phải import nguyên `packages/core`. Chính xác: root barrel `@plexco/core` **là browser-safe** (barrel comment tự khẳng định; i18n *không* re-export ở đây), nên `matching`/`payments-logic`/`fmtMoney` kỹ thuật import được vào bundle native — server-only thật sự chỉ là subpath `@plexco/core/i18n` (`node:async_hooks`). Lý do tách contracts vì thế là **kiến trúc (HR3: không đẩy money *decisioning* xuống thin client + muốn whitelist DTO/error/i18n-key)**, không phải bundling hazard. EAS Update chỉ vá JS/assets tương thích với native runtime; đổi native module vẫn phải rebuild/store review.
- **Phase-1.5 Capacitor chỉ là optional spike, không phải cam kết.** Chỉ đánh giá sau khi S9 `web-pwa-shell` + S20 `pwa-polish` thật sự land và có Lighthouse/device evidence. Wrapper phải có native value đủ vượt App Store minimum-functionality review; không claim “vào store trong ngày” hay “gần 0 code”.
- **API contract: một canonical API, hai auth transport.** Web giữ cookie session; native dùng Google Authorization Code + PKCE và, khi ship iOS, Sign in with Apple/equivalent privacy login theo App Review 4.8, rồi nhận bearer access 15m + rotating refresh 30d. Cả hai resolve về cùng `Account/Person`; target tenant/action luôn được server derive + re-authorize riêng.
- **Realtime:** SSE foreground; push background qua protected `device_push_subscriptions` theo person/app-installation. Push **không** phải `ChannelIdentity` và không nhét vào `channel_reachability`; DD-67 vẫn sở hữu exact Page/bot/OA route. Notification policy hợp nhất hai nguồn ở dispatcher và dedup bằng logical key.
- **Offline v1 = read-only.** Không queue mutation join/leave/pay/money/identity/admin. `processed_commands` chỉ áp cho tenant-domain commands; auth/identity/device lifecycle dùng primitive riêng. Money engine + gating + merge luôn server-only; không nới 3 tầng hiển thị/RLS/HR.

---

## 1. Bối cảnh & ràng buộc quyết định

| Ràng buộc | Sự thật on-disk | Ảnh hưởng lựa chọn |
|---|---|---|
| **Solo founder** | Một người build/vận hành | Một native codebase > hai; giảm ngôn ngữ/toolchain |
| **TS toàn stack** | `packages/core` TS, `apps/web` Next.js, `apps/bot` TS | RN thuận ngôn ngữ; **không đồng nghĩa toàn bộ core client-safe** |
| **Client boundary hiện tại** | root barrel `@plexco/core` **browser-safe** (i18n không re-export); chỉ subpath `@plexco/core/i18n` server-only (`node:async_hooks`); barrel vẫn export `matching`/`payments-logic` | Tách `packages/contracts`/client-safe subpath vì **kiến trúc HR3** (whitelist DTO/error/i18n-key, không đẩy money decisioning xuống client), không phải vì bundling hazard; cấm app cầm money engine |
| **Canonical store, no multi-master** | HR3: surface gửi command; rule sống server-side | Native là thin client; không copy capacity/waitlist/gating/money/merge |
| **Money/PII nhạy cảm** | HR2/HR4; AUDIT G2 | Secure storage + refresh rotation; push/cache không chứa tiền/PII |
| **Realtime = SSE + LISTEN/NOTIFY** | DD-07 | Foreground dùng SSE; background cần APNs/FCM push |
| **Web = cookie session** | `web_sessions` httpOnly/sameSite=strict | Native cần bearer branch; không thay cookie contract của PWA |
| **Native không force-update** | User có thể giữ app cũ | API versioned/backward-compatible; OTA không thay native runtime/contract |
| **PWA là target, chưa live** | S9/S20 tồn tại trong autopilot plan; `apps/web` hiện chưa có manifest/service worker | Capacitor chỉ được spike sau PWA evidence, không coi asset đã sẵn |
| **Store policy** | iOS review chặn repackaged website và third-party login thiếu privacy-equivalent option | Bắt buộc store-compliance gate trước phase-1.5/native GA |

---

## 2. PART A — So sánh framework

### 2.1 Ma trận quyết định (trọng số theo §1)

| Tiêu chí | Trọng số | Capacitor (sau PWA evidence) | **React Native + Expo** | Flutter | Native thuần |
|---|---|---|---|---|---|
| Một codebase iOS+Android | ×3 | ✅ web-first | ✅ | ✅ | ❌ hai codebase |
| Reuse client-safe TS contracts/format | ×3 | ✅ cao sau khi PWA land | ✅ cao sau khi tách boundary | ❌ phải port sang Dart | ❌ phải port |
| Chi phí học/vận hành (solo) | ×3 | Thấp | Thấp–TB | TB | Cao |
| Native UX (nav/gesture/list) | ×2 | Thấp–TB (WebView) | Cao | Cao | Cao nhất |
| Push + secure storage + biometrics | ×2 | ✅ qua plugin, cần native QA | ✅ Expo modules/config plugin | ✅ | ✅ |
| Update mitigation | ×2 | Web deploy cho web layer; native binary vẫn có review boundary | EAS Update cho JS/assets cùng runtime | Hạn chế hơn | Binary update |
| Perf/UX đồ hoạ nặng | ×1 | Thấp | TB–Cao | Cao | Cao nhất |
| Store readiness | ×2 | Nhanh hơn **sau** PWA, nhưng có review/minimum-functionality risk | TB | TB | Chậm |
| **Định hướng** | | **Optional spike, không committed** | **✅ Target phase-2 đề xuất** | Thay thế | Chỉ khi có capability đặc thù |

> Plexco chủ yếu là form + list + chat + dashboard, nên codebase/operations quan trọng hơn đồ hoạ nặng. RN/Expo vẫn là recommendation tốt nhất, nhưng recommendation phụ thuộc client-contract extraction + native spike, không dựa trên giả định reuse nguyên `packages/core`.

### 2.2 Phân tích từng lựa chọn

**Capacitor — optional phase-1.5 spike.** Có thể reuse phần lớn UI web **sau khi** PWA thật sự installable/offline-shell và qua device QA. Vẫn cần project iOS/Android, signing, push/secure-storage plugin, permission UX, deep-link, privacy manifest, store assets/review và native-value checklist. Apple guideline 4.2 yêu cầu app vượt mức “repackaged website”, nên store acceptance không được coi là mặc định. Chỉ GO khi spike chứng minh giá trị native cụ thể (push, biometric/secure unlock, deep link, offline shell) và không làm chậm phase-1 committed work.

**React Native + Expo — target phase-2 (đề xuất).** Một codebase TS, hệ sinh thái quen, `expo-notifications`, `expo-secure-store`, `expo-auth-session` và EAS build/update. Reuse trực tiếp chỉ dành cho package/subpath client-safe; API DTO/error/validator/i18n catalog phải được tách khỏi server `AsyncLocalStorage` và money logic. EAS Update không đổi native module; runtime-version mismatch phải rebuild. Đây là lựa chọn phù hợp nhất cho app form/list/chat/dashboard sau spike.

**Flutter — thay thế.** UI/perf nhất quán nhưng thêm Dart + contract/i18n/validation port, tăng maintenance cho solo founder.

**Native thuần (Swift + Kotlin).** Fidelity/security/capability tốt nhất nhưng hai codebase và ít reuse; chỉ chọn nếu spike tìm ra capability nền tảng mà RN/Expo không đáp ứng.

### 2.3 Đề xuất

**Target phase-2 = React Native + Expo, vẫn 🟡 proposal.** Capacitor không nằm trên critical path; chỉ là spike có gate sau S9/S20. Cả hai phải dùng canonical API ở Part B và cùng server-side rules, nên không tạo backend thứ hai.

---

## 3. PART B — Shared API contract (web PWA ⇄ native)

### 3.1 Một API, hai client, một authority

Cả PWA và native gọi cùng Next.js App Router API surface (DD-10). Khác biệt ở credential transport (cookie/bearer) và realtime transport (SSE/push). API handler nhận principal đã xác thực nhưng **không tin tenant/resource từ token hoặc client body**: target tenant/action phải được server resolve từ membership/capability/protected ref rồi re-authorize trước mutation. Capacity/waitlist/gating/money/merge luôn server-owned.

### 3.2 Auth & token (đóng AUDIT G2 + store gate)

| Client | Cơ chế | Ghi chú |
|---|---|---|
| **Web PWA** | httpOnly session cookie (`web_sessions`) | sameSite=strict + rotation + login-state CSRF (DD-31 SI-1) |
| **Native Android** | Google Authorization Code + PKCE; email/password nếu phase-1 provider đã land | Backend verify issuer/audience/nonce/code; cấp access 15m + refresh rotating 30d |
| **Native iOS** | Sign in with Apple/equivalent privacy login + Google PKCE nếu offer Google | Phải thỏa App Review 4.8 hoặc có exception/evidence được duyệt; cùng Account/Person pipeline |

Thiết kế:
- **Auth middleware hai chế độ:** cookie **hoặc** `Authorization: Bearer <access>` → cùng `Account/Person`. Tenant context không nằm trong quyền tự khai của bearer; service derive target + capability rồi gọi cùng `tenantRepo` choke-point (HR1).
- **Refresh rotation:** mỗi consume cấp cặp mới + void token cũ; reuse token cũ ⇒ revoke cả family. Raw token chỉ ở client; DB lưu hash + family/`rotated_from` + device/app-installation + expiry/revocation.
- **Access token format:** chốt opaque-hash hay signed JWT ở auth design-probe. Nếu JWT, logout/revoke family không thể thu hồi access đã phát ngay lập tức nên exposure tối đa vẫn là 15m; token không mang tenant authority bất biến.
- **Secure storage:** Keychain iOS / Android Keystore-backed encrypted storage; không UserDefaults/SharedPreferences thường. `app_instance_id/os/app_version` chỉ là metadata/risk signal, không được gọi là cryptographic device binding.
- **Logout:** revoke refresh family của installation + access token nếu store hỗ trợ + revoke device push subscription; sau đó xoá local secure storage.
- **Không trộn transport:** web giữ cookie; native contract chọn bearer. Native có thể có cookie jar kỹ thuật, nhưng Plexco không dùng nó làm auth authority.

### 3.3 Envelope, contracts & i18n

- **Envelope live:** success `{data,error:null,meta:{requestId}}`; error `{data:null,error:{code,message,statusCode},meta:{requestId}}` theo `apps/web/lib/api-envelope.ts`/decisions v1.44.
- Trước native, tạo **client-safe contract package/subpath** chứa DTO whitelist, error codes, validators, pagination/version fields và i18n message keys/params. Nó không export DB, `node:*`, matching/payments engine hoặc server-only `t(vi,en)`.
- PWA/native localize theo `error.code + params` bằng catalog vi/en client-side. Bot tiếp tục dùng `@plexco/core/i18n` server-side.

### 3.4 Realtime + push (background)

- **Foreground:** SSE DD-07; PWA dùng `EventSource`, RN dùng client streaming phù hợp. Topic luôn server-derived theo tenant/person và re-authorize theo contract SSE hiện hành.
- **Background:** APNs/FCM (Expo Push hoặc direct provider) qua **`device_push_subscriptions` global-protected**, gắn `person_id + app_instance_id`, endpoint lưu encrypted + lookup hash, lifecycle `active|revoked|invalid`, không `tenant_id` authority.
- **Không dùng `ChannelIdentity` cho device:** DD-67 `channel_identities/channel_reachability` tiếp tục chỉ model exact Messenger Page / Zalo bot-OA endpoint. Push subscription và bot reachability là hai protected stores; store này không authorize store kia.
- Dispatcher re-check recipient eligibility cho target event/tenant, rồi áp notification policy. DD-67 chọn một exact channel route trong các Page/bot candidates; push route lấy từ device store. Logical delivery key ngăn accidental duplicate. Nếu product cố ý fan-out nhiều device thì delivery key phải bind từng subscription; đó là policy rõ, không phải broadcast do identity collision.
- **Push payload tối thiểu:** notification id/type + generic copy + protected deep link. Không amount, debt, payer/player name, roster, venue riêng tư hoặc token trong lock-screen payload; app mở rồi fetch DTO sau auth.

### 3.5 Idempotency & offline

- `processed_commands(tenant_id,command_id)` **đã có ở schema** nhưng chỉ dành cho tenant-domain mutation và còn phải được service wiring theo feature. Replay cùng `command_id` phải khớp `command_type + canonical payload hash`; collision khác payload fail closed.
- Auth/refresh/logout, identity/link/merge và device-subscription lifecycle là global/protected flow; dùng conditional consume, unique key, family revoke và state-idempotency riêng — không ép vào tenant `processed_commands`.
- **Native v1 offline = read-only:** chỉ cache DTO được whitelist; không cache tiền/PII. Không queue join/leave/pay/mark-paid/merge/admin/session mutation. Khi offline hiển thị trạng thái rõ và bắt refresh trước action.
- Sau này chỉ mở offline mutation cho allowlist low-risk có `expectedVersion`, expiry, re-authorization/revalidation tại consume và UX conflict rõ. Chat online retry có thể dùng `client_msg_id` dedupe theo DD-38.

### 3.6 Versioning & 3 tầng

- `/api/v1/...` là **target contract chưa live**; route hiện tại vẫn chủ yếu `/api/auth/*` và `/api/onboarding/*`. Trước native phải inventory route, pin v1 DTO/envelope/auth legend và có compatibility path để PWA không đổi hành vi.
- Trong cùng major: thêm optional field được; đổi/xoá semantics phải version mới/deprecation window. Native client cũ phải tiếp tục chạy; EAS Update không thay nghĩa contract cho binary cũ.
- Public read model / tenant-private RLS / person-self giữ nguyên. Native không có API riêng nới quyền.

### 3.7 Delta bắt buộc trước native GA

- Client-safe contracts/i18n boundary; import rule cấm native import server/money modules.
- Bearer access + rotating refresh family + revoke/secure-storage tests; Google PKCE + Sign in with Apple/equivalent iOS gate.
- `device_push_subscriptions` protected store + registration/rotation/revoke/invalid-token cleanup.
- Push projector/dispatcher policy + privacy-safe payload + dedup/unknown-outcome tests.
- `/api/v1` inventory/contract/compatibility tests; cookie↔bearer parity; target-tenant re-authorization tests.
- Offline read-only cache policy; no mutation queue until a later explicit allowlist decision.
- App Store/Play policy, privacy manifest, account deletion, review/demo account and native-value evidence.

---

## 4. Open items (technical gates, phase-2)

1. **Framework:** accept React Native + Expo sau native spike; Capacitor có spike hay bỏ.
2. **Nền tảng:** iOS + Android cùng lúc hay Android trước; nếu iOS, pin Sign in with Apple/equivalent compliance.
3. **Auth:** access token format (opaque/JWT), rotation/revoke semantics, secure storage và account-link matrix.
4. **Push:** Expo Push vs direct FCM/APNs; accept dedicated `device_push_subscriptions`, không `channel_reachability`.
5. **API:** khóa `/api/v1` + backward-compat/deprecation policy.
6. **Offline:** giữ read-only v1; mọi mutation queue là quyết định riêng theo allowlist.
7. **Timeline:** chỉ lịch phase-2 sau phase-1/P6 khi product evidence + external/store gates đủ.

> ✅ Định hướng accepted (decisions v1.47); technical gates + native build vẫn phase-2 TBD — **không đổi phase-1 committed scope**. Phase-1 target là web app PWA; native chưa lên lịch.

---

## 5. Trình tự đề xuất khi bật phase-2

1. Hoàn tất S9/S20 và lưu PWA/Lighthouse/device evidence; nếu muốn Capacitor thì chạy spike + store-compliance gate riêng.
2. Tách client-safe contracts/i18n boundary; inventory và khóa `/api/v1` trên API hiện có mà không đổi hành vi PWA.
3. Land bearer auth + Google PKCE + Apple/equivalent iOS + rotating refresh; E2E cookie/bearer parity và tenant re-authorization.
4. Land protected device subscriptions + privacy-safe push projector/policy; test dedup với SSE/Zalo/Messenger.
5. Build RN/Expo UI host dashboard + player view + chat + discovery; offline read-only.
6. Hardening: rate-limit, old-client compatibility, OTA runtime policy/rollback, account deletion, store review/demo/evidence.

## Tham chiếu policy/tooling hiện hành

- Apple App Review Guidelines §4.2 (minimum functionality) và §4.8 (login services): <https://developer.apple.com/app-store/review/guidelines/>
- Expo EAS Update runtime compatibility: <https://docs.expo.dev/eas-update/runtime-versions/>
