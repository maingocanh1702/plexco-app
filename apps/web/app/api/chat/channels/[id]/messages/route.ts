import type { ChatMessageDto } from "@plexco/core";
import { listChatMessages, type ChatMessage } from "@plexco/db";

import { ok } from "../../../../../../lib/api-envelope";
import {
  chatGate,
  encodeChatCursor,
  runChat,
  toWireTimestamp,
} from "../../../../../../lib/chat-route";

const AUTHOR_TYPES = ["person", "assistant", "system"] as const;
const TOMBSTONES = ["author_deleted", "moderation_hidden"] as const;
type Params = { params: Promise<{ id: string }> };

/** D-16, G2: a tombstone keeps four keys, no person id ever; a row outside the DTO throws (500). */
function toDto(row: ChatMessage, personId: string): ChatMessageDto {
  const { id, channelId, body, replyToMessageId, editCount } = row;
  const createdAt = toWireTimestamp(row.createdAt);
  const tombstone = TOMBSTONES.find((k) => k === row.tombstone);
  if (tombstone) return { id, channelId, createdAt, tombstone };
  const authorType = AUTHOR_TYPES.find((a) => a === row.authorType);
  if (row.tombstone !== null || body === null || !authorType) throw new Error("chat row");
  const editedAt = row.editedAt === null ? null : toWireTimestamp(row.editedAt);
  const live = { id, channelId, authorType, body, replyToMessageId, editedAt, editCount };
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
