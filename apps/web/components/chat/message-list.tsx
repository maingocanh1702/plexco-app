"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { ChatModerateInput } from "../../lib/chat-api";
import { useLang, useT } from "../../lib/i18n-client";
import { formatTimestamp } from "../../lib/session-time";
import type { ChannelState, ChatListError } from "../../lib/use-chat";
import { useTenantContext } from "../../lib/use-tenant-context";
import { Button } from "../ui/button";
import { MessageActions, ModerateEntry, type RowActions } from "./message-actions";
import styles from "./message-list.module.css";

type Msg = ChannelState["messages"][number];
type Live = Extract<Msg, { tombstone: null }>;
/** The last finished hide or restore: ids and the action only, never text, a note or a reason. */
export type Moderated = { id: string; action: ChatModerateInput["action"] };

export interface MessageListProps {
  tenantId: string;
  messages: Msg[]; // server order (newest first): shown reversed, never sorted
  hasOlder: boolean;
  onLoadOlder: () => void;
  olderError: ChatListError | null;
  labelledBy?: string; // id of the heading that names the log
  actions?: RowActions; // row commands; none = read-only rows
  moderated?: Moderated | null; // feeds the status line (N15, N16) and the focus move (DM-7)
}

/** Chronological chat log: older-page control, DF-1 labels, tombstones, reply quotes, row actions. */
export function MessageList({
  tenantId,
  messages,
  hasOlder,
  onLoadOlder,
  olderError,
  labelledBy,
  actions,
  moderated,
}: MessageListProps) {
  const t = useT();
  const lang = useLang();
  const { timezone } = useTenantContext(tenantId);
  const removed = t("Tin nhắn đã bị gỡ.", "Message removed.");
  const done = {
    hide: t("Đã ẩn tin nhắn.", "Message hidden."),
    restore: t("Đã khôi phục tin nhắn.", "Message restored."),
  };
  const row = useRef<HTMLDivElement>(null); // header of the moderated row, to find its <li>
  const gone = messages.some((m) => m.id === moderated?.id && m.tombstone);
  // DM-7: a hide unmounts its opener (a restore does once its walk finds the row); land on the row's next
  // control, never <body>. Re-runs when another admin flips this row later; focus moves only from <body>
  useEffect(() => {
    const li = row.current?.closest("li");
    if (moderated && document.activeElement === document.body)
      li?.querySelector<HTMLElement>(gone ? "button" : "[data-reply]")?.focus();
  }, [moderated, gone]);
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
      <div
        role="log"
        aria-labelledby={labelledBy}
        aria-label={labelledBy ? undefined : t("Trò chuyện", "Chat")}
      >
        <ol className={styles.list}>
          {[...messages].reverse().map((m) => {
            const ref = m.id === moderated?.id ? row : undefined;
            if (m.tombstone) {
              return (
                <li key={m.id} className={styles.row}>
                  <div ref={ref} className={styles.meta}>
                    {removed}
                  </div>
                  {actions?.onModerate && m.tombstone === "moderation_hidden" ? (
                    <div className={styles.actions}>
                      <ModerateEntry id={m.id} action="restore" onModerate={actions.onModerate} />
                    </div>
                  ) : null}
                </li>
              );
            }
            const at = time(m.createdAt);
            return (
              <li key={m.id} className={m.mine ? `${styles.row} ${styles.mine}` : styles.row}>
                <div ref={ref} className={styles.meta}>
                  {sender(m)}
                  {at ? <span>{at}</span> : null}
                  {m.editedAt ? <span>{t("(đã sửa)", "(edited)")}</span> : null}
                </div>
                {quote(m)}
                <p className={styles.body} dir="auto">
                  {m.body}
                </p>
                {actions ? <MessageActions m={m} actions={actions} /> : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div role="status">
        {moderated ? <p key={moderated.id}>{done[moderated.action]}</p> : null}
      </div>
    </>
  );
}
