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
import {
  decryptConnectorSecret,
  encryptConnectorSecret,
} from "../../../../../lib/connector-secrets";
import { log } from "../../../../../lib/log";
import { readBoundedBody } from "../../../../../lib/read-bounded-body";
import { appDb, rateLimited } from "../../../../../lib/session-cookies";
import {
  classifyProcessingError,
  extractZaloEvent,
  processZaloEvent,
} from "../../../../../lib/zalo/process-event";

export const runtime = "nodejs";

/**
 * POST /api/webhooks/zalo/[token] -- per-club Zalo bot webhook (program decision, M3a).
 *
 * The path token resolves the bot, hence the tenant: provider payload is NEVER tenant authority.
 * Verification = static secret equality (webhook-verification-matrix, Zalo Bot row: no body
 * signature by design), compared timing-safe over SHA-256 digests so lengths never leak. Raw event
 * is stored (encrypted) BEFORE processing, idempotent on (bot, event id) (BRD NFR-S4).
 *
 * ORDER: token -> status -> pre-auth bucket -> secret -> per-bot bucket -> body -> parse ->
 * [verified] -> store -> process -> 200. Processing failures are recorded on the event row and still
 * answer 200 so Zalo does not retry forever; only a failed STORE answers 5xx (nothing durable yet).
 * Logs carry event names and ids only, never payloads, tokens or secrets.
 */
const MAX_BODY_BYTES = 64 * 1024;
const ACCEPTED_STATUS = new Set(["connecting", "registered", "active", "drift"]);
const DUMMY_SECRET = "0".repeat(43);

const digest = (v: string) => createHash("sha256").update(v, "utf8").digest();
const safeEqual = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));
const notFound = () => Response.json({}, { status: 404, headers: { "cache-control": "no-store" } });
const ack = () => Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });

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
    safeEqual(header, DUMMY_SECRET); // keep unknown-token work shape close to the known path
    return notFound();
  }
  const { tenantId, botId } = bot;
  const lang = bot.locale === "en" ? "en" : "vi"; // DD-118; replies before auth stay Vietnamese

  // Pre-auth bucket: a leaked token must not let a caller flood decrypt audit rows.
  if (await rateLimited(`zalo-webhook-auth:${botId}`, 600, 60)) {
    return err("WEBHOOK_RATE_LIMITED", t("Quá nhiều yêu cầu.", "Too many requests."), 429);
  }
  let secret: string;
  try {
    const enc = bot.webhookSecretEnc;
    secret = await withTenant(db, tenantId, (tx) =>
      decryptConnectorSecret(tx, enc, { tenantId, botId, purpose: "webhook_secret" }),
    );
  } catch (error) {
    log.error("zalo_webhook_secret_unreadable", { botId, error });
    return err("INVALID_WEBHOOK_SECRET", t("Yêu cầu không hợp lệ.", "Invalid request."), 401);
  }
  if (!safeEqual(header, secret)) {
    return err("INVALID_WEBHOOK_SECRET", t("Yêu cầu không hợp lệ.", "Invalid request."), 401);
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

    // First verified event proves the whole path (token + secret): registered/drift -> active.
    if (bot.status !== "active") {
      try {
        await withTenant(db, tenantId, (tx) => markBotVerifiedActive(tx, tenantId, botId));
      } catch (error) {
        log.error("zalo_bot_activate_failed", { botId, error });
      }
    }

    const raw = await encryptConnectorSecret(read.text, {
      tenantId,
      botId,
      purpose: `inbound_event:${event.eventId}`,
    });
    const stored = await withTenant(db, tenantId, (tx) =>
      storeInboundEvent(tx, {
        tenantId,
        botId,
        externalEventId: event.eventId,
        rawPayloadEnc: raw.enc,
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
      log.error("zalo_event_failed", { botId, errorCode });
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
