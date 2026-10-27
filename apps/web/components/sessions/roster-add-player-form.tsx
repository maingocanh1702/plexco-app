"use client";

import { useState, type FormEvent } from "react";
import { useT } from "../../lib/i18n-client";
import { addPlayer } from "../../lib/roster-payments-api";
import { replayedNotice } from "../../lib/session-error-ui";
import { checkTypedName, stripInvisibleChars } from "../../lib/session-form-model";
import type { SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { Button } from "../ui/button";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";
import styles from "./roster.module.css";

export const DISPLAY_NAME_MAX = 100;

/**
 * Why the host-typed name cannot be sent, or null when it can. "length": nothing visible is left
 * after the L27 strip and the trim, or it is longer than DISPLAY_NAME_MAX. "chars" (L29): the web
 * twin checkTypedName refuses what is left (control, bidi, line or paragraph separator, blank-looking
 * code points), as the server does. The value sent stays the strip-and-trim result.
 */
export function addPlayerNameProblem(raw: string): "length" | "chars" | null {
  const name = stripInvisibleChars(raw).trim();
  if (name.length === 0 || name.length > DISPLAY_NAME_MAX) return "length";
  return checkTypedName(name) === null ? "chars" : null;
}

/**
 * Host-add by display name (DD-85: no member picker, a name is never resolved to a member). The
 * one field is trimmed 1..100; the server answers active or waitlisted and the result is announced.
 * The name is read-only while an add is in flight and after an UNCERTAIN failure (the add may have
 * committed): the retry replays the same command key, where an edit would mint a new key and could
 * add the person twice. The lock lasts until a 2xx or Cancel (which refetches). Leaving the tab
 * unmounts the form and drops the key, so the hook refetches then (`onReload`): the roster the host
 * comes back to shows whether the add landed, before anyone types the name again.
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
  const [problem, setProblem] = useState<ReturnType<typeof addPlayerNameProblem>>(null);
  const cmd = useRosterCommand(onReload);
  const locked = cmd.locked;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (cmd.busy) return;
    // L27: strip invisible code points first; an invisible-only name is the empty-name error.
    const displayName = stripInvisibleChars(name).trim();
    // L29: control, bidi, separator and blank-looking code points are refused, never stripped.
    const nameProblem = addPlayerNameProblem(name);
    if (nameProblem) {
      setProblem(nameProblem);
      return;
    }
    setProblem(null);
    const result = await cmd.run(
      (commandId) => addPlayer(ctx, sessionId, { commandId, displayName }),
      { tenantId: ctx.tenantId, kind: "add", targets: [sessionId], fingerprint: displayName },
    );
    if (!result) return;
    const { status, waitlistPosition } = result.player;
    const added =
      status === "waitlisted"
        ? t(
            `${displayName} vào danh sách chờ (#${waitlistPosition ?? "?"})`,
            `${displayName} joined the waitlist (#${waitlistPosition ?? "?"})`,
          )
        : t(`Đã thêm ${displayName}`, `${displayName} added`);
    onAdded(result.replayed ? replayedNotice(t) : added);
    setName("");
    setOpen(false);
  }

  // Cancelling after an uncertain failure: refetch so the host sees whether the add landed, and
  // drop the name so reopening cannot re-add it blindly. reset() releases the lock, so a later
  // unmount (tab switch) does not refetch a second time.
  function cancel() {
    if (locked) {
      onReload();
      cmd.reset();
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
          problem === "length"
            ? t(
                `Nhập tên từ 1 đến ${DISPLAY_NAME_MAX} ký tự.`,
                `Enter a name of 1 to ${DISPLAY_NAME_MAX} characters.`,
              )
            : problem === "chars"
              ? t(
                  "Tên không được chứa ký tự điều khiển hoặc ký tự ẩn.",
                  "The name cannot contain control or hidden characters.",
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
