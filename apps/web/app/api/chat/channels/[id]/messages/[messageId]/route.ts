import { deleteChatMessage, editChatMessage } from "@plexco/db";

import { ok } from "../../../../../../../lib/api-envelope";
import {
  chatGate,
  invalidBody,
  runChat,
  toWireTimestamp,
} from "../../../../../../../lib/chat-route";

type Params = { params: Promise<{ id: string; messageId: string }> };

/** Exactly {id, editCount, editedAt, changed}, never the body; count is int4 (::integer in L14). */
export async function PATCH(request: Request, { params }: Params): Promise<Response> {
  const { id: channelId, messageId } = await params;
  const g = await chatGate(request, { ids: { channelId, messageId }, json: true });
  if (g instanceof Response) return g;
  const { body, expectedEditCount: n } = g.body!;
  const count = typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 2 ** 31 ? n : null;
  if (typeof body !== "string" || count === null) return invalidBody(g.lang);
  return runChat(g, async (tx) => {
    const r = await editChatMessage(tx, { ...g.ids, body, expectedEditCount: count });
    // 0063: an identical body on a never-edited message is a no-op whose edited_at is NULL
    const editedAt = r.editedAt === null ? null : toWireTimestamp(r.editedAt);
    return ok({ id: r.id, editCount: r.editCount, editedAt, changed: r.changed });
  });
}

/** An idempotent author tombstone; anyone else, moderators included, gets the one 403 body (0063). */
export async function DELETE(request: Request, { params }: Params): Promise<Response> {
  const { id: channelId, messageId } = await params;
  const g = await chatGate(request, { ids: { channelId, messageId } });
  if (g instanceof Response) return g;
  return runChat(g, async (tx) => {
    const { id, authorDeletedAt, changed } = await deleteChatMessage(tx, g.ids);
    return ok({ id, authorDeletedAt: toWireTimestamp(authorDeletedAt), changed });
  });
}
