"use client";

import type { ChatChannelDto } from "@plexco/core";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useT } from "../../lib/i18n-client";
import type { PendingMessage } from "../../lib/use-chat";
import { Button } from "../ui/button";
import styles from "./composer.module.css";

/** The hook's outbox values the composer renders and drives. */
export interface Outbox {
  pending: PendingMessage[];
  send(body: string, replyToMessageId?: string): unknown;
  retry(clientMsgId: string): unknown;
  discard(clientMsgId: string): unknown;
}

export const BODY_MAX_CHARS = 4000; // the SQL cap char_length(p_body) > 4000, 0063_chat_message_commands.sql:235
// Send stays disabled for a blank body (spec 2.2) or past the cap, counted in code points; the server re-checks.
export const canSend = (body: string) => body.trim() !== "" && [...body].length <= BODY_MAX_CHARS;
// Rejections of the text itself: it goes back into the field once, to be edited and sent as a new message.
const EDIT_AGAIN = new Set(["INVALID_BODY", "CHAT_MESSAGE_TOO_LARGE"]);

// Composer plus the outbox of its optimistic sends; always rendered. An admins_only channel locks it unless the
// server said this viewer canPostRestricted; the server still re-authorizes every send (RO-L16-1).
export function Composer({
  postPolicy,
  canPostRestricted = false,
  outbox,
  reply,
}: {
  postPolicy: ChatChannelDto["postPolicy"] | undefined;
  canPostRestricted?: boolean; // the channels answer's viewer flag; absent or false locks admins_only
  outbox: Outbox;
  reply?: { id: string; clear(): void }; // the chosen reply target and its Cancel
}) {
  const t = useT();
  const fieldId = useId();
  const hintId = useId();
  const counterId = useId();
  const field = useRef<HTMLTextAreaElement>(null);
  const [body, setBody] = useState("");
  const count = [...body].length;
  const over = count > BODY_MAX_CHARS;
  const [restored, setRestored] = useState<string[]>([]);
  const admins = postPolicy === "admins_only";
  const locked = admins && !canPostRestricted; // field and Send off, the hint stays (D7)
  const notSent = t("Chưa gửi được.", "Not sent.");
  // Render-phase restore, no effect: a not-yet-restored body rejection refills an empty field.
  const back = outbox.pending.find(
    (p) => p.failed && EDIT_AGAIN.has(p.failed.code) && !restored.includes(p.clientMsgId),
  );
  if (back) {
    setRestored([...restored, back.clientMsgId]);
    if (body.trim() === "") setBody(back.body);
  }
  // Each action hands focus back to the field, so it never stays on a button that just vanished.
  const thenFocus = (run: () => void) => {
    run();
    field.current?.focus();
  };
  const replyId = reply?.id;
  useEffect(() => {
    if (replyId) field.current?.focus(); // Reply on a row hands the caret to the field
  }, [replyId]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (locked || !canSend(body)) return;
    thenFocus(() => {
      outbox.send(body, replyId);
      reply?.clear();
      setBody("");
    });
  };
  return (
    <div className={styles.composer}>
      {outbox.pending.length > 0 ? (
        <ul className={styles.outbox}>
          {outbox.pending.map((p) => (
            <li key={p.clientMsgId} className={styles.entry}>
              <p dir="auto">{p.body}</p>
              {p.failed ? (
                <>
                  <p role="alert" className={styles.error}>
                    {p.failed.message === notSent ? notSent : `${notSent} ${p.failed.message}`}
                  </p>
                  <div className={styles.actions}>
                    {p.failed.retry ? (
                      <Button
                        variant="secondary"
                        onClick={() => thenFocus(() => outbox.retry(p.clientMsgId))}
                      >
                        {t("Thử lại", "Retry")}
                      </Button>
                    ) : null}
                    <Button
                      variant="ghost"
                      onClick={() => thenFocus(() => outbox.discard(p.clientMsgId))}
                    >
                      {t("Bỏ", "Discard")}
                    </Button>
                  </div>
                </>
              ) : (
                <p>{t("Đang gửi...", "Sending...")}</p>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {admins ? (
        <p id={hintId}>
          {t("Kênh này chỉ quản trị viên được đăng tin", "Only admins can post in this channel")}
        </p>
      ) : null}
      <form className={styles.form} onSubmit={submit}>
        {reply ? (
          <div className={styles.actions}>
            <p>{t("Trả lời một tin nhắn", "Reply to a message")}</p>
            <Button variant="ghost" onClick={() => thenFocus(reply.clear)}>
              {t("Huỷ", "Cancel")}
            </Button>
          </div>
        ) : null}
        <label className="sr-only" htmlFor={fieldId}>
          {t("Tin nhắn", "Message")}
        </label>
        <textarea
          id={fieldId}
          ref={field}
          className={styles.field}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby={admins ? `${hintId} ${counterId}` : counterId}
          disabled={locked}
          autoComplete="off"
        />
        <p id={counterId} className={over ? `${styles.counter} ${styles.over}` : styles.counter}>
          {count}/{BODY_MAX_CHARS}
        </p>
        <Button type="submit" disabled={locked || !canSend(body)}>
          {t("Gửi", "Send")}
        </Button>
      </form>
    </div>
  );
}
