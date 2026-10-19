"use client";

import { useRef, useState } from "react";
import { joinPublicListing, type PublicJoinResult } from "../../lib/discover-api";
import { useT } from "../../lib/i18n-client";
import { describePlayerError } from "../../lib/session-error-ui";
import { useCommandId } from "../../lib/use-command-id";
import { useOnlineStatus } from "../../lib/use-online-status";
import { useSession } from "../../lib/use-session";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { ApiErrorNotice } from "./api-error-notice";
import styles from "./join-panel.module.css";

/** What the session read allows (P-3): the join button, a sign-in prompt, the web-app note, an error. */
export type JoinAccess = "loading" | "ready" | "signed-out" | "web-only" | { error: unknown };

export type JoinPhase =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "done"; result: PublicJoinResult }
  | { kind: "failed"; error: unknown };

/** Where a failure sends the player next, besides the notice's own retry or reload (R3). */
const NEXT_STEP = new Map([
  ["NOT_FOUND", "/discover"],
  ["SESSION_NOT_FOUND", "/discover"],
  ["ALREADY_JOINED", "/me/sessions"],
]);

/** S-3 as a pure function of its props, so a view test can render every state. */
export function JoinPanelView({
  access,
  phase,
  online,
  onJoin,
  onRetrySession,
  onReload,
}: {
  access: JoinAccess;
  phase: JoinPhase;
  online: boolean;
  onJoin: () => void;
  onRetrySession: () => void;
  onReload: () => void;
}) {
  const t = useT();
  const step = (href: string) => (
    <Button href={href} variant="secondary">
      {href === "/discover"
        ? t("Xem các kèo khác", "Browse other games")
        : t("Xem buổi của tôi", "View my sessions")}
    </Button>
  );

  if (access === "loading") {
    return (
      <div className={styles.panel} aria-busy="true" data-state="loading">
        <Skeleton width="40%" height="var(--touch-target)" />
      </div>
    );
  }
  if (access === "signed-out") {
    return (
      <div className={styles.panel} data-state="ready">
        <Button href="/">{t("Đăng nhập để tham gia.", "Sign in to join.")}</Button>
      </div>
    );
  }
  if (access === "web-only") {
    return (
      <p className={styles.hint} data-state="ready">
        {t("Tham gia trên ứng dụng web Plexco.", "Join on the Plexco web app.")}
      </p>
    );
  }
  if (typeof access === "object") {
    return (
      <div className={styles.panel} data-state="error">
        <ApiErrorNotice
          error={access.error}
          describe={describePlayerError}
          onRetry={onRetrySession}
          onReload={onRetrySession}
        />
      </div>
    );
  }

  if (phase.kind === "done") {
    const { outcome, waitlistPosition } = phase.result;
    const result =
      outcome === "active"
        ? t("Bạn đã có chỗ trong buổi này.", "You are in this session.")
        : outcome === "waitlisted"
          ? `${t("Bạn đang trong danh sách chờ", "You are on the waitlist")}${waitlistPosition === null ? "" : ` #${waitlistPosition}`}`
          : outcome === "requested"
            ? t(
                "Đã gửi yêu cầu. Chờ chủ buổi duyệt.",
                "Request sent. Waiting for the host to approve.",
              )
            : null;
    return (
      <div className={styles.panel} data-state="ready">
        {result ? (
          <p role="status" className={styles.result}>
            {result}
          </p>
        ) : null}
        {step("/me/sessions")}
      </div>
    );
  }

  const pending = phase.kind === "pending";
  const failure = phase.kind === "failed" ? describePlayerError(phase.error, t) : null;
  const next = failure ? NEXT_STEP.get(failure.code) : undefined;
  // A mapped action of none (R 4.5.2 S-3) leaves nothing to press again: no Join button.
  const canJoin = failure?.action !== "none";
  const dataState = pending ? "loading" : failure ? "error" : online ? "ready" : "offline";
  return (
    <div className={styles.panel} data-state={dataState}>
      {phase.kind === "failed" ? (
        <ApiErrorNotice
          error={phase.error}
          describe={describePlayerError}
          onRetry={onJoin}
          onReload={onReload}
        >
          {next ? step(next) : null}
        </ApiErrorNotice>
      ) : null}
      {canJoin ? (
        <>
          <Button onClick={onJoin} disabled={pending || !online} aria-busy={pending || undefined}>
            {pending ? t("Đang gửi…", "Joining…") : t("Tham gia", "Join")}
          </Button>
          {online ? null : (
            <p role="status" className={styles.hint}>
              {t(
                "Bạn đang offline. Kết nối lại để tham gia.",
                "You are offline. Reconnect to join.",
              )}
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

/**
 * S-3 container: the public join only (P-3). One command id per intent through the shared keeper
 * (P-11): minted when the tap starts, kept across an uncertain failure so a retry replays, dropped
 * on success or a definite 4xx. The ref also stops a second tap before the first one settles.
 */
export function JoinPanel({
  publicListingId,
  onReload,
}: {
  publicListingId: string;
  onReload: () => void;
}) {
  const { state, session, refresh } = useSession();
  const keeper = useCommandId();
  const online = useOnlineStatus();
  const [phase, setPhase] = useState<JoinPhase>({ kind: "idle" });
  const inFlight = useRef(false);

  async function join() {
    if (inFlight.current || !session || !online) return;
    inFlight.current = true;
    setPhase({ kind: "pending" });
    try {
      const result = await joinPublicListing(publicListingId, {
        commandId: keeper.get(),
        csrfToken: session.csrfToken,
      });
      keeper.settle();
      setPhase({ kind: "done", result });
    } catch (error) {
      keeper.settle(error);
      setPhase({ kind: "failed", error });
    } finally {
      inFlight.current = false;
    }
  }

  // The discovery role answers the session read with 404 (neither it nor the POST is served there).
  const access: JoinAccess =
    state.status === "ready"
      ? "ready"
      : state.status === "error"
        ? state.error.statusCode === 404
          ? "web-only"
          : { error: state.error }
        : state.status;
  return (
    <JoinPanelView
      access={access}
      phase={phase}
      online={online}
      onJoin={() => void join()}
      onRetrySession={() => void refresh()}
      onReload={onReload}
    />
  );
}
