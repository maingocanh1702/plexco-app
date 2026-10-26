"use client";

import { useRef, useState } from "react";
import { ApiClientError } from "../../lib/api-client";
import { useT } from "../../lib/i18n-client";
import { leaveMySession } from "../../lib/me-player-api";
import { describePlayerError } from "../../lib/session-error-ui";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { useSessionContext } from "../../lib/use-session";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import { Button } from "../ui/button";

/** Leave control steps: one tap arms it, Confirm sends; nothing is sent before Confirm. */
export type LeavePhase =
  { step: "idle" } | { step: "confirm" } | { step: "pending" } | { step: "failed"; error: unknown };

type Handlers = Record<"onStart" | "onConfirm" | "onDismiss" | "onReload", () => void>;

export function PlayerLeaveSessionView(props: { phase: LeavePhase; online: boolean } & Handlers) {
  const { phase, online, onStart, onConfirm, onDismiss, onReload } = props;
  const t = useT();
  if (phase.step === "idle") {
    return (
      <Button variant="secondary" onClick={onStart} disabled={!online}>
        {t("Rời buổi", "Leave session")}
      </Button>
    );
  }
  if (phase.step === "failed") {
    // The server refuses this self-leave (P-4: ask the host); it is final, so no retry control.
    if (phase.error instanceof ApiClientError && phase.error.code === "LEAVE_REQUIRES_HOST") {
      return (
        <p role="alert">
          {t(
            "Bạn không thể tự rời buổi này, hãy nhờ chủ kèo.",
            "You cannot leave this session yourself; ask the host.",
          )}
        </p>
      );
    }
    return (
      <ApiErrorNotice
        error={phase.error}
        describe={describePlayerError}
        onRetry={onConfirm}
        onReload={onReload}
      />
    );
  }
  const pending = phase.step === "pending";
  return (
    <div>
      <p>{t("Rời buổi này?", "Leave this session?")}</p>
      <Button onClick={onConfirm} disabled={pending || !online} aria-busy={pending || undefined}>
        {pending ? t("Đang rời…", "Leaving…") : t("Xác nhận", "Confirm")}
      </Button>
      <Button variant="ghost" onClick={onDismiss} disabled={pending}>
        {t("Ở lại", "Stay")}
      </Button>
    </div>
  );
}

/** One command id per intent through the shared keeper (JoinPanel's pattern): kept once an attempt's outcome is uncertain, so Retry then replays it. */
export function PlayerLeaveSessionButton(props: {
  sessionId: string;
  tenantId: string;
  onLeft: () => void;
  onReload: () => void;
}) {
  const { session } = useSessionContext(); // the /me frame's one session read for the whole list
  const keeper = useCommandId();
  const online = useOnlineStatus();
  const [phase, setPhase] = useState<LeavePhase>({ step: "idle" });
  const inFlight = useRef(false);

  async function leave() {
    if (inFlight.current || !session || !online) return;
    inFlight.current = true;
    setPhase({ step: "pending" });
    try {
      await leaveMySession(props.sessionId, props.tenantId, {
        commandId: keeper.get(),
        csrfToken: session.csrfToken,
      });
      keeper.settle();
      props.onLeft();
    } catch (error) {
      keeper.settle(error);
      setPhase({ step: "failed", error });
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <PlayerLeaveSessionView
      phase={phase}
      online={online}
      onStart={() => setPhase({ step: "confirm" })}
      onConfirm={() => void leave()}
      onDismiss={() => setPhase({ step: "idle" })}
      onReload={props.onReload}
    />
  );
}
