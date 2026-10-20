import { sql, type SQL } from "drizzle-orm";
import { authorizeTenantAction } from "./authorization.js";
import type { Db, Tx } from "./client.js";
import { isUuid } from "./roster-money-shared.js";
import { withTenant } from "./tenant.js";

// The chat command core over the 0063 SECURITY DEFINER functions (L14 readiness 4.8, V-7, V-19, V-23). The definers
// own every rule (membership, capability, windows, rate limit, NOTIFY); this module binds the actor and the tenant,
// runs the suspension gate, makes one definer call per wrapper and maps errors. No text ever leaves it: a rejection
// is a ChatCommandError (code + HTTP status) or a new Error carrying only a SQLSTATE. Timestamps are Postgres text
// (a Date drops the microseconds a cursor needs) and go back as timestamptz.

/** The closed V-19 allowlist: the P0001 messages the definers raise, plus TENANT_SUSPENDED from the gate. */
const CHAT_ERROR_STATUS = {
  CHAT_FORBIDDEN: 403,
  CHAT_DUP_MESSAGE: 200,
  CHAT_MESSAGE_TOO_LARGE: 413,
  CHAT_RATE_LIMITED: 429,
  CHAT_SAFETY_BLOCKED: 403,
  CHAT_CAPABILITY_REQUIRED: 403,
  CHAT_IDEMPOTENCY_MISMATCH: 409,
  CHAT_REPLY_INVALID: 409,
  CHAT_EDIT_WINDOW_CLOSED: 409,
  CHAT_EDIT_CONFLICT: 409,
  CHAT_REASON_INVALID: 422,
  CHAT_MODERATION_FORBIDDEN: 403,
  INVALID_BODY: 400,
  NOT_FOUND: 404,
  TENANT_SUSPENDED: 403,
} as const;
export type ChatCommandErrorCode = keyof typeof CHAT_ERROR_STATUS;
const CHAT_CODES: ReadonlySet<string> = new Set(Object.keys(CHAT_ERROR_STATUS));

export class ChatCommandError extends Error {
  readonly code: ChatCommandErrorCode;
  readonly status: number;
  constructor(code: ChatCommandErrorCode) {
    super(code);
    this.name = "ChatCommandError";
    this.code = code;
    this.status = CHAT_ERROR_STATUS[code];
  }
}

/**
 * V-19 fail closed. The first SQLSTATE in the error or its cause chain decides: an allowlisted P0001 becomes a
 * ChatCommandError, anything else a NEW Error carrying only that SQLSTATE (UNKNOWN when there is none). Nothing of
 * the original (message, detail, hint, where, cause: a NOT NULL detail prints the whole row) is kept.
 */
function sanitize(err: unknown): Error {
  if (err instanceof ChatCommandError) return err;
  let e: unknown = err;
  for (let depth = 0; depth < 10 && typeof e === "object" && e !== null; depth += 1) {
    const { code, message, cause } = e as { code?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) {
      if (code === "P0001" && typeof message === "string" && CHAT_CODES.has(message)) {
        return new ChatCommandError(message as ChatCommandErrorCode);
      }
      return new Error(`CHAT_DB_ERROR:${code}`);
    }
    e = cause;
  }
  return new Error("CHAT_DB_ERROR:UNKNOWN");
}

export type ChatActor = { tenantId: string; personId: string };
/** The tx withChatActor hands to fn (actor bound, V-23 gate passed); branded so no wrapper runs on a bare Tx. */
export type ChatTx = Tx & { readonly __chatActor: true };

/**
 * V-7 and V-23: the only setter of app.person_id. A malformed personId is CHAT_FORBIDDEN before any query; then
 * withTenant, set_config('app.person_id', personId, true) and authorizeTenantAction(admin_mutation), whose denial is
 * TENANT_SUSPENDED with no definer call. Every rejection leaves sanitized, an error thrown by fn itself included.
 */
export async function withChatActor<T>(
  db: Db,
  actor: ChatActor,
  fn: (tx: ChatTx) => Promise<T>,
): Promise<T> {
  if (!isUuid(actor.personId)) throw new ChatCommandError("CHAT_FORBIDDEN");
  try {
    return await withTenant(db, actor.tenantId, async (tx) => {
      await tx.execute(sql`SELECT set_config('app.person_id', ${actor.personId}, true)`);
      const decision = await authorizeTenantAction(tx, actor.tenantId, "admin_mutation");
      if (!decision.allowed) throw new ChatCommandError("TENANT_SUSPENDED");
      return fn(tx as ChatTx);
    });
  } catch (err) {
    throw sanitize(err);
  }
}

/** V-19 fail closed: a command that returns no row is CHAT_DB_ERROR:UNKNOWN, never `undefined` typed as T. */
async function one<T>(tx: ChatTx, query: SQL): Promise<T> {
  const row = (await tx.execute(query)).rows[0];
  if (row === undefined) throw new Error("CHAT_DB_ERROR:UNKNOWN");
  return row as T;
}

