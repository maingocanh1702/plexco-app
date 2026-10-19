import type { ChatChannelDto } from "@plexco/core";
import { listChatChannels } from "@plexco/db";

import { ok } from "../../../../lib/api-envelope";
import { chatGate, runChat } from "../../../../lib/chat-route";

/** D-14, D-23: the caller's club channels; the reader's columns are the DTO (T25), zero rows the 403. */
export async function GET(request: Request): Promise<Response> {
  const g = await chatGate(request, { read: true });
  if (g instanceof Response) return g;
  return runChat(g, async (tx) => {
    const channels: ChatChannelDto[] = await listChatChannels(tx);
    return ok({ channels });
  });
}
