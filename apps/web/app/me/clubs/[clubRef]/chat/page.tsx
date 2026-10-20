import { MemberChatGate } from "../../../../../components/player/member-chat-gate";

/**
 * Params only: the /me layout already gates the signed-in session, and the chat API's live-membership
 * gate is the one authorization. No `metadata` on purpose (DF-10): the tab title stays the root default.
 */
export default async function MemberChatPage({ params }: { params: Promise<{ clubRef: string }> }) {
  const { clubRef } = await params;
  return <MemberChatGate clubRef={clubRef} />;
}
