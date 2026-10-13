"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  connectZalo,
  getZaloState,
  type ZaloStateDto,
  type ZaloStatus,
} from "../../lib/club-settings-client";
import { useLang, useT, type TFn } from "../../lib/i18n-client";
import { isForbidden } from "../../lib/settings-error-ui";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { Badge, type BadgeTone } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "./form-feedback";
import styles from "./settings-layout.module.css";

const TONE: Record<ZaloStatus, BadgeTone> = {
  not_connected: "neutral",
  connecting: "info",
  registered: "warning",
  active: "success",
  drift: "warning",
  error: "error",
  revoked: "error",
};

function statusLabel(status: ZaloStatus, t: TFn): string {
  switch (status) {
    case "not_connected":
      return t("Chưa kết nối", "Not connected");
    case "connecting":
      return t("Đang kết nối", "Connecting");
    case "registered":
      return t("Đã đăng ký webhook, chờ xác minh", "Webhook registered, awaiting verification");
    case "active":
      return t("Đang hoạt động", "Active");
    case "drift":
      return t("Cần đăng ký lại webhook", "Webhook needs re-registering");
    case "error":
      return t("Lỗi kết nối", "Connection error");
    case "revoked":
      return t("Đã thu hồi", "Revoked");
  }
}

type Card =
  | { phase: "loading" }
  | { phase: "forbidden" }
  | { phase: "error"; error: unknown }
  | { phase: "ready"; state: ZaloStateDto };

/**
 * Zalo bot connect card. Authority is connector.secret_manage (owner; an admin only with an
 * explicit grant), enforced by the routes: a 403 renders ONE uniform "not permitted" note. The bot
 * token is write-only: it lives in this component's state only while typed, goes out in one POST
 * and is cleared right after the submit, success or failure. It is never rendered back.
 */
export function ZaloConnectCard({ tenantId, csrfToken }: { tenantId: string; csrfToken: string }) {
  const t = useT();
  const lang = useLang();
  const online = useOnlineStatus();
  const command = useCommandId();
  const formRef = useRef<HTMLFormElement>(null);
  const [card, setCard] = useState<Card>({ phase: "loading" });
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    getZaloState(tenantId, controller.signal).then(
      (state) => !controller.signal.aborted && setCard({ phase: "ready", state }),
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        setCard(isForbidden(failure) ? { phase: "forbidden" } : { phase: "error", error: failure });
      },
    );
    return () => controller.abort();
  }, [tenantId, nonce]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const typed = token.trim();
    if (typed.length === 0 || typed.length > 200) {
      setTokenError(t("Nhập token bot Zalo.", "Enter the Zalo bot token."));
      formRef.current?.querySelector("input")?.focus();
      return;
    }
    setTokenError(null);
    setBusy(true);
    try {
      const state = await connectZalo(
        { tenantId, csrfToken },
        { botToken: typed, commandId: command.get() },
      );
      command.settle();
      setCard({ phase: "ready", state });
      setMessage(t("Đã gửi token và đăng ký webhook.", "Token sent and webhook registered."));
    } catch (failure) {
      command.settle(failure);
      setError(failure);
      setNonce((n) => n + 1); // outcome may be uncertain: show the real state
    } finally {
      setToken(""); // write-only: never keep the secret after the submit
      setBusy(false);
      setFocusKey((n) => n + 1);
    }
  }

  if (card.phase === "loading") return <Skeleton height="var(--space-12)" />;
  if (card.phase === "forbidden") {
    return (
      <p className={styles.caption}>
        {t(
          "Bạn không có quyền quản lý kết nối Zalo của câu lạc bộ này.",
          "You are not allowed to manage this club's Zalo connection.",
        )}
      </p>
    );
  }
  if (card.phase === "error") {
    return (
      <FormFeedback
        focusKey={0}
        error={card.error}
        onRetry={() => setNonce((n) => n + 1)}
        onReload={() => setNonce((n) => n + 1)}
      />
    );
  }

  const { state } = card;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "vi-VN") : null;
  return (
    <div className={styles.stack}>
      <div className={styles.itemMain}>
        <div className={styles.badges}>
          <Badge tone={TONE[state.status]}>{statusLabel(state.status, t)}</Badge>
        </div>
        {when(state.verifiedAt) ? (
          <span className={styles.caption}>
            {t("Xác minh lúc", "Verified at")} {when(state.verifiedAt)}
          </span>
        ) : null}
        {when(state.lastSetwebhookAt) ? (
          <span className={styles.caption}>
            {t("Đăng ký webhook lúc", "Webhook registered at")} {when(state.lastSetwebhookAt)}
          </span>
        ) : null}
        {state.webhookUrl ? <code className={styles.mono}>{state.webhookUrl}</code> : null}
      </div>
      <form ref={formRef} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
        <TextField
          label={t("Token bot Zalo", "Zalo bot token")}
          hint={t(
            "Chỉ nhập để kết nối hoặc đổi bot. Token không bao giờ được hiển thị lại.",
            "Enter it only to connect or change the bot. The token is never shown again.",
          )}
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={token}
          error={tokenError}
          onChange={(e) => {
            setToken(e.target.value);
            setTokenError(null);
            command.reset(); // a newly typed token is a new command
          }}
        />
        <FormFeedback
          focusKey={focusKey}
          error={error}
          message={message}
          onRetry={() => formRef.current?.requestSubmit()}
        />
        <div className={styles.actions}>
          <Button type="submit" disabled={busy || !online} aria-busy={busy ? true : undefined}>
            {busy
              ? t("Đang kết nối…", "Connecting…")
              : state.status === "not_connected"
                ? t("Kết nối Zalo", "Connect Zalo")
                : t("Kết nối lại", "Reconnect")}
          </Button>
        </div>
      </form>
    </div>
  );
}
