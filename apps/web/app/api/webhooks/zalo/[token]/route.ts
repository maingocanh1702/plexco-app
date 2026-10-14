import { createHash, timingSafeEqual } from "node:crypto";
import { runWithLang, t } from "@plexco/core/i18n";
import {
  finishInboundEvent,
  markBotVerifiedActive,
  resolveZaloBotByToken,
  storeInboundEvent,
  withTenant,
} from "@plexco/db";
import { err } from "../../../../../lib/api-envelope";
import { keyedHash } from "../../../../../lib/auth-secrets";
import { encryptConnectorSecret } from "../../../../../lib/connector-secrets";
import { log } from "../../../../../lib/log";
import { readBoundedBody } from "../../../../../lib/read-bounded-body";
import { appDb, clientIp, rateLimited } from "../../../../../lib/session-cookies";
import {
  classifyProcessingError,
  extractZaloEvent,
  isDirectZaloChat,
  processZaloEvent,
} from "../../../../../lib/zalo/process-event";
import { readWebhookSecret } from "../../../../../lib/zalo/webhook-secret-cache";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/zalo/[token] -- per-club Zalo bot webhook (program decision, M3a).
 *
 * The path token resolves the bot, hence the tenant: provider payload is NEVER tenant authority.
 * Verification = static secret equality (webhook-verification-matrix, Zalo Bot row: no body
 * signature by design), compared timing-safe over SHA-256 digests so lengths never leak. A DM event
 * is stored (encrypted) BEFORE processing, idempotent on (bot, keyed HMAC of message_id + chat.id +
 * from.id) (BRD NFR-S4, DD-126); the HMAC keeps raw provider ids out of the lookup column (DD-67).
 *
 * ORDER: token -> status -> secret (cached decrypt) -> [failed attempt: per bot+IP bucket] ->
 * per-bot bucket -> body -> parse -> [verified] -> [non-DM: ack, nothing stored] -> store (a
 * redelivery re-claims a failed or stale row, see storeInboundEvent) -> process -> 200 {message:"Success"}.
 * Processing failures are recorded on the event row and still answer 200 so Zalo does not retry
 * forever; only a failed STORE answers 5xx (nothing durable yet). One open follow-up against the
 * DD-126 shape, recorded in its note in feature_zalo_channel_tech.md section 3: processing runs
 * after the durable store but BEFORE the ack (DD-126: ack first, then process asynchronously).
 * Every failed secret check (missing header, wrong value, unreadable stored secret) spends the same
 * per bot+IP bucket and answers the same 403 INVALID_WEBHOOK_SECRET per OD-2/DD-126 (2026-10-14); the 401 that
 * feature_connector_onboarding_tech.md section 3 pins stays for SePay (out of the MVP, OD-0).
 * Logs carry event names and ids only, never payloads, tokens or secrets.
 */
const MAX_BODY_BYTES = 64 * 1024;
const ACCEPTED_STATUS = new Set(["connecting", "registered", "active", "drift"]);
const DUMMY_DIGEST = createHash("sha256").update("0".repeat(43)).digest();

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
const safeEqual = (a: string, expectedDigest: Buffer) => timingSafeEqual(digest(a), expectedDigest);
const notFound = () => Response.json({}, { status: 404, headers: { "cache-control": "no-store" } });
const ack = () =>
  Response.json({ message: "Success" }, { headers: { "cache-control": "no-store" } });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const handle = appDb();
  const db = handle.db;
  const header = request.headers.get("x-bot-api-secret-token") ?? "";

  const bot = await resolveZaloBotByToken(db, token);
  if (!bot || !ACCEPTED_STATUS.has(bot.status) || bot.webhookSecretEnc === null) {
    safeEqual(header, DUMMY_DIGEST); // keep unknown-token work shape close to the known path
    return notFound();
  }
  const { tenantId, botId } = bot;
  const lang = bot.locale === "en" ? "en" : "vi"; // DD-118; replies before auth stay Vietnamese

  // Secret check FIRST: the decrypt is cached (one audit row per fill), so an unauthenticated caller
  // who only knows the path token cannot spend decrypts, audit rows or the bot's buckets.
  let expected: Buffer | null = null;
  try {
    expected = await readWebhookSecret({ ...bot, webhookSecretEnc: bot.webhookSecretEnc }, (fn) =>
      withTenant(db, tenantId, fn),
    );
  } catch (error) {
    log.error("zalo_webhook_secret_unreadable", { botId, error });
  }
  // An unreadable stored secret takes the wrong-secret path (same bucket, same 403/429): indistinguishable.
  if (expected === null || !safeEqual(header, expected)) {
    // Failed attempts only are bucketed, per bot AND caller, so guessing cannot lock out Zalo itself.
    if (await rateLimited(`zalo-webhook-auth:${botId}:${clientIp(request)}`, 30, 60)) {
      return err("WEBHOOK_RATE_LIMITED", t("Quá nhiều yêu cầu.", "Too many requests."), 429);
    }
    return err("INVALID_WEBHOOK_SECRET", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
  }

  return runWithLang(lang, async () => {
    if (await rateLimited(`zalo-webhook:${botId}`, 300, 60)) {
      return err("WEBHOOK_RATE_LIMITED", t("Quá nhiều yêu cầu.", "Too many requests."), 429);
    }
    const malformed = () =>
      err("WEBHOOK_PAYLOAD_MALFORMED", t("Dữ liệu không hợp lệ.", "Malformed payload."), 400);
    const read = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!read.ok) return malformed();
    let payload: unknown;
    try {
      payload = JSON.parse(read.text);
    } catch {
      return malformed();
    }
    const event = extractZaloEvent(payload);
    if (event === null) return malformed();

    // First verified event proves the whole path (token + secret): registered -> active, bound to this request's token (drift is left alone).
    if (bot.status !== "active") {
      try {
        const outcome = await withTenant(db, tenantId, (tx) =>
          markBotVerifiedActive(tx, tenantId, botId, token),
        );
        if (outcome === "token_rotated") log.info("zalo_bot_activate_skipped", { botId, outcome });
      } catch (error) {
        log.error("zalo_bot_activate_failed", { botId, error });
      }
    }

    // DD-126 (OD-2): a non-DM payload is ignored BEFORE the durable store, so other members' names and
    // texts are never persisted (channel_inbound_events has no retention in the MVP).
    if (!isDirectZaloChat(event)) return ack();

    // The AAD binds the stored key, so a row can be decrypted from its own columns.
    const externalEventId = await keyedHash(`channel-inbound-event:zalo:${event.eventId}`);
    const raw = await encryptConnectorSecret(read.text, {
      tenantId,
      botId,
      purpose: `inbound_event:${externalEventId}`,
    });
    const stored = await withTenant(db, tenantId, (tx) =>
      storeInboundEvent(tx, {
        tenantId,
        botId,
        externalEventId,
        rawPayloadEnc: raw.enc,
        keyVersion: raw.keyVersion,
      }),
    );
    if (stored.duplicate || stored.id === null) return ack();

    const rowId = stored.id;
    let status: "processed" | "ignored" | "failed" = "processed";
    let errorCode: string | undefined;
    try {
      status = await processZaloEvent({ handle, bot, event });
    } catch (error) {
      status = "failed";
      errorCode = classifyProcessingError(error);
      log.error("zalo_event_failed", { botId, reason: errorCode });
    }
    try {
      await withTenant(db, tenantId, (tx) =>
        finishInboundEvent(tx, { tenantId, id: rowId, status, errorCode }),
      );
    } catch (error) {
      log.error("zalo_event_finish_failed", { botId, error });
    }
    return ack();
  });
}
