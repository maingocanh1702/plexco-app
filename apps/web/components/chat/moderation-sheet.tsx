"use client";

import { useEffect, useId, useState } from "react";
import type { ChatModerateInput } from "../../lib/chat-api";
import { useT } from "../../lib/i18n-client";
import type { ChatListError } from "../../lib/use-chat";
import { useCommandId, type CommandIdKeeper } from "../../lib/use-command-id";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { InlineError } from "../ui/inline-error";
import { TextField } from "../ui/text-field";
import styles from "./moderation-sheet.module.css";

/** The server's closed reason set (0063): the first four need a null note, `other` needs a 1..500-byte one. */
export const MODERATION_REASONS = ["spam", "harassment", "unsafe", "off_topic", "other"] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

export type ModerationCheck =
  | { ok: true; reasonCode: ModerationReason; reasonNote: string | null }
  | { ok: false; problem: "blank" | "too_long" };

/**
 * DM-9: `other` needs a trimmed, non-blank note of at most 500 UTF-8 BYTES (the server measures
 * octet_length, not characters); the trimmed note is what is measured and sent. Every other reason
 * sends `reasonNote: null`, never "", and drops whatever the note field still holds. The server stays
 * the judge: a 422 CHAT_REASON_INVALID still renders its own row.
 */
export function validateModeration(reason: ModerationReason, note: string): ModerationCheck {
  if (reason !== "other") return { ok: true, reasonCode: reason, reasonNote: null };
  const trimmed = note.trim();
  if (trimmed === "") return { ok: false, problem: "blank" };
  if (new TextEncoder().encode(trimmed).length > 500) return { ok: false, problem: "too_long" };
  return { ok: true, reasonCode: reason, reasonNote: trimmed };
}

/**
 * DM-6: one command key per user action. `get()` takes NO payload (the note is sensitive and must not
 * become a fingerprint) and `settle()` is never called (chat-api resolves {ok: false} instead of
 * throwing), so every failure keeps the key and a retry of the same input replays under it. The
 * caller resets the keeper on every reason or note change; a 2xx (null) resets it here.
 */
export async function submitModeration(
  keeper: CommandIdKeeper,
  send: (input: ChatModerateInput) => Promise<ChatListError | null>,
  input: Omit<ChatModerateInput, "commandId">,
): Promise<ChatListError | null> {
  const error = await send({ ...input, commandId: keeper.get() });
  if (error === null) keeper.reset();
  return error;
}

/** DM-8: the one role=alert line (a failed command's row copy or a note problem); empty copy shows nothing. */
export const moderationNotice = (copy: string) => (copy ? <InlineError>{copy}</InlineError> : null);

/**
 * Hide or restore one message: ConfirmDialog composed unedited, a reason group, a note for `other` only.
 * `onDone` fires on a 2xx; a failure keeps the sheet open and the confirm button is the manual retry.
 */
export function ModerationSheet({
  action,
  open,
  onModerate,
  onDone,
  onCancel,
}: {
  action: ChatModerateInput["action"];
  open: boolean;
  onModerate: (input: ChatModerateInput) => Promise<ChatListError | null>;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const id = useId(); // the radio group name: every eligible row mounts its own sheet
  const keeper = useCommandId();
  const [reason, setReason] = useState<ModerationReason>(MODERATION_REASONS[0]);
  const [note, setNote] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // a changed reason or note is a new user action (new command key, no stale notice); a reopen starts clean
  const restart = (next: ModerationReason = MODERATION_REASONS[0], text = "") => {
    setReason(next);
    setNote(text);
    setNotice("");
    keeper.reset();
  };
  useEffect(() => restart(), [open]);

  const copy = {
    spam: t("Spam", "Spam"),
    harassment: t("Quấy rối", "Harassment"),
    unsafe: t("Nội dung không an toàn", "Unsafe content"),
    off_topic: t("Lạc đề", "Off topic"),
    other: t("Lý do khác", "Other"),
    blank: t("Nhập ghi chú cho lý do khác.", "Enter a note for Other."),
    too_long: t("Ghi chú quá dài.", "This note is too long."),
  };
  async function confirm() {
    const check = validateModeration(reason, note);
    if (busy) return;
    if (!check.ok) return setNotice(copy[check.problem]);
    setBusy(true);
    setNotice("");
    const { reasonCode, reasonNote } = check;
    const row = await submitModeration(keeper, onModerate, { action, reasonCode, reasonNote });
    setBusy(false);
    if (row) setNotice(row.message);
    else onDone();
  }

  const hide = action === "hide";
  return (
    <ConfirmDialog
      open={open}
      title={
        hide
          ? t("Ẩn tin nhắn này?", "Hide this message?")
          : t("Khôi phục tin nhắn này?", "Restore this message?")
      }
      confirmLabel={hide ? t("Ẩn tin", "Hide") : t("Khôi phục", "Restore")}
      busy={busy}
      error={moderationNotice(notice)}
      onConfirm={() => void confirm()}
      onCancel={onCancel}
      body={
        <>
          <fieldset className={styles.radios} disabled={busy}>
            <legend>{t("Lý do (bắt buộc)", "Reason (required)")}</legend>
            {MODERATION_REASONS.map((r) => (
              <label key={r} className={styles.radio}>
                <input
                  type="radio"
                  name={id}
                  value={r}
                  checked={reason === r}
                  onChange={() => restart(r)}
                />
                {copy[r]}
              </label>
            ))}
          </fieldset>
          {reason === "other" ? (
            <TextField
              label={t("Ghi chú (bắt buộc)", "Note (required)")}
              value={note}
              required
              readOnly={busy}
              onChange={(e) => restart(reason, e.target.value)}
            />
          ) : null}
        </>
      }
    />
  );
}
