"use client";

import type { ReactNode } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { formatTimestamp } from "../../lib/session-time";
import type { ChannelState, ChatListError } from "../../lib/use-chat";
import { useTenantContext } from "../../lib/use-tenant-context";
import { Button } from "../ui/button";
import styles from "./message-list.module.css";

type Msg = ChannelState["messages"][number];
type Live = Extract<Msg, { tombstone: null }>;

export interface MessageListProps {
  tenantId: string;
  messages: Msg[]; // server order (newest first): shown reversed, never sorted
  hasOlder: boolean;
  onLoadOlder: () => void;
  olderError: ChatListError | null;
}

/** Chronological chat log: older-page control, DF-1 labels, tombstones, reply quotes; no actions. */
export function MessageList({
  tenantId,
  messages,
  hasOlder,
  onLoadOlder,
  olderError,
}: MessageListProps) {
  const t = useT();
  const lang = useLang();
  const { timezone } = useTenantContext(tenantId);
  const removed = t("Tin nhắn đã bị gỡ.", "Message removed.");
  const kind = {
    person: t("Thành viên", "Member"),
    assistant: t("Trợ lý", "Assistant"),
    system: t("Hệ thống", "System"),
  };
  // DF-3: an unparseable value hides the time (the formatter would throw)
  const time = (iso: string) =>
    Number.isNaN(Date.parse(iso)) ? "" : formatTimestamp(iso, timezone, lang);

  // DF-1: author text only as a text node in its own <bdi>
  const sender = (m: Live): ReactNode =>
    !m.mine && m.authorType === "person" && m.authorLabel ? (
      <bdi className={styles.sender}>{m.authorLabel}</bdi>
    ) : (
      <span className={styles.sender}>{m.mine ? t("Bạn", "You") : kind[m.authorType]}</span>
    );

  // DF-7: the quote needs the target in the loaded pages; a tombstoned target quotes the DF-12 text
  const quote = (m: Live): ReactNode => {
    if (!m.replyToMessageId) return null;
    const to = messages.find((x) => x.id === m.replyToMessageId);
    return (
      <p className={styles.quote}>
        {!to ? (
          t("Trả lời một tin nhắn", "Reply to a message")
        ) : to.tombstone ? (
          removed
        ) : (
          <>
            {sender(to)} <span dir="auto">{to.body}</span>
          </>
        )}
      </p>
    );
  };

  return (
    <>
      {hasOlder ? (
        <div className={styles.older}>
          <Button variant="secondary" onClick={() => onLoadOlder()}>
            {t("Xem tin cũ hơn", "Show older messages")}
          </Button>
          {olderError?.message ? (
            <span role="alert" className={styles.olderError}>
              {olderError.message}
            </span>
          ) : null}
        </div>
      ) : null}
      <div role="log">
        <ol className={styles.list}>
          {[...messages].reverse().map((m) => {
            if (m.tombstone) {
              return (
                <li key={m.id} className={styles.row}>
                  <div className={styles.meta}>{removed}</div>
                </li>
              );
            }
            const at = time(m.createdAt);
            return (
              <li key={m.id} className={m.mine ? `${styles.row} ${styles.mine}` : styles.row}>
                <div className={styles.meta}>
                  {sender(m)}
                  {at ? <span>{at}</span> : null}
                  {m.editedAt ? <span>{t("(đã sửa)", "(edited)")}</span> : null}
                </div>
                {quote(m)}
                <p className={styles.body} dir="auto">
                  {m.body}
                </p>
              </li>
            );
          })}
        </ol>
      </div>
    </>
  );
}
