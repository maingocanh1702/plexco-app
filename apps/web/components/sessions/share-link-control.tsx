"use client";
import { useState } from "react";
import { apiFetch } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { tenantQuery, type SessionApiContext, type SessionDetailDto } from "../../lib/sessions-api";
import { useCommandId } from "../../lib/use-command-id";
import { Button } from "../ui/button";
import { ApiErrorNotice } from "./api-error-notice";
import detailStyles from "./session-detail-view.module.css";

/** L39 D4c: rotate revokes the old link; no revoke button; no server-built URL; no storage. */
export function ShareLinkControl(props: { session: SessionDetailDto; ctx: SessionApiContext }) {
  const { session, ctx } = props;
  const t = useT();
  const keeper = useCommandId(); // one commandId per attempt, kept after an uncertain failure
  const [step, setStep] = useState<"idle" | "confirm" | "busy">("idle");
  const [error, setError] = useState<unknown>(null);
  const [url, setUrl] = useState<string | null>(); // undefined: none yet; null: a replay
  const [copied, setCopied] = useState<string | null>(null); // the url last copied
  if (session.visibility !== "public") {
    return (
      <p className={detailStyles.viewOnly}>
        {t("Kèo riêng tư không có liên kết chia sẻ.", "A private session has no share link.")}
      </p>
    );
  }
  async function mint() {
    setStep("busy");
    setError(null);
    try {
      const data = await apiFetch<{ shareLink: { path: string } | null }>(
        `/api/sessions/${encodeURIComponent(session.id)}/share-link?${tenantQuery(ctx.tenantId)}`,
        { method: "POST", json: { commandId: keeper.get() }, csrfToken: ctx.csrfToken },
      );
      keeper.settle(); // success: the next press is a new command, so a new link
      setUrl(data.shareLink ? window.location.origin + data.shareLink.path : null);
      setStep("idle");
    } catch (failure) {
      keeper.settle(failure);
      setError(failure);
      setStep("confirm");
    }
  }
  function cancel() {
    setStep("idle"); // sends nothing
    setError(null);
    keeper.reset();
  }
  const copy = (text: string) =>
    navigator.clipboard.writeText(text).then(
      () => setCopied(text),
      () => setCopied(null),
    );
  const onceOnly = t(
    "Liên kết chỉ hiện một lần; hãy sao chép ngay.",
    "The link is shown only once; copy it now.",
  );
  const warn = t(
    "Tạo liên kết mới sẽ làm liên kết cũ của kèo này ngừng hoạt động ngay.",
    "Creating a new link makes this session's previous link stop working right away.",
  );
  const replay = t(
    "Liên kết đã được tạo nhưng không hiển thị được. Hãy tạo liên kết mới.",
    "The link was created but could not be shown. Create a new one.",
  );
  return (
    <div>
      {step === "idle" ? (
        <Button variant="secondary" onClick={() => setStep("confirm")}>
          {t("Tạo liên kết chia sẻ", "Create share link")}
        </Button>
      ) : (
        <>
          <p>{warn}</p>
          <div className={detailStyles.actions}>
            <Button disabled={step === "busy"} onClick={() => void mint()}>
              {t("Xác nhận", "Confirm")}
            </Button>
            <Button variant="ghost" disabled={step === "busy"} onClick={cancel}>
              {t("Huỷ", "Cancel")}
            </Button>
          </div>
          {error ? <ApiErrorNotice error={error} onRetry={() => void mint()} /> : null}
        </>
      )}
      {url === null ? <p>{replay}</p> : null}
      {url ? (
        <>
          <input readOnly value={url} aria-label={onceOnly} />
          <Button variant="secondary" onClick={() => void copy(url)}>
            {copied === url ? t("Đã sao chép", "Copied") : t("Sao chép", "Copy")}
          </Button>
          <p className={detailStyles.viewOnly}>{onceOnly}</p>
        </>
      ) : null}
    </div>
  );
}
