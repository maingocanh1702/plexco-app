import { runWithLang } from "@plexco/core/i18n";
import {
  LINK_CODE_TTL_SECONDS,
  issueLinkCode,
  readZaloBotTokenEnc,
  resolveZaloIdentity,
  withTenant,
  type Db,
  type DbHandle,
  type ZaloBotRef,
} from "@plexco/db";
import { keyedHash } from "../auth-secrets";
import { decryptConnectorSecret, encryptConnectorSecret, textToBlob } from "../connector-secrets";
import { linkCodeKeys } from "../link-code-keys";
import { log } from "../log";
import { rateLimited } from "../session-cookies";
import { sendMessage, ZaloApiError } from "./client";
import { buildZaloReply, parseZaloCommand, type LinkIssueResult } from "./commands";

/**
 * Inline processing of one STORED Zalo event (store-before-process is the caller's job).
 *
 * AWAIT-verify (Zalo Bot webhook payload is not pinned in repo docs): the field paths below follow the
 * Telegram-like model in docs/research/player-side-saas-reconciliation.md section 4 (`from.id`,
 * `chat.id`, event names `message.text.received`). The payload may be wrapped in `result`; both
 * shapes are tolerated. The event id is `update_id` (top level or in `result`), falling back to
 * `message.message_id`. If none exists the webhook answers WEBHOOK_PAYLOAD_MALFORMED.
 */
export interface ZaloEventFields {
  eventId: string;
  eventName: string | null;
  fromId: string | null;
  chatId: string | null;
  text: string | null;
  displayName: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const scalar = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0
    ? v
    : typeof v === "number" && Number.isFinite(v)
      ? String(v)
      : null;

export function extractZaloEvent(payload: unknown): ZaloEventFields | null {
  if (!isObj(payload)) return null;
  const root = isObj(payload.result) ? payload.result : payload;
  const message = isObj(root.message) ? root.message : {};
  const from = isObj(message.from) ? message.from : {};
  const chat = isObj(message.chat) ? message.chat : {};
  const eventId = scalar(payload.update_id) ?? scalar(root.update_id) ?? scalar(message.message_id);
  if (eventId === null || eventId.length > 200) return null;
  return {
    eventId,
    eventName: scalar(root.event_name),
    fromId: scalar(from.id),
    chatId: scalar(chat.id),
    text: typeof message.text === "string" ? message.text : null,
    displayName: scalar(from.display_name) ?? scalar(from.name),
  };
}

export type ProcessOutcome = "processed" | "ignored";

export async function processZaloEvent(args: {
  handle: DbHandle;
  bot: ZaloBotRef;
  event: ZaloEventFields;
}): Promise<ProcessOutcome> {
  const { handle, bot, event } = args;
  const db: Db = handle.db;
  if (event.fromId === null || event.chatId === null || event.text === null) return "ignored";
  const fromId = event.fromId;
  const chatId = event.chatId;
  const text = event.text;

  const scopeHash = await keyedHash(`channel-scope:zalo:${bot.botId}`);
  const userHash = await keyedHash(`channel-user:zalo:${fromId}`);
  const userIdEnc = (
    await encryptConnectorSecret(fromId, {
      tenantId: bot.tenantId,
      botId: bot.botId,
      purpose: "channel_user",
    })
  ).enc;
  const identity = await withTenant(db, bot.tenantId, (tx) =>
    resolveZaloIdentity(tx, {
      tenantId: bot.tenantId,
      botId: bot.botId,
      scopeHash,
      userHash,
      userIdEnc,
      displayName: event.displayName,
    }),
  );

  const lang = bot.locale === "en" ? "en" : "vi"; // DD-118: the bot's tenant locale, fail-closed vi
  const reply = await runWithLang(lang, () =>
    buildZaloReply(parseZaloCommand(text), {
      displayName: identity.displayName,
      hasAccount: identity.hasAccount,
      issueLinkCode: async (): Promise<LinkIssueResult> => {
        const keys = linkCodeKeys();
        if (!keys) {
          log.error("zalo_link_key_missing");
          return { ok: false, reason: "unavailable" };
        }
        if (await rateLimited(`zalo-link:${identity.channelIdentityId}`, 3, 60)) {
          return { ok: false, reason: "cooldown" };
        }
        try {
          const issued = await issueLinkCode(
            handle.pool,
            { channelIdentityId: identity.channelIdentityId },
            keys,
          );
          return {
            ok: true,
            code: issued.code,
            ttlMinutes: Math.round(LINK_CODE_TTL_SECONDS / 60),
          };
        } catch (error) {
          log.error("zalo_link_issue_failed", { error });
          return { ok: false, reason: "unavailable" };
        }
      },
    }),
  );

  const botToken = await withTenant(db, bot.tenantId, async (tx) => {
    const enc = await readZaloBotTokenEnc(tx, bot.tenantId, bot.botId);
    if (enc === null) throw new Error("bot token missing");
    return decryptConnectorSecret(tx, textToBlob(enc), {
      tenantId: bot.tenantId,
      botId: bot.botId,
      purpose: "bot_token",
    });
  });
  await sendMessage(botToken, chatId, reply);
  return "processed";
}

/** Stable, non-sensitive error_code for a failed event row. */
export function classifyProcessingError(error: unknown): string {
  if (error instanceof ZaloApiError) return `ZALO_${error.kind.toUpperCase()}`;
  for (let c: unknown = error; c && typeof c === "object"; c = (c as { cause?: unknown }).cause) {
    if ((c as { code?: string }).code === "23000") return "IDENTITY_SCOPE_CONFLICT";
  }
  return "PROCESSING_ERROR";
}
