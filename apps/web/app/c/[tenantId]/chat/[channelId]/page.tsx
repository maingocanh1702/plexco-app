import { ChannelView } from "../../../../../components/chat/channel-view";

/**
 * The layout already gates the signed-in session; membership/authorization is the API's job.
 * No `metadata` on purpose (DF-10): the tab title stays the root default, never club content.
 */
export default async function ChatChannelPage({
  params,
}: {
  params: Promise<{ tenantId: string; channelId: string }>;
}) {
  const { tenantId, channelId } = await params;
  return <ChannelView tenantId={tenantId} channelId={channelId} />;
}
