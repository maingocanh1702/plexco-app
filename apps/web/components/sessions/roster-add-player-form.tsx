"use client";

import { useState, type FormEvent } from "react";
import { useT } from "../../lib/i18n-client";
import { addPlayer } from "../../lib/roster-payments-api";
import type { SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { Button } from "../ui/button";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";
import styles from "./roster.module.css";

export const DISPLAY_NAME_MAX = 100;

/**
 * Host-add by display name (DD-85: no member picker, a name is never resolved to a member). The
 * one field is trimmed 1..100; the server answers active or waitlisted and the result is announced.
 * The name is read-only while an add is in flight and after an UNCERTAIN failure (the add may have
 * committed): the retry replays the same command key, where an edit would mint a new key and could
 * add the person twice. The lock lasts until a 2xx or Cancel (which refetches).
 */
export function RosterAddPlayerForm({
  ctx,
  sessionId,
  disabled,
  describedBy,
  onAdded,
  onReload,
  onCancel,
}: {
  ctx: SessionApiContext;
  sessionId: string;
  disabled: boolean;
  describedBy?: string;
  onAdded: (message: string) => void;
  onReload: () => void;
  /** The form closed without adding (its focused Cancel unmounts): the host moves focus. */
  onCancel: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [invalid, setInvalid] = useState(false);
  const cmd = useRosterCommand();
  const locked = cmd.locked;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (cmd.busy) return;
    const displayName = name.trim();
    if (displayName.length === 0 || displayName.length > DISPLAY_NAME_MAX) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const result = await cmd.run((commandId) =>
      addPlayer(ctx, sessionId, { commandId, displayName }),
    );
    if (!result) return;
    const { status, waitlistPosition } = result.player;
    onAdded(
      status === "waitlisted"
        ? t(
            `${displayName} vào danh sách chờ (#${waitlistPosition ?? "?"})`,
            `${displayName} joined the waitlist (#${waitlistPosition ?? "?"})`,
          )
        : t(`Đã thêm ${displayName}`, `${displayName} added`),
    );
    setName("");
    setOpen(false);
  }

  // Cancelling after an uncertain failure: refetch so the host sees whether the add landed, and
  // drop the name so reopening cannot re-add it blindly.
  function cancel() {
    if (locked) {
      onReload();
      setName("");
    }
    setOpen(false);
    onCancel();
  }

  if (!open) {
    return (
      <Button
        variant="secondary"
        disabled={disabled}
        aria-describedby={disabled ? describedBy : undefined}
        onClick={() => {
          cmd.reset();
          setOpen(true);
        }}
      >
        {t("Thêm người chơi", "Add player")}
      </Button>
    );
  }
  return (
    <form className={styles.addForm} onSubmit={(e) => void submit(e)} noValidate>
      <TextField
        label={t("Tên hiển thị", "Display name")}
        hint={t(
          "Thêm người mới theo tên (1–100 ký tự). Hệ thống không tự ghép với thành viên cũ.",
          "Adds a new person by name (1–100 characters). It is never matched to an existing member.",
        )}
        error={
          invalid
            ? t(
                `Nhập tên từ 1 đến ${DISPLAY_NAME_MAX} ký tự.`,
                `Enter a name of 1 to ${DISPLAY_NAME_MAX} characters.`,
              )
            : null
        }
        value={name}
        maxLength={DISPLAY_NAME_MAX}
        autoComplete="off"
        autoFocus
        readOnly={locked || cmd.busy}
        onChange={(e) => {
          setName(e.target.value);
          cmd.reset(); // a changed name is a new command
        }}
      />
      {cmd.error ? (
        <ApiErrorNotice error={cmd.error} onRetry={() => void submit()} onReload={onReload} />
      ) : null}
      <div className={styles.formActions}>
        <Button type="submit" disabled={cmd.busy} aria-busy={cmd.busy ? true : undefined}>
          {cmd.busy ? t("Đang thêm…", "Adding…") : t("Thêm", "Add")}
        </Button>
        <Button variant="ghost" disabled={cmd.busy} onClick={cancel}>
          {t("Huỷ", "Cancel")}
        </Button>
      </div>
    </form>
  );
}
