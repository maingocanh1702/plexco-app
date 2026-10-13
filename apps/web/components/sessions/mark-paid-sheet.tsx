"use client";

import { useEffect, useState } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import {
  buildConfirmBody,
  initialAmounts,
  NOTE_MAX,
  type AmountMap,
} from "../../lib/mark-paid-model";
import { formatVnd, formatVndInput } from "../../lib/money";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import {
  confirmMarkPaid,
  previewMarkPaid,
  type MarkPaidLineDto,
  type MarkPaidResultDto,
  type PaymentMethod,
  type SessionApiContext,
} from "../../lib/sessions-api";
import { useRosterCommand } from "../../lib/use-roster-command";
import { Badge } from "../ui/badge";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { TextField } from "../ui/text-field";
import { ApiErrorNotice } from "./api-error-notice";
import { MarkPaidLines, parseAmount } from "./mark-paid-lines";
import styles from "./roster.module.css";

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
  /** `paid` = at least one payment was recorded (caller refetches and returns focus). */
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

  useEffect(() => {
    if (!open) return;
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
  const body = buildConfirmBody({ commandId: "x", method, lines, amounts, note });
  const locked = confirmCmd.error !== null && !isDefiniteFailure(confirmCmd.error);

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
    if (!body || note.trim().length > NOTE_MAX) return;
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
  const reloadAndRestart = () => {
    onReload();
    previewCmd.reset();
    confirmCmd.reset();
    setStep("method");
  };

  return (
    <ConfirmDialog
      open={open}
      title={copy[step].title}
      confirmLabel={copy[step].confirm}
      busy={active.busy}
      body={
        step === "method" ? (
          <>
            <fieldset className={styles.radios}>
              <legend>{t("Hình thức thanh toán", "Payment method")}</legend>
              {(["cash", "attested_transfer"] as const).map((m) => (
                <label key={m} className={styles.radio}>
                  <input
                    type="radio"
                    name="mark-paid-method"
                    value={m}
                    checked={method === m}
                    onChange={() => setMethod(m)}
                  />
                  {m === "cash"
                    ? t("Tiền mặt", "Cash")
                    : t("Chuyển khoản (host xác nhận)", "Bank transfer (host-confirmed)")}
                </label>
              ))}
            </fieldset>
            <TextField
              label={t("Ghi chú (không bắt buộc)", "Note (optional)")}
              value={note}
              maxLength={NOTE_MAX}
              onChange={(e) => setNote(e.target.value)}
            />
          </>
        ) : step === "review" ? (
          <MarkPaidLines
            lines={lines}
            names={names}
            raw={raw}
            amounts={amounts}
            locked={locked}
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
          <ul className={styles.lines} aria-live="polite">
            {result?.lines.map((l) => (
              <li key={l.playerId} className={styles.lineHead}>
                <span>{names[l.playerId]}</span>
                <span>{formatVnd(l.amount, lang)}</span>
                <Badge tone={l.status === "paid" ? "success" : "warning"}>
                  {l.status === "paid"
                    ? t("Đã thanh toán", "Paid")
                    : t("Trả một phần", "Partly paid")}
                </Badge>
              </li>
            ))}
          </ul>
        )
      }
      error={
        active.error && step !== "result" ? (
          <ApiErrorNotice
            error={active.error}
            onRetry={copy[step].run}
            onReload={reloadAndRestart}
          />
        ) : null
      }
      onConfirm={() => {
        if (step === "review" && !body) return;
        copy[step].run();
      }}
      onCancel={() => onClose(step === "result")}
    />
  );
}
