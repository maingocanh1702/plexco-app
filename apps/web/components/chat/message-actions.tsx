"use client";

import type { ChatLiveMessageDto } from "@plexco/core";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useT } from "../../lib/i18n-client";
import type { ChatListError } from "../../lib/use-chat";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { cx } from "../ui/cx";
import fieldStyles from "../ui/field.module.css";
import { InlineError } from "../ui/inline-error";
import { canSend } from "./composer";
import styles from "./message-list.module.css";

/** Row commands the view wires to the hook; edit and remove resolve null or the 5.2.3 / 5.2.4 row. */
export interface RowActions {
  onReply(id: string): void;
  onEdit(id: string, body: string): Promise<ChatListError | null>;
  onRemove(id: string): Promise<ChatListError | null>;
}

/** What a failed edit leaves (5.2.3): the row copy, whether the editor closes, whether Edit stays hidden. */
export const afterEdit = (row: ChatListError) => ({
  message: row.message,
  close: !row.keepDraft,
  shut: row.code === "CHAT_EDIT_WINDOW_CLOSED",
});

/** Controls of one live row: Reply for all, Edit and Delete only on own rows (DF-2); the server decides the rest. */
export function MessageActions({
  m,
  actions,
}: {
  m: Pick<ChatLiveMessageDto, "id" | "body" | "mine">;
  actions: RowActions;
}) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string | null>(null); // non-null = the editor is open
  const [asking, setAsking] = useState(false); // the delete dialog is open
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(""); // 5.2.3 copy inline, 5.2.4 copy inside the dialog
  const [shut, setShut] = useState(false); // CHAT_EDIT_WINDOW_CLOSED: Edit stays hidden here
  const closeEditor = () => {
    flushSync(() => setDraft(null));
    box.current?.querySelector("button")?.focus(); // back to the row controls, not to <body>
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (draft === null || busy) return;
    setBusy(true);
    const row = await actions.onEdit(m.id, draft);
    setBusy(false);
    const out = row && afterEdit(row);
    setError(out?.message ?? "");
    if (out?.shut) setShut(true);
    if (!out || out.close) closeEditor();
  };
  const remove = async () => {
    setBusy(true);
    const row = await actions.onRemove(m.id);
    setBusy(false);
    if (row) setError(row.message);
    else setAsking(false);
  };
  return (
    <>
      <div ref={box} className={styles.actions}>
        {m.mine && !shut && draft === null ? (
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              setDraft(m.body);
            }}
          >
            {t("Sửa", "Edit")}
          </Button>
        ) : null}
        {m.mine ? (
          <Button
            variant="ghost"
            onClick={() => {
              setError("");
              setAsking(true);
            }}
          >
            {t("Xoá", "Delete")}
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => actions.onReply(m.id)}>
          {t("Trả lời", "Reply")}
        </Button>
      </div>
      {draft !== null ? (
        <form className={styles.editor} onSubmit={save}>
          <textarea
            className={cx(fieldStyles.control, styles.edit)}
            aria-label={t("Sửa", "Edit")}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
          <div className={styles.actions}>
            <Button type="submit" disabled={busy || !canSend(draft)}>
              {t("Lưu", "Save")}
            </Button>
            <Button variant="ghost" onClick={closeEditor} disabled={busy}>
              {t("Huỷ", "Cancel")}
            </Button>
          </div>
        </form>
      ) : null}
      {error && !asking ? <InlineError>{error}</InlineError> : null}
      {m.mine ? (
        <ConfirmDialog
          open={asking}
          danger
          busy={busy}
          title={t("Xoá tin nhắn này?", "Delete this message?")}
          body={null}
          error={error && asking ? <InlineError>{error}</InlineError> : null}
          confirmLabel={t("Xoá", "Delete")}
          onConfirm={() => void remove()}
          onCancel={() => {
            setAsking(false);
            setError("");
          }}
        />
      ) : null}
    </>
  );
}
