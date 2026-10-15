"use client";

import { useEffect } from "react";
import { useT } from "../../lib/i18n-client";
import { removePlayer } from "../../lib/roster-payments-api";
import type { SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ApiErrorNotice } from "./api-error-notice";

/**
 * Remove an unpaid player. The server takes no note (RemovePlayerParams has none), so the body is
 * just the command key. A paid player is refused (REMOVE_REQUIRES_REVIEW; the server's envelope
 * message says to reverse the payment first).
 */
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
  const cmd = useRosterCommand();
  const targetId = target?.id;
  useEffect(() => {
    cmd.reset();
  }, [targetId]);

  async function confirm() {
    if (!target || cmd.busy) return;
    const result = await cmd.run((commandId) =>
      removePlayer(ctx, sessionId, target.id, { commandId }),
    );
    if (result) onRemoved(t(`Đã gỡ ${target.name}`, `${target.name} removed`));
  }

  return (
    <ConfirmDialog
      open={target !== null}
      title={t(`Gỡ ${target?.name ?? ""}?`, `Remove ${target?.name ?? ""}?`)}
      body={
        <p>
          {t(
            "Người này sẽ rời danh sách và khoản thu chưa thanh toán bị huỷ.",
            "They leave the roster and their unpaid charge is voided.",
          )}
        </p>
      }
      confirmLabel={t("Gỡ người chơi", "Remove player")}
      danger
      busy={cmd.busy}
      error={
        cmd.error ? (
          <ApiErrorNotice error={cmd.error} onRetry={() => void confirm()} onReload={onReload} />
        ) : null
      }
      onConfirm={() => void confirm()}
      // after an uncertain failure the removal may have landed: refetch (which also closes) instead of just closing
      onCancel={() => (cmd.locked ? onReload() : onClose())}
    />
  );
}
