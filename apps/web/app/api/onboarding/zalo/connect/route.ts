import { randomBytes, randomUUID } from "node:crypto";
import { runWithLang, t } from "@plexco/core/i18n";
import {
  beginZaloConnect,
  finishZaloConnect,
  probeZaloConnectReplay,
  ZALO_CONNECTOR_ACTION,
  ZaloConnectError,
} from "@plexco/db";
import { err, ok } from "../../../../../lib/api-envelope";
import { resolveClubGate } from "../../../../../lib/club-config-route";
import { blobToText, encryptConnectorSecret } from "../../../../../lib/connector-secrets";
import { log } from "../../../../../lib/log";
import { readBoundedBody } from "../../../../../lib/read-bounded-body";
import { isUnsafeCommandKey } from "../../../../../lib/session-command-route";
import { appDb } from "../../../../../lib/session-cookies";
import { getMe, setWebhook, ZaloApiError } from "../../../../../lib/zalo/client";
import { zaloStateView, zaloWebhookUrl } from "../../../../../lib/zalo/webhook-url";

/**
 * POST /api/onboarding/zalo/connect?tenant=<uuid> -- owner pastes the club's Zalo bot token.
 *
 * Authority: authorize(connector.secret_manage) (owner always; admin only with an explicit grant),
 * re-checked inside the zalo_bot_upsert_for_tenant definer. Flow: getMe (validate token) -> encrypt
 * token + fresh webhook secret -> upsert `connecting` -> setWebhook -> `registered` (or `error`) +
 * onboarding step `zalo_connect`. Network calls never run inside a DB transaction. The response
 * carries the webhook URL (opaque lookup token, NOT a secret) and NEVER the bot token or secret.
 * Rate: 5 / 10 min per tenant (connector_onboarding section 3).
 */
const MAX_BODY_BYTES = 4 * 1024;
const CONNECT_LIMIT = { bucket: "zalo-connect", limit: 5, windowSeconds: 600 };

const unavailable = (vi: string, en: string) => err("AUTH_UNAVAILABLE", t(vi, en), 503);

/** APP_BASE_URL must parse as a URL; production additionally requires https (webhook goes to Zalo). */
function validBaseUrl(raw: string | undefined): string | null {
  const v = raw?.trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (
      u.protocol !== "https:" &&
      !(u.protocol === "http:" && process.env.NODE_ENV !== "production")
    ) {
      return null;
    }
    return v;
  } catch {
    return null;
  }
}

const invalid = () => err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);

export async function POST(request: Request): Promise<Response> {
  const gate = await resolveClubGate(request, {
    csrf: true,
    action: ZALO_CONNECTOR_ACTION,
    tenantBucket: CONNECT_LIMIT,
  });
  if (gate instanceof Response) return gate;

  return runWithLang(gate.lang, async () => {
    const baseUrl = validBaseUrl(process.env.APP_BASE_URL);
    if (!baseUrl) {
      return unavailable("Chưa cấu hình địa chỉ ứng dụng.", "App base URL is not configured.");
    }
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return invalid();
    }
    const read = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!read.ok) return invalid();
    let raw: unknown;
    try {
      raw = JSON.parse(read.text);
    } catch {
      return invalid();
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const body = raw as Record<string, unknown>;
    if (Object.keys(body).some((k) => k !== "commandId" && k !== "botToken")) return invalid();
    const { commandId, botToken } = body;
    if (
      typeof commandId !== "string" ||
      commandId.trim().length === 0 ||
      commandId.length > 200 ||
      isUnsafeCommandKey(commandId)
    ) {
      return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
    }
    if (typeof botToken !== "string" || botToken.length === 0 || botToken.length > 200)
      return invalid();

    const db = appDb().db;
    // Replay probe BEFORE any Zalo call: a processed commandId returns the stored state untouched.
    try {
      const replay = await probeZaloConnectReplay(db, { tenantId: gate.tenantId, commandId });
      if (replay) return ok(zaloStateView(baseUrl, replay));
    } catch (error) {
      if (error instanceof ZaloConnectError && error.code === "COMMAND_ID_CONFLICT") {
        return err(
          "COMMAND_ID_CONFLICT",
          t("commandId đã được dùng.", "commandId already used."),
          409,
        );
      }
      throw error;
    }

    const tokenInvalid = () =>
      err("ZALO_TOKEN_INVALID", t("Token bot Zalo không hợp lệ.", "Invalid Zalo bot token."), 400);
    try {
      await getMe(botToken);
    } catch (error) {
      if (error instanceof ZaloApiError && (error.kind === "timeout" || error.kind === "network")) {
        return unavailable("Zalo tạm thời không phản hồi.", "Zalo is temporarily unavailable.");
      }
      return tokenInvalid(); // stable kind only; the client never puts the token in an error
    }

    const webhookSecret = randomBytes(32).toString("base64url"); // 43 chars, inside Zalo's 8-256
    const webhookToken = randomBytes(32).toString("base64url");
    try {
      const begun = await beginZaloConnect(db, {
        tenantId: gate.tenantId,
        actorPersonId: gate.personId,
        commandId,
        newBotId: randomUUID(),
        prepare: async (botId) => {
          const tokenEnc = await encryptConnectorSecret(botToken, {
            tenantId: gate.tenantId,
            botId,
            purpose: "bot_token",
          });
          const secretEnc = await encryptConnectorSecret(webhookSecret, {
            tenantId: gate.tenantId,
            botId,
            purpose: "webhook_secret",
          });
          return {
            botTokenEnc: blobToText(tokenEnc.enc),
            webhookToken,
            webhookSecretEnc: secretEnc.enc,
            keyVersion: tokenEnc.keyVersion,
          };
        },
      });
      if (begun.replayed) return ok(zaloStateView(baseUrl, begun.state));

      let outcome: "registered" | "error" = "registered";
      let reason: string | undefined;
      try {
        await setWebhook(botToken, zaloWebhookUrl(baseUrl, begun.webhookToken), webhookSecret);
      } catch (error) {
        outcome = "error";
        reason = "ZALO_SETWEBHOOK_FAILED";
        log.warn("zalo_setwebhook_failed", { tenantId: gate.tenantId, error });
      }
      const { state, superseded } = await finishZaloConnect(db, {
        tenantId: gate.tenantId,
        botId: begun.botId,
        commandId,
        webhookToken: begun.webhookToken,
        outcome,
        reason,
      });
      if (superseded) {
        // A newer connect replaced this one's webhook token: its own code (OD-2 / DD-126), not a
        // reused commandId.
        return err(
          "CONNECT_SUPERSEDED",
          t(
            "Một lần kết nối mới hơn đã thay thế lần này.",
            "A newer connect superseded this attempt.",
          ),
          409,
        );
      }
      return ok(zaloStateView(baseUrl, state));
    } catch (error) {
      if (error instanceof ZaloConnectError) {
        switch (error.code) {
          case "BOT_REVOKED":
            return err("FORBIDDEN", t("Bot này đã bị thu hồi.", "This bot has been revoked."), 403);
          case "FORBIDDEN":
            return err(
              "FORBIDDEN",
              t("Bạn không có quyền với CLB này.", "Not permitted for this club."),
              403,
            );
          case "COMMAND_ID_CONFLICT":
            return err(
              "COMMAND_ID_CONFLICT",
              t("commandId đã được dùng.", "commandId already used."),
              409,
            );
          case "NO_ONBOARDING_RUN":
            return err("NOT_FOUND", t("Chưa có onboarding run.", "No onboarding run yet."), 404);
        }
      }
      throw error;
    }
  });
}