export function sendChatMessage(
  tx: ChatTx,
  input: { channelId: string; clientMsgId: string; body: string; replyToMessageId?: string | null },
): Promise<{ id: string; createdAt: string; duplicate: boolean }> {
  return one(
    tx,
    sql`SELECT f.id, f.created_at::text AS "createdAt", f.duplicate
      FROM send_chat_message(${input.channelId}::uuid, ${input.clientMsgId}::text, ${input.body}::text,
        ${input.replyToMessageId ?? null}::uuid) AS f`,
  );
}

export function editChatMessage(
  tx: ChatTx,
  input: { channelId: string; messageId: string; body: string; expectedEditCount: number },
): Promise<{ id: string; editCount: number; editedAt: string; changed: boolean }> {
  return one(
    tx,
    sql`SELECT f.id, f.edit_count AS "editCount", f.edited_at::text AS "editedAt", f.changed
      FROM edit_chat_message(${input.channelId}::uuid, ${input.messageId}::uuid, ${input.body}::text,
        ${input.expectedEditCount}::integer) AS f`,
  );
}

export function deleteChatMessage(
  tx: ChatTx,
  input: { channelId: string; messageId: string },
): Promise<{ id: string; authorDeletedAt: string; changed: boolean }> {
  return one(
    tx,
    sql`SELECT f.id, f.author_deleted_at::text AS "authorDeletedAt", f.changed
      FROM delete_chat_message(${input.channelId}::uuid, ${input.messageId}::uuid) AS f`,
  );
}

export function moderateChatMessage(
  tx: ChatTx,
  input: {
    channelId: string;
    messageId: string;
    commandId: string;
    action: "hide" | "restore";
    reasonCode: string;
    reasonNote?: string | null;
  },
): Promise<{ messageId: string; moderationState: string; changed: boolean }> {
  return one(
    tx,
    sql`SELECT f.message_id AS "messageId", f.moderation_state AS "moderationState", f.changed
      FROM moderate_chat_message(${input.channelId}::uuid, ${input.messageId}::uuid, ${input.commandId}::uuid,
        ${input.action}::text, ${input.reasonCode}::text, ${input.reasonNote ?? null}::text) AS f`,
  );
}

export async function markChatRead(
  tx: ChatTx,
  input: { channelId: string; throughMessageId: string },
): Promise<void> {
  await tx.execute(
    sql`SELECT mark_read(${input.channelId}::uuid, ${input.throughMessageId}::uuid)`,
  );
}

export type ChatMessage = {
  id: string;
  channelId: string;
  authorType: string;
  authorPersonId: string | null;
  body: string | null;
  replyToMessageId: string | null;
  editedAt: string | null;
  editCount: number;
  tombstone: string | null;
  createdAt: string;
};

const MESSAGE_COLUMNS = sql`f.id, f.channel_id AS "channelId", f.author_type AS "authorType",
  f.author_person_id AS "authorPersonId", f.body, f.reply_to_message_id AS "replyToMessageId",
  f.edited_at::text AS "editedAt", f.edit_count AS "editCount", f.tombstone, f.created_at::text AS "createdAt"`;

/** A list row: the shared row plus 0065's author_label, the author's current club display name
 *  (NULL unless a live person message's author is an active member with a non-blank name).
 *  Display only, never an identifier; chat_get_message has no label, so getChatMessage stays ChatMessage. */
export type ChatMessageListRow = ChatMessage & { authorLabel: string | null };

/** A NULL direction or limit takes the definer's default (before, 50); WITH ORDINALITY keeps the definer's order. */
export async function listChatMessages(
  tx: ChatTx,
  input: {
    channelId: string;
    cursorCreatedAt?: string | null;
    cursorId?: string | null;
    direction?: "before" | "after" | null;
    limit?: number | null;
  },
): Promise<ChatMessageListRow[]> {
  const result = await tx.execute(
    sql`SELECT ${MESSAGE_COLUMNS}, f.author_label AS "authorLabel"
      FROM chat_list_messages(${input.channelId}::uuid, ${input.cursorCreatedAt ?? null}::timestamptz,
        ${input.cursorId ?? null}::uuid, ${input.direction ?? null}::text, ${input.limit ?? null}::integer)
        WITH ORDINALITY AS f
      ORDER BY f.ordinality`,
  );
  return result.rows as ChatMessageListRow[];
}

export async function getChatMessage(
  tx: ChatTx,
  input: { messageId: string },
): Promise<ChatMessage | null> {
  const result = await tx.execute(
    sql`SELECT ${MESSAGE_COLUMNS} FROM chat_get_message(${input.messageId}::uuid) AS f`,
  );
  return (result.rows[0] as ChatMessage | undefined) ?? null;
}
