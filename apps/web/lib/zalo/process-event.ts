import { runWithLang } from "@plexco/core/i18n";
import {
  LINK_CODE_TTL_SECONDS,
  claimZaloReplyContext,
  createZaloReplyContext,
  issueLinkCode,
  joinSession,
  leaveSession,
  listOwnJoinableSessions,
  listOwnLeavableSeats,
  pgErrorChainText,
  pgErrorHasCode,
  readLatestZaloReplyContext,
  readMyCharges,
  readZaloBotTokenEnc,
  readZaloPayContext,
  resolveZaloIdentity,
  resolveZaloLinkGate,
  withTenant,
  type Db,
  type DbHandle,
  type ZaloBotRef,
} from "@plexco/db";
import { keyedHash } from "../auth-secrets";
import { decryptConnectorSecret, encryptConnectorSecret, textToBlob } from "../connector-secrets";
import { linkCodeKeys } from "../link-code-keys";
import { log } from "../log";
import {
  SESSION_JOIN_PERSON_LIMIT,
  SESSION_LEAVE_PERSON_LIMIT,
  personThrottled,
} from "../session-command-route";
import { rateLimited } from "../session-cookies";
import { sendMessage, ZaloApiError } from "./client";
import { buildZaloReply, parseZaloCommand, type LinkIssueResult } from "./commands";
import { runPlayerCommand, type PlayerCommandDeps } from "./player-commands";

const PLAYER_KINDS: ReadonlySet<string> = new Set(["join", "leave", "pay", "number"]);

/**
 * Inline processing of one STORED Zalo event (store-before-process is the caller's job).
 *
 * Webhook body as the owner signed it in DD-126 (OD-2): the shape the payment bot types as
 * `ZaloUpdate` (src/zalo/zalo.ts) and the chatbot parses in `parseZaloUpdate`: top-level
 * `{ event_name, message: { message_id, date, text, from: { id, display_name },
 * chat: { id, chat_type: "PRIVATE" | "GROUP" } } }`. Zalo has NO update_id, and `result` only wraps
 * Bot API RESPONSES, never a webhook body: neither is read.
 *
 * Dedupe key = message_id composed with chat.id and from.id (one sender can reuse a message_id in
 * another chat). The JSON-array composition is injective, so no id content can forge a separator.
 * A missing part has no usable key: the webhook answers WEBHOOK_PAYLOAD_MALFORMED (fail closed).
 * No length cap: the route stores only the fixed-length keyed HMAC of the key.
 */
