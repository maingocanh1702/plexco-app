"use client";

import { useEffect, useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { NOTE_MAX } from "../../lib/mark-paid-model";
import { removePlayer, type SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";

/** Remove an unpaid player with an optional note (<= 200). A paid player is refused by the server (REMOVE_REQUIRES_REVIEW). */
export function RosterRemoveDialog({
  target,
  ctx,
  sessionId,
  onClose,
  onRemoved,
  onReload,
}: {
  target: { id: string; name: string } | null;
  ctx: SessionApiContext;
  sessionId: string;
  onClose: () => void;
  onRemoved: (message: string) => void;
  onReload: () => void;
}) {
  const t = useT();
  const [note, setNote] = useState("");
  const cmd = useRosterCommand();
  const targetId = target?.id;
  useEffect(() => {
    setNote("");
    cmd.reset();
  }, [targetId]);

  async function confirm() {
    if (!target || cmd.busy) return;
    const trimmed = note.trim();
    const result = await cmd.run((commandId) =>
      removePlayer(ctx, sessionId, target.id, { commandId, ...(trimmed ? { note: trimmed } : {}) }),
    );
    if (result) onRemoved(t(`Đã gỡ ${target.name}`, `${target.name} removed`));
  }

  const needsReview =
    cmd.error instanceof ApiClientError && cmd.error.code === "REMOVE_REQUIRES_REVIEW";
  return (
    <ConfirmDialog
      open={target !== null}
      title={t(`Gỡ ${target?.name ?? ""}?`, `Remove ${target?.name ?? ""}?`)}
      body={
        <>
          <p>
            {t(
              "Người này sẽ rời danh sách và khoản thu chưa thanh toán bị huỷ.",
              "They leave the roster and their unpaid charge is voided.",
            )}
          </p>
          <TextField
            label={t("Ghi chú (không bắt buộc)", "Note (optional)")}
            value={note}
            maxLength={NOTE_MAX}
            onChange={(e) => {
              setNote(e.target.value);
              cmd.reset();
            }}
          />
        </>
      }
      confirmLabel={t("Gỡ người chơi", "Remove player")}
      danger
      busy={cmd.busy}
      error={
        cmd.error ? (
          <>
            <ApiErrorNotice error={cmd.error} onRetry={() => void confirm()} onReload={onReload} />
            {needsReview ? (
              <p role="note">
                {t(
                  "Người này đã thanh toán, cần xem xét: hãy hoàn tác thanh toán trước.",
                  "This person has paid and needs review: reverse the payment first.",
                )}
              </p>
            ) : null}
          </>
        ) : null
      }
      onConfirm={() => void confirm()}
      onCancel={onClose}
    />
  );
}
