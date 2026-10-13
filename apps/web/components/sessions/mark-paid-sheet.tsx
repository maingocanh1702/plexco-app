"use client";

import { useEffect, useState } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { buildConfirmBody, initialAmounts, type AmountMap } from "../../lib/mark-paid-model";
import { formatVndInput } from "../../lib/money";
import {
  confirmMarkPaid,
  previewMarkPaid,
  type MarkPaidLineDto,
  type MarkPaidResultDto,
  type PaymentMethod,
} from "../../lib/roster-payments-api";
import type { SessionApiContext } from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { ApiErrorNotice } from "./api-error-notice";
import { MarkPaidLines, parseAmount } from "./mark-paid-lines";
import { MarkPaidMethodStep } from "./mark-paid-method-step";
import { MarkPaidResult } from "./mark-paid-result";

type Step = "method" | "review" | "result";

/**
 * Manual mark-paid (DD-25 / DD-40) as a three-step sheet on the shared dialog: method + note ->
 * server preview with editable amounts -> confirm -> result. `expectedTotal` is built from the
 * very amounts shown (mark-paid-model), so MARK_PAID_TOTAL_MISMATCH cannot come from here.
 */
export function MarkPaidSheet({
  open,
  ctx,
  sessionId,
  players,
  onClose,
  onReload,
}: {
  open: boolean;
  ctx: SessionApiContext;
  sessionId: string;
  players: { id: string; name: string }[];
  /**
   * `paid` = a payment was (or, after an uncertain confirm, may have been) recorded, or the host
   * asked to reload: the caller clears the selection, refetches and focuses the roster heading.
   */
  onClose: (paid: boolean) => void;
  onReload: () => void;
}) {
  const t = useT();
  const lang = useLang();
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<MarkPaidLineDto[]>([]);
  const [raw, setRaw] = useState<Record<string, string>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [result, setResult] = useState<MarkPaidResultDto | null>(null);
  const previewCmd = useRosterCommand();
  const confirmCmd = useRosterCommand();

  // Reset while the sheet is CLOSED, so reopening never flashes the previous run's step or lines.
  useEffect(() => {
    if (open) return;
    setStep("method");
    setMethod("cash");
    setNote("");
    setLines([]);
    setResult(null);
    previewCmd.reset();
    confirmCmd.reset();
  }, [open]);

  const amounts: AmountMap = Object.fromEntries(
    lines.map((l) => [l.playerId, parseAmount(raw[l.playerId] ?? "")]),
  );
  const body = buildConfirmBody({ method, lines, amounts, note });
  const locked = confirmCmd.locked;

  async function preview() {
    if (players.length === 0) return;
    const res = await previewCmd.run(() =>
      previewMarkPaid(ctx, sessionId, { method, items: players.map((p) => ({ playerId: p.id })) }),
    );
    if (!res) return;
    setNames(Object.fromEntries(players.map((p) => [p.id, p.name])));
    setLines(res.lines);
    setRaw(
      Object.fromEntries(
        Object.entries(initialAmounts(res.lines)).map(([id, a]) => [id, formatVndInput(a, lang)]),
      ),
    );
    confirmCmd.reset();
    setStep("review");
  }

  async function confirm() {
    if (!body) return;
    const res = await confirmCmd.run((commandId) =>
      confirmMarkPaid(ctx, sessionId, { ...body, commandId }),
    );
    if (res) {
      setResult(res);
      setStep("result");
      onReload();
    }
  }

  const copy: Record<Step, { title: string; confirm: string; run: () => void }> = {
    method: {
      title: t(`Gạch nợ cho ${players.length} người`, `Record payment for ${players.length}`),
      confirm: t("Xem trước", "Preview"),
      run: () => void preview(),
    },
    review: {
      title: t("Xác nhận số tiền", "Confirm amounts"),
      confirm: t("Xác nhận", "Confirm"),
      run: () => void confirm(),
    },
    result: {
      title: t("Đã ghi nhận thanh toán", "Payment recorded"),
      confirm: t("Xong", "Done"),
      run: () => onClose(true),
    },
  };
  const active = step === "method" ? previewCmd : confirmCmd;
  // "Go back" must do what it says: one step back on review. After an uncertain confirm failure
  // the payment may have committed, so there is no safe step back (a new key could double-pay):
  // close as `paid` instead, so the caller refetches and focuses the roster heading (the opener is
  // disabled once the refetch shows the charge settled). "Reload data" closes the same way: its
  // focused button unmounts, and the refetched roster decides who is still payable.
  function cancel() {
    if (step === "review" && !locked) {
      confirmCmd.reset();
      setStep("method");
      return;
    }
    onClose(locked || step === "result");
  }

  return (
    <ConfirmDialog
      open={open}
      title={copy[step].title}
      confirmLabel={copy[step].confirm}
      busy={active.busy}
      body={
        step === "method" ? (
          <MarkPaidMethodStep method={method} note={note} onMethod={setMethod} onNote={setNote} />
        ) : step === "review" ? (
          <MarkPaidLines
            lines={lines}
            names={names}
            raw={raw}
            amounts={amounts}
            locked={locked || confirmCmd.busy}
            onChange={(id, text) => {
              const digits = text.replace(/\D/g, "");
              const value = parseAmount(digits);
              setRaw((r) => ({
                ...r,
                [id]: value === null ? digits : formatVndInput(value, lang),
              }));
              confirmCmd.reset(); // a changed amount is a new command
            }}
          />
        ) : (
          <MarkPaidResult lines={result?.lines ?? []} names={names} />
        )
      }
      error={
        active.error && step !== "result" ? (
          <ApiErrorNotice
            error={active.error}
            onRetry={copy[step].run}
            onReload={() => onClose(true)}
          />
        ) : null
      }
      onConfirm={() => {
        if (step === "review" && !body) return;
        copy[step].run();
      }}
      onCancel={cancel}
    />
  );
}