export interface ZaloEventFields {
  /** Canonical dedupe key. Holds raw provider ids: the route persists only its keyed HMAC (DD-67). */
  eventId: string;
  fromId: string;
  chatId: string;
  chatType: string | null;
  text: string | null;
  displayName: string | null;
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
// Numbers only when they are exactly representable: a JSON number above 2^53 has already lost
// digits, so two different ids would collapse onto one dedup key. Strings pass through untouched.
const scalar = (v: unknown): string | null =>
  typeof v === "string" && v.length > 0
    ? v
    : typeof v === "number" && Number.isSafeInteger(v)
      ? String(v)
      : null;

export function extractZaloEvent(payload: unknown): ZaloEventFields | null {
  if (!isObj(payload)) return null;
  const message = isObj(payload.message) ? payload.message : {};
  const from = isObj(message.from) ? message.from : {};
  const chat = isObj(message.chat) ? message.chat : {};
  const messageId = scalar(message.message_id);
  const chatId = scalar(chat.id);
  const fromId = scalar(from.id);
  if (messageId === null || chatId === null || fromId === null) return null;
  return {
    eventId: JSON.stringify([messageId, chatId, fromId]),
    fromId,
    chatId,
    chatType: typeof chat.chat_type === "string" ? chat.chat_type : null,
    text: typeof message.text === "string" ? message.text : null,
    displayName: scalar(from.display_name),
  };
}

export type ProcessOutcome = "processed" | "ignored";

/**
 * DD-126 (OD-2): only a 1:1 chat with the bot is served. GROUP, any other present chat_type than
 * PRIVATE, or a chat whose id is not the sender's (a group that omits chat_type) is not a DM; an
 * absent chat_type stays allowed when chat.id == from.id, as the payment bot allows it for 1:1 chats.
 */
export const isDirectZaloChat = (e: ZaloEventFields): boolean =>
  (e.chatType === null || e.chatType === "PRIVATE") && e.chatId === e.fromId;

export async function processZaloEvent(args: {
  handle: DbHandle;
  bot: ZaloBotRef;
  event: ZaloEventFields;
  externalEventId: string;
}): Promise<ProcessOutcome> {
  const { handle, bot, event, externalEventId } = args;
  const db: Db = handle.db;
  // A non-DM is ignored outright: no identity, no reply, no link code. The webhook already drops it
  // before the store (no payload persisted); this is the same rule at the processor, fail closed.
  if (event.text === null || !isDirectZaloChat(event)) return "ignored";
  const { fromId, chatId, text } = event;

  const cmd = parseZaloCommand(text);
  const scopeHash = await keyedHash(`channel-scope:zalo:${bot.botId}`);
  const userHash = await keyedHash(`channel-user:zalo:${fromId}`);
  // ponytail: encrypted per DM event (cheap AES); a read-first definer would avoid it for known users.
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
  // RC-1: own autocommit call outside every tenant transaction; any failure = NOT linked (P-28).
  const gate = await resolveZaloLinkGate(handle.pool, identity.channelIdentityId).catch(
    (error: unknown) => {
      const code = (error as { code?: unknown } | null)?.code;
      const sqlstate = typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : "none";
      log.error("zalo_link_gate_failed", { sqlstate });
      return { linked: false, accountRef: null };
    },
  );
  const { tenantId } = bot;
  const { personId } = identity;
  const ctxKey = { tenantId, botId: bot.botId, personId };
  const commandId = `zalo:${externalEventId}`;
  const deps: PlayerCommandDeps = {
    gate,
    listJoinable: () => listOwnJoinableSessions(db, { tenantId, personId }),
    listLeavable: () => listOwnLeavableSeats(db, { tenantId, personId }),
    saveContext: (contextType, itemIds) =>
      createZaloReplyContext(db, { ...ctxKey, contextType, itemIds }),
    latestContext: () => readLatestZaloReplyContext(db, ctxKey),
    claimContext: (c) => claimZaloReplyContext(db, { ...ctxKey, id: c.id, version: c.version }),
    join: (sessionId) => joinSession(db, { tenantId, personId, sessionId, commandId }),
    leave: (sessionId) => leaveSession(db, { tenantId, personId, sessionId, commandId }),
    throttled: (type) =>
      personThrottled(
        type === "join_list" ? SESSION_JOIN_PERSON_LIMIT : SESSION_LEAVE_PERSON_LIMIT,
        personId,
      ),
    readCharges: (accountRef) => readMyCharges(handle.pool, accountRef),
    payContext: (sessionIds) => readZaloPayContext(db, { tenantId, sessionIds }),
    classify: classifyProcessingError,
  };

  const lang = bot.locale === "en" ? "en" : "vi"; // DD-118: the bot's tenant locale, fail-closed vi
  const reply = await runWithLang(lang, () => {
    if (PLAYER_KINDS.has(cmd.kind)) return runPlayerCommand(cmd, deps);
    return buildZaloReply(cmd, {
      displayName: identity.displayName,
      hasAccount: gate.linked,
      isDirect: true,
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
    });
  });

  const botToken = await withTenant(db, bot.tenantId, async (tx) => {
    const enc = await readZaloBotTokenEnc(tx, bot.tenantId, bot.botId);
    if (enc === null) throw new Error("bot token missing");
    return decryptConnectorSecret(
      tx,
      textToBlob(enc),
      {
        tenantId: bot.tenantId,
        botId: bot.botId,
        purpose: "bot_token",
      },
      bot.keyVersion,
    );
  });
  await sendMessage(botToken, chatId, reply);
  return "processed";
}

/** Stable, non-sensitive error_code for a failed event row. */
export function classifyProcessingError(error: unknown): string {
  if (error instanceof ZaloApiError) return `ZALO_${error.kind.toUpperCase()}`;
  if (pgErrorHasCode(error, "23000")) return "IDENTITY_SCOPE_CONFLICT";
  if (pgErrorHasCode(error, "22023") && /person is not active/.test(pgErrorChainText(error))) {
    return "PERSON_INACTIVE";
  }
  return "PROCESSING_ERROR";
}
