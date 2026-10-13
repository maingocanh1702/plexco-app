"use client";

import { useEffect, useState } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { formatVnd } from "../../lib/money";
import { describeReverseError } from "../../lib/session-error-ui";
import { reversePayment, type SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";

export const REASON_MAX = 200;

/** Reverse one manual allocation: a required reason (1..200), then POST reverse (needs money.correct). */
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
  const lang = useLang();
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
    const result = await cmd.run((commandId) =>
      reversePayment(ctx, sessionId, target.allocationId, { commandId, reason: trimmed }),
    );
    if (result) {
      onReversed(
        t(
          `Đã hoàn tác ${formatVnd(target.amount, lang)} của ${target.name}`,
          `Reversed ${formatVnd(target.amount, lang)} for ${target.name}`,
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
            error={cmd.error}
            describe={describeReverseError}
            onRetry={() => void confirm()}
            onReload={onReload}
          />
        ) : null
      }
      onConfirm={() => void confirm()}
      onCancel={onClose}
    />
  );
}
