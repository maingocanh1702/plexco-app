import { ChannelList } from "../../../../components/chat/channel-list";

/**
 * The layout already gates the signed-in session; membership/authorization is the API's job.
 * No `metadata` on purpose (DF-10): the tab title stays the root default, never club content.
 */
export default async function ChatPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  return <ChannelList tenantId={tenantId} />;
}
