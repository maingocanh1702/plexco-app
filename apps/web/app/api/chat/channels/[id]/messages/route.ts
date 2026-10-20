import type { ChatMessageDto } from "@plexco/core";
import { listChatMessages, sendChatMessage, type ChatMessageListRow } from "@plexco/db";

import { ok } from "../../../../../../lib/api-envelope";
import {
  chatGate,
  encodeChatCursor,
  invalidBody,
  runChat,
  toWireTimestamp,
  uuidOrNull,
} from "../../../../../../lib/chat-route";

const AUTHOR_TYPES = ["person", "assistant", "system"] as const;
const TOMBSTONES = ["author_deleted", "moderation_hidden"] as const;
type Params = { params: Promise<{ id: string }> };

/** D-16, G2: a tombstone keeps four keys, no person id ever; a row outside the DTO throws (500).
 *  authorLabel passes through as the definer gave it (L16 renders "You"/"Member"; no fallback here). */
function toDto(row: ChatMessageListRow, personId: string): ChatMessageDto {
  const { id, channelId, body, replyToMessageId, editCount, authorLabel } = row;
  const createdAt = toWireTimestamp(row.createdAt);
  const tombstone = TOMBSTONES.find((k) => k === row.tombstone);
  if (tombstone) return { id, channelId, createdAt, tombstone };
  const authorType = AUTHOR_TYPES.find((a) => a === row.authorType);
  if (row.tombstone !== null || body === null || !authorType) throw new Error("chat row");
  const editedAt = row.editedAt === null ? null : toWireTimestamp(row.editedAt);
  const live = {
    id,
    channelId,
    authorType,
    authorLabel,
    body,
    replyToMessageId,
    editedAt,
    editCount,
  };
  return { ...live, mine: row.authorPersonId === personId, tombstone: null, createdAt };
}

export async function GET(request: Request, { params }: Params): Promise<Response> {
  const g = await chatGate(request, { ids: { id: (await params).id }, page: true, read: true });
  if (g instanceof Response) return g;
  const { limit, cursor } = g.page!;
  const at = { cursorCreatedAt: cursor?.createdAt, cursorId: cursor?.id, limit };
  return runChat(g, async (tx) => {
    const rows = await listChatMessages(tx, { channelId: g.ids.id, direction: "before", ...at });
    const last = rows[limit - 1]; // D-22: only a full page has a next one; its oldest row (K1 order)
    const messages = rows.map((row) => toDto(row, g.personId));
    return ok({ messages, nextCursor: last ? encodeChatCursor(last) : null });
  });
}

/** D-8, D-10: exactly {id, createdAt, duplicate}, never the body; PR note 10: uuid ids only. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const g = await chatGate(request, { ids: { id: (await params).id }, json: true });
  if (g instanceof Response) return g;
  const { body, clientMsgId: rawId, replyToMessageId: reply = null } = g.body!;
  const clientMsgId = uuidOrNull(rawId);
  const replyToMessageId = reply === null ? null : uuidOrNull(reply);
  if (!clientMsgId || typeof body !== "string" || (reply !== null && !replyToMessageId)) {
    return invalidBody(g.lang);
  }
  return runChat(g, async (tx) => {
    const input = { channelId: g.ids.id, clientMsgId, body, replyToMessageId };
    const { id, createdAt, duplicate } = await sendChatMessage(tx, input);
    return ok({ id, createdAt: toWireTimestamp(createdAt), duplicate });
  });
}
