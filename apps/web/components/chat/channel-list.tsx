"use client";

import type { ChatChannelDto } from "@plexco/core";
import Link from "next/link";
import { useT, type TFn } from "../../lib/i18n-client";
import { useChatChannels } from "../../lib/use-chat";
import { Button } from "../ui/button";
import styles from "./channel-list.module.css";

// The default channel title seeded by migration 0063; only this exact text is localised (DF-8).
const SEED_TITLE = "Kênh chung";

export function channelTitle({ isDefault, title }: ChatChannelDto, t: TFn): string {
  return isDefault && title === SEED_TITLE ? t("Kênh chung", "General") : title;
}

// Server count 0..100 (100 = 100 or more): nothing at 0, "100+" at the cap, then a screen-reader suffix (CC-6).
function UnreadBadge({ count }: { count: number }) {
  const t = useT();
  if (count < 1) return null;
  return (
    <span className={styles.badge}>
      {count >= 100 ? "100+" : count}
      <span className="sr-only"> {t("tin chưa đọc", "unread")}</span>
    </span>
  );
}

// The chat channel list screen: the five hook states of spec 5.1, server order, no moderation control.
export function ChannelList({
  tenantId,
  basePath = `/c/${tenantId}/chat`,
}: {
  tenantId: string;
  basePath?: string;
}) {
  const t = useT();
  const { state, channels, error, refresh } = useChatChannels(tenantId);
  const empty = t(
    "Chưa có kênh trò chuyện nào bạn được xem.",
    "There are no chat channels you can read.",
  );
  return (
    <div data-state={state}>
      <h1 className={styles.heading}>{t("Trò chuyện", "Chat")}</h1>
      {state === "loading" ? <p role="status">{t("Đang tải…", "Loading…")}</p> : null}
      {error || state === "empty" ? (
        <div className={styles.notice} role={state === "empty" ? undefined : "alert"}>
          {error?.message ?? empty}
          {error?.retry ? (
            <Button variant="secondary" onClick={() => refresh()}>
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
      {channels.length > 0 ? (
        <ul className={styles.list}>
          {channels.map((channel) => (
            <li key={channel.id}>
              <Link className={styles.row} href={`${basePath}/${channel.id}`}>
                <span className={styles.title} dir="auto">
                  {channelTitle(channel, t)}
                </span>
                <UnreadBadge count={channel.unreadCount} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
