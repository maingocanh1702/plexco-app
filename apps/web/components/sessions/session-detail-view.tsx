"use client";

import { useEffect, useRef, useState } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import type { SessionAction } from "../../lib/session-actions";
import { isDefiniteFailure } from "../../lib/session-error-ui";
import { formatSessionRange } from "../../lib/session-time";
import { transitionSession, type SessionTransition } from "../../lib/sessions-api";
import { useSessionDetail } from "../../lib/use-sessions-data";
import { useTenantContext } from "../../lib/use-tenant-context";
import { Button } from "../ui/button";
import { ConfirmDialog } from "../ui/confirm-dialog";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { Tabs } from "../ui/tabs";
import { Toast } from "../ui/toast";
import { ApiErrorNotice } from "./api-error-notice";
import { DetailsTab } from "./details-tab";
import { RosterTab } from "./roster-tab";
import { SessionActionBar } from "./session-action-bar";
import { SessionStatusBadge } from "./session-status-badge";
import styles from "./session-detail-view.module.css";

/** /sessions/[id]: header, status-driven action bar (confirm dialogs), Roster | Details tabs. */
export function SessionDetailView({
  tenantId,
  sessionId,
}: {
  tenantId: string;
  sessionId: string;
}) {
  const t = useT();
  const lang = useLang();
  const ctx = useTenantContext(tenantId);
  const { state, reload, refresh } = useSessionDetail(tenantId, sessionId);
  const [tab, setTab] = useState("roster");
  const [pending, setPending] = useState<SessionTransition | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<unknown>(null);
  const [done, setDone] = useState<string | null>(null);
  // One idempotency key per confirm attempt; kept across an uncertain failure, dropped on a definite one.
  const commandId = useRef<string | null>(null);
  // Bumped after a successful transition: the opener button may be gone (status changed), so focus
  // moves to the heading once the dialog has closed (child effects run first, then this one).
  const [focusHeading, setFocusHeading] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (focusHeading > 0) headingRef.current?.focus();
  }, [focusHeading]);
  const base = `/c/${tenantId}/sessions`;

  if (state.status === "loading") {
    return (
      <div className={styles.page} aria-busy="true">
        <h1 className="sr-only">{t("Chi tiết buổi chơi", "Session details")}</h1>
        <Spinner />
        <Skeleton width="50%" height="var(--space-8)" />
        <Skeleton width="70%" />
        <Skeleton height="var(--space-12)" />
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={styles.page}>
        <h1 className="sr-only">{t("Chi tiết buổi chơi", "Session details")}</h1>
        <ApiErrorNotice error={state.error} onRetry={reload} onReload={reload} />
        <Button href={base} variant="secondary">
          {t("Về danh sách", "Back to list")}
        </Button>
      </div>
    );
  }

  const session = state.data;
  const copy: Record<
    SessionTransition,
    { title: string; body: string; confirm: string; done: string; danger?: boolean }
  > = {
    publish: {
      title: t("Đăng kèo này?", "Publish this session?"),
      body: t(
        "Buổi sẽ chuyển sang Đang mở và người chơi có thể tham gia.",
        "The session becomes Open and players can join.",
      ),
      confirm: t("Đăng kèo", "Publish"),
      done: t("Đã đăng kèo.", "Session published."),
    },
    close: {
      title: t("Đóng buổi này?", "Close this session?"),
      body: t(
        "Buổi sẽ chuyển sang Đã đóng và không thể sửa nữa.",
        "The session becomes Closed and can no longer be edited.",
      ),
      confirm: t("Đóng buổi", "Close session"),
      done: t("Đã đóng buổi.", "Session closed."),
    },
    cancel: {
      title:
        session.status === "draft"
          ? t("Huỷ bản nháp này?", "Discard this draft?")
          : t("Huỷ buổi này?", "Cancel this session?"),
      body: t(
        "Buổi sẽ chuyển sang Đã huỷ và không thể hoàn tác. Nếu đã có người chơi hoặc khoản thu, hệ thống sẽ yêu cầu xem xét trước.",
        "The session becomes Cancelled and this cannot be undone. If it already has players or charges, it must be reviewed first.",
      ),
      confirm:
        session.status === "draft"
          ? t("Huỷ nháp", "Discard draft")
          : t("Huỷ buổi", "Cancel session"),
      done:
        session.status === "draft"
          ? t("Đã huỷ bản nháp.", "Draft cancelled.")
          : t("Đã huỷ buổi.", "Session cancelled."),
      danger: true,
    },
  };

  function closeDialog() {
    if (busy) return;
    setPending(null);
    setActionError(null);
    commandId.current = null;
  }

  async function confirm() {
    if (!pending || busy) return;
    commandId.current ??= crypto.randomUUID();
    setBusy(true);
    setActionError(null);
    try {
      await transitionSession(ctx, session.id, pending, {
        commandId: commandId.current,
        expectedVersion: session.version,
      });
      setDone(copy[pending].done);
      setPending(null);
      setFocusHeading((n) => n + 1);
      commandId.current = null;
      refresh();
    } catch (error) {
      if (isDefiniteFailure(error)) commandId.current = null;
      setActionError(error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 ref={headingRef} tabIndex={-1}>
            {session.sportName}
          </h1>
          <p className={styles.when}>
            {formatSessionRange(session.startsAt, session.endsAt, session.timezone, lang)}
          </p>
        </div>
        <div className={styles.headMeta}>
          <SessionStatusBadge status={session.status} />
          <span className={styles.version}>
            {t(`Phiên bản ${session.version}`, `Version ${session.version}`)}
          </span>
        </div>
      </header>

      <SessionActionBar
        session={session}
        editHref={`${base}/${session.id}/edit`}
        onAction={(action: Exclude<SessionAction, "edit">) => {
          setActionError(null);
          commandId.current = null;
          setPending(action);
        }}
      />
      {pending === null && actionError ? (
        // A failure must never be swallowed by a dialog that is no longer on screen.
        <ApiErrorNotice error={actionError} onReload={refresh} />
      ) : null}

      <Tabs
        label={t("Nội dung buổi chơi", "Session content")}
        active={tab}
        onChange={setTab}
        items={[
          {
            id: "roster",
            label: t("Người chơi", "Roster"),
            panel: <RosterTab session={session} />,
          },
          {
            id: "details",
            label: t("Chi tiết", "Details"),
            panel: <DetailsTab session={session} />,
          },
        ]}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pending ? copy[pending].title : ""}
        body={pending ? copy[pending].body : null}
        confirmLabel={pending ? copy[pending].confirm : ""}
        danger={pending ? copy[pending].danger : false}
        busy={busy}
        error={
          actionError ? (
            <ApiErrorNotice
              error={actionError}
              onRetry={() => void confirm()}
              onReload={() => {
                closeDialog();
                refresh();
              }}
            />
          ) : null
        }
        onConfirm={() => void confirm()}
        onCancel={closeDialog}
      />

      {done ? <Toast message={done} onDismiss={() => setDone(null)} /> : null}
    </div>
  );
}
