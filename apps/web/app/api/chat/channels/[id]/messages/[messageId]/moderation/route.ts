import { moderateChatMessage } from "@plexco/db";

import { ok } from "../../../../../../../../lib/api-envelope";
import { chatGate, invalidBody, runChat, uuidOrNull } from "../../../../../../../../lib/chat-route";

type Params = { params: Promise<{ id: string; messageId: string }> };

/** Exactly {messageId, moderationState, changed}; L14's receipts own the commandId replay (RO-L14-3). */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const { id: channelId, messageId } = await params;
  const g = await chatGate(request, { ids: { channelId, messageId }, json: true });
  if (g instanceof Response) return g;
  const { action, reasonCode, reasonNote = null } = g.body!;
  const commandId = uuidOrNull(g.body!.commandId);
  if (
    commandId === null ||
    (action !== "hide" && action !== "restore") ||
    typeof reasonCode !== "string" ||
    (reasonNote !== null && typeof reasonNote !== "string")
  ) {
    return invalidBody();
  }
  const input = { ...g.ids, commandId, action, reasonCode, reasonNote } as const;
  return runChat(g, async (tx) => {
    const r = await moderateChatMessage(tx, input);
    return ok({ messageId: r.messageId, moderationState: r.moderationState, changed: r.changed });
  });
}
