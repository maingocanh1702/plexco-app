import type { ChatChannelDto, ChatChannelListDto } from "@plexco/core";
import { authorize, listChatChannels } from "@plexco/db";

import { ok } from "../../../../lib/api-envelope";
import { chatGate, runChat } from "../../../../lib/chat-route";

/**
 * D-14, D-23: the caller's club channels; the reader's columns are the DTO (T25), zero rows the 403.
 *
 * L15b `viewer`: the session person's own chat.message.moderate and chat.channel.post_restricted
 * answers from authorize() (DD-56's one authorization source); a display hint that authorizes
 * nothing. Threat model, defends against:
 * 1. a non-member or another club's admin learning anything: the flags exist only on this 200
 *    path, after the live-membership pre-gate; every denial body stays unchanged (CHAT_FORBIDDEN
 *    and TENANT_SUSPENDED);
 * 2. an oracle on other people: no person parameter exists, the actor is the session person;
 * 3. role disclosure: only `allowed` leaves the callback, never the decision's role or reason;
 * 4. trusting a stale hint: a per-request snapshot, never cached; the L14 definers re-authorize
 *    every send, edit and moderate (0063), so a demoted admin gets the server's denial;
 * 5. cross-tenant bleed: evaluated for the ?tenant= the gate proved, which the definer binds to
 *    app.tenant_id (0049);
 * 6. a lock side effect: authorize()'s FOR SHARE locks live until this transaction commits, so
 *    the flags are computed last.
 * It does NOT defend against a compromised app tier, which already holds the session.
 * No catch: an authorize() infrastructure error rethrows to runChat's fail-closed 500, never an
 * allow and never a quiet false.
 */
export async function GET(request: Request): Promise<Response> {
  const g = await chatGate(request, { read: true });
  if (g instanceof Response) return g;
  return runChat(g, async (tx) => {
    const channels: ChatChannelDto[] = await listChatChannels(tx);
    // Sequential, not Promise.all: one connection, on a transaction that may abort.
    const canModerate = (
      await authorize(tx, {
        tenantId: g.tenantId,
        action: "chat.message.moderate",
        actorPersonId: g.personId,
      })
    ).allowed;
    const canPostRestricted = (
      await authorize(tx, {
        tenantId: g.tenantId,
        action: "chat.channel.post_restricted",
        actorPersonId: g.personId,
      })
    ).allowed;
    const data: ChatChannelListDto = { channels, viewer: { canModerate, canPostRestricted } };
    return ok(data);
  });
}
