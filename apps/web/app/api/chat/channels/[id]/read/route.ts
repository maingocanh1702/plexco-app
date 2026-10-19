import { markChatRead } from "@plexco/db";

import { ok } from "../../../../../../lib/api-envelope";
import { chatGate, invalidBody, runChat, uuidOrNull } from "../../../../../../lib/chat-route";

type Params = { params: Promise<{ id: string }> };

/** Readiness 4.2: {throughMessageId} -> {}; the cursor only moves forward (T24), 404 off-channel. */
export async function POST(request: Request, { params }: Params): Promise<Response> {
  const g = await chatGate(request, { ids: { id: (await params).id }, json: true, read: true });
  if (g instanceof Response) return g;
  const throughMessageId = uuidOrNull(g.body!.throughMessageId);
  if (!throughMessageId) return invalidBody();
  return runChat(g, async (tx) => {
    await markChatRead(tx, { channelId: g.ids.id, throughMessageId });
    return ok({});
  });
}
