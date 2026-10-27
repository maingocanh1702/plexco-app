"use client";

import { useEffect, useState } from "react";
import { useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { describeReverseError, replayedNotice } from "../../lib/session-error-ui";
import { reversePayment } from "../../lib/roster-payments-api";
import type { SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";

export const REASON_MAX = 200;

/**
 * Reverse one manual allocation: a required reason (1..200), then POST reverse (needs money.correct).
 * Same lock as the add form: the reason is read-only while in flight and after an uncertain failure,
 * so a retry replays the same command key; Cancel then refetches.
 */
export function RosterReverseDialog({
  target,
  ctx,
  sessionId,
  onClose,
  onReversed,
  onReload,
}: {
  target: { allocationId: string; amount: number; name: string } | null;
  ctx: SessionApiContext;
  sessionId: string;
  onClose: () => void;
  onReversed: (message: string) => void;
  onReload: () => void;
}) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [invalid, setInvalid] = useState(false);
  const cmd = useRosterCommand();
  const allocationId = target?.allocationId;
  useEffect(() => {
    setReason("");
    setInvalid(false);
    cmd.reset();
  }, [allocationId]);

  async function confirm() {
    if (!target || cmd.busy) return;
    const trimmed = reason.trim();
    if (trimmed.length === 0 || trimmed.length > REASON_MAX) {
      setInvalid(true);
      return;
    }
    const result = await cmd.run(
      (commandId) =>
        reversePayment(ctx, sessionId, target.allocationId, { commandId, reason: trimmed }),
      {
        tenantId: ctx.tenantId,
        kind: "reverse",
        targets: [sessionId, target.allocationId],
        fingerprint: trimmed,
      },
    );
    if (result) {
      onReversed(
        result.replayed
          ? replayedNotice(t)
          : t(
              `Đã hoàn tác ${formatVnd(target.amount)} của ${target.name}`,
              `Reversed ${formatVnd(target.amount)} for ${target.name}`,
            ),
      );
    }
  }

  return (
    <ConfirmDialog
      open={target !== null}
      title={t("Hoàn tác khoản thanh toán?", "Reverse this payment?")}
      body={
        <>
          <p>
            {t(
              "Hệ thống ghi thêm một dòng âm vào sổ; dòng gốc được giữ nguyên.",
              "A negative row is appended to the ledger; the original row stays.",
            )}
          </p>
          <TextField
            label={t("Lý do (bắt buộc)", "Reason (required)")}
            value={reason}
            maxLength={REASON_MAX}
            required
            readOnly={cmd.locked || cmd.busy}
            error={
              invalid ? t("Nhập lý do (1–200 ký tự).", "Enter a reason (1–200 characters).") : null
            }
            onChange={(e) => {
              setReason(e.target.value);
              setInvalid(false);
              cmd.reset();
            }}
          />
        </>
      }
      confirmLabel={t("Hoàn tác", "Reverse")}
      danger
      busy={cmd.busy}
      error={
        cmd.error ? (
          <ApiErrorNotice
            autoFocus
            error={cmd.error}
            describe={describeReverseError}
            onRetry={() => void confirm()}
            onReload={onReload}
          />
        ) : null
      }
      onConfirm={() => void confirm()}
      // after an uncertain failure the reversal may have landed: refetch (which also closes) instead of just closing
      onCancel={() => (cmd.locked ? onReload() : onClose())}
    />
  );
}
