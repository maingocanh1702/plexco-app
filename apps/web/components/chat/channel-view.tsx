"use client";

import { useId, useState } from "react";
import { useT } from "../../lib/i18n-client";
import { useChatChannel, useChatChannels, type ChatListError } from "../../lib/use-chat";
import { Button } from "../ui/button";
import { channelTitle } from "./channel-list";
import styles from "./channel-view.module.css";
import { Composer } from "./composer";
import { MessageList } from "./message-list";

// The chat channel screen: header, the history state of spec 5.2.1, the message log. The composer goes below the log.
export function ChannelView({
  tenantId,
  channelId,
  basePath = `/c/${tenantId}/chat`,
}: {
  tenantId: string;
  channelId: string;
  basePath?: string;
}) {
  const t = useT();
  const titleId = useId();
  const chat = useChatChannel(tenantId, channelId);
  const { state, messages, pending, error, hasOlder, reload, loadOlder, send, retry, discard } =
    chat;
  const [replyTo, setReplyTo] = useState<string | null>(null); // a row's Reply, until sent or cancelled
  // Title and post policy come from the channel list by id; nothing is kept in a URL, storage or module cache.
  const { channels } = useChatChannels(tenantId, { live: false });
  const channel = channels.find((c) => c.id === channelId);
  const [olderError, setOlderError] = useState<ChatListError | null>(null);
  const empty = t("Chưa có tin nhắn nào.", "No messages yet.");
  const notice = error?.message || (state === "empty" ? empty : "");
  return (
    <div data-state={state}>
      <div className={styles.header}>
        <Button href={basePath} variant="secondary">
          {t("Quay lại", "Go back")}
        </Button>
        {channel ? (
          <h1 id={titleId} className={styles.title} dir="auto">
            {channelTitle(channel, t)}
          </h1>
        ) : null}
      </div>
      {state === "loading" ? <p role="status">{t("Đang tải…", "Loading…")}</p> : null}
      {notice ? (
        <div className={styles.notice} role={error ? "alert" : undefined}>
          {notice}
          {error?.retry ? (
            <Button variant="secondary" onClick={() => reload()}>
              {t("Thử lại", "Retry")}
            </Button>
          ) : null}
          {error?.code === "AUTH_REQUIRED" ? (
            <Button href="/" variant="secondary">
              {t("Đăng nhập lại", "Sign in again")}
            </Button>
          ) : null}
        </div>
      ) : null}
      <MessageList
        tenantId={tenantId}
        messages={messages}
        hasOlder={hasOlder}
        onLoadOlder={() => void loadOlder().then(setOlderError)}
        olderError={olderError}
        labelledBy={channel ? titleId : undefined}
        actions={{ onReply: setReplyTo, onEdit: chat.edit, onRemove: chat.remove }}
      />
      <Composer
        postPolicy={channel?.postPolicy}
        outbox={{ pending, send, retry, discard }}
        reply={replyTo ? { id: replyTo, clear: () => setReplyTo(null) } : undefined}
      />
    </div>
  );
}
