"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { connectZalo, getZaloState, type ZaloStateDto } from "../../lib/club-settings-client";
import { useLang, useT } from "../../lib/i18n-client";
import { describeSettingsError, isForbidden } from "../../lib/settings-error-ui";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { useSessionContext } from "../../lib/use-session";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { TextField } from "../ui/text-field";
import { FormFeedback } from "./form-feedback";
import {
  connectOutcome,
  reloadedNote,
  revokedNote,
  statusLabel,
  statusTone,
} from "./zalo-connect-status";
import styles from "./settings-layout.module.css";

/** Same bound as POST /api/onboarding/zalo/connect (botToken 1..200 characters). */
const TOKEN_MAX = 200;

type Card =
  | { phase: "loading" }
  | { phase: "forbidden" }
  | { phase: "error"; error: unknown }
  | { phase: "ready"; state: ZaloStateDto };

/**
 * Zalo bot connect card. Authority is connector.secret_manage (owner; an admin only with an
 * explicit grant), enforced by the routes: a 403 renders ONE uniform "not permitted" note. A
 * revoked bot is terminal (0053 refuses every later connect for the club, the route answers
 * ZALO_TOKEN_INVALID 400), so the card shows that status and why it cannot be reconnected, with no
 * form; the revoked note comes from the refetched state, not from that answer.
 *
 * The bot token is write-only and never persisted: it lives only in this component's state (no
 * storage, URL, log, DTO or error object), goes out in the POST body and is never rendered back.
 * It is cleared after any 200, after a non-retryable failure (a wrong token, a refusal, a conflict)
 * and when the card turns "not permitted" or "revoked"; React drops it with the component on
 * unmount. After a RETRYABLE failure (network, 5xx, AUTH_UNAVAILABLE, rate limit) it stays in the
 * field so "Try again" resends the same token. Its commandId follows use-command-id.ts: kept after
 * an uncertain failure, and still kept through a later 4xx (a 429 included) once an attempt was
 * uncertain, so the route replays a connect that may have landed instead of connecting twice. A 429
 * on a first attempt proves nothing was applied, so that retry may use a fresh key. A newly typed
 * token is a new command.
 *
 * Focus: whatever replaces the content after the user acted (a connect, a retry, a reload) takes
 * focus, because the control they used is gone: the form's outcome region, or the error, "not
 * permitted" or "revoked" note that replaced the form. A reload the user asked for is announced
 * when it lands. On first paint nothing takes focus.
 */
export function ZaloConnectCard({ tenantId, csrfToken }: { tenantId: string; csrfToken: string }) {
  const t = useT();
  const lang = useLang();
  const online = useOnlineStatus();
  const command = useCommandId();
  const { refresh: refreshSession } = useSessionContext();
  const formRef = useRef<HTMLFormElement>(null);
  const [card, setCard] = useState<Card>({ phase: "loading" });
  const [token, setToken] = useState("");
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [outcome, setOutcome] = useState<{ message: string; tone: "success" | "warning" } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const [nonce, setNonce] = useState(0);
  /** The pending refetch was asked for by the user (a retry / reload button): announce it. */
  const userReload = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    getZaloState(tenantId, controller.signal).then(
      (state) => {
        if (controller.signal.aborted) return;
        if (state.status === "revoked") {
          // Terminal: no form will come back, so no secret or key is kept for it.
          setToken("");
          command.reset();
        }
        setCard({ phase: "ready", state });
        if (userReload.current) {
          userReload.current = false;
          setOutcome({ message: reloadedNote(t), tone: "success" });
          setFocusKey((n) => n + 1);
        }
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        if (isForbidden(failure)) {
          // Final for this page: no form will come back, so no secret or key is kept for it.
          setToken("");
          command.reset();
          setCard({ phase: "forbidden" });
        } else {
          setCard({ phase: "error", error: failure }); // retryable: the form returns as it was
        }
        if (userReload.current) {
          userReload.current = false;
          setFocusKey((n) => n + 1); // the note answering the retry takes focus (again)
        }
      },
    );
    return () => controller.abort();
    // `t` only words the reload note; a language switch does not refetch.
  }, [tenantId, nonce, command]);

  function reload() {
    setError(null);
    setOutcome(null);
    userReload.current = true;
    setNonce((n) => n + 1);
    // The session holds the csrfToken: after a CSRF_INVALID the next connect needs a fresh one.
    void refreshSession();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    userReload.current = false; // this attempt's outcome is what the user waits for now
    setError(null);
    setOutcome(null);
    const typed = token.trim();
    if (typed.length === 0 || typed.length > TOKEN_MAX) {
      setTokenError(
        typed.length === 0
          ? t("Nhập token bot Zalo.", "Enter the Zalo bot token.")
          : t("Token tối đa 200 ký tự.", "The token is at most 200 characters."),
      );
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
      setToken(""); // the server holds it now, whatever status it answered
      setCard({ phase: "ready", state });
      setOutcome(connectOutcome(state.status, t));
    } catch (failure) {
      command.settle(failure);
      if (describeSettingsError(failure, t).action !== "retry") setToken("");
      setError(failure);
      setNonce((n) => n + 1); // outcome may be uncertain: show the real state
    } finally {
      setBusy(false);
      setFocusKey((n) => n + 1);
    }
  }

  // The notes below replace the form: after a connect / retry (focusKey > 0) the one that appears
  // takes focus on mount, because the focused control went away with the form.
  if (card.phase === "loading") return <Skeleton height="var(--space-12)" />;
  if (card.phase === "forbidden") {
    return (
      <FormFeedback
        focusKey={focusKey}
        tone="warning"
        message={t(
          "Bạn không có quyền quản lý kết nối Zalo của câu lạc bộ này.",
          "You are not allowed to manage this club's Zalo connection.",
        )}
      />
    );
  }
  if (card.phase === "error") {
    return (
      <FormFeedback focusKey={focusKey} error={card.error} onRetry={reload} onReload={reload} />
    );
  }

  const { state } = card;
  const when = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString(lang === "en" ? "en-GB" : "vi-VN") : null;
  return (
    <div className={styles.stack}>
      <div className={styles.itemMain}>
        <div className={styles.badges}>
          <Badge tone={statusTone(state.status)}>{statusLabel(state.status, t)}</Badge>
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
      {state.status === "revoked" ? (
        <FormFeedback focusKey={focusKey} tone="warning" message={revokedNote(t)} />
      ) : (
        <form ref={formRef} className={styles.form} onSubmit={(e) => void submit(e)} noValidate>
          <TextField
            label={t("Token bot Zalo", "Zalo bot token")}
            hint={t(
              "Chỉ nhập để kết nối hoặc đổi bot. Token không bao giờ được hiển thị lại.",
              "Enter it only to connect or change the bot. The token is never shown again.",
            )}
            type="password"
            // Browsers ignore autocomplete="off" on a password field and offer to save it. Chromium's
            // password manager treats a "one-time-code" field as not-a-password (never offered for
            // saving, never filled); the data-* opt-outs cover the 1Password / LastPass / Bitwarden
            // extensions.
            autoComplete="one-time-code"
            data-1p-ignore="true"
            data-lpignore="true"
            data-bwignore="true"
            autoCapitalize="none"
            autoCorrect="off"
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
            message={outcome?.message ?? null}
            tone={outcome?.tone}
            onRetry={() => formRef.current?.requestSubmit()}
            onReload={reload}
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
      )}
    </div>
  );
}
