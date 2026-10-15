"use client";

import { useId } from "react";
import { useT } from "../../lib/i18n-client";
import { allowedActions, blockedReason, type SessionAction } from "../../lib/session-actions";
import type { SessionDetailDto } from "../../lib/sessions-api";
import { Button } from "../ui/button";
import styles from "./session-detail-view.module.css";

/** Buttons by status (draft: edit/publish/discard; open: edit/close/cancel; terminal: none). */
export function SessionActionBar({
  session,
  editHref,
  onAction,
}: {
  session: SessionDetailDto;
  editHref: string;
  onAction: (action: Exclude<SessionAction, "edit">) => void;
}) {
  const t = useT();
  const uid = useId();
  const editId = `${uid}-edit-blocked`;
  const publishId = `${uid}-publish-blocked`;
  const cancelId = `${uid}-cancel-blocked`;
  const actions = allowedActions(session.status);
  if (actions.length === 0) {
    return (
      <p className={styles.viewOnly}>{t("Buổi này chỉ để xem.", "This session is view-only.")}</p>
    );
  }
  const now = Date.now();
  const editBlocked = blockedReason("edit", session, now);
  const publishBlocked = blockedReason("publish", session, now);
  const cancelBlocked = blockedReason("cancel", session, now);
  return (
    <div className={styles.actions}>
      {actions.includes("edit") ? (
        editBlocked ? (
          <Button variant="secondary" disabled aria-describedby={editId}>
            {t("Sửa", "Edit")}
          </Button>
        ) : (
          <Button variant="secondary" href={editHref}>
            {t("Sửa", "Edit")}
          </Button>
        )
      ) : null}
      {actions.includes("publish") ? (
        <Button
          disabled={publishBlocked !== null}
          aria-describedby={publishBlocked ? publishId : undefined}
          onClick={() => onAction("publish")}
        >
          {t("Đăng kèo", "Publish")}
        </Button>
      ) : null}
      {actions.includes("close") ? (
        <Button onClick={() => onAction("close")}>{t("Đóng buổi", "Close")}</Button>
      ) : null}
      {actions.includes("cancel") ? (
        <Button
          variant="secondary"
          disabled={cancelBlocked !== null}
          aria-describedby={cancelBlocked ? cancelId : undefined}
          onClick={() => onAction("cancel")}
        >
          {session.status === "draft"
            ? t("Huỷ nháp", "Discard draft")
            : t("Huỷ buổi", "Cancel session")}
        </Button>
      ) : null}
      {editBlocked ? (
        <p id={editId} className={styles.viewOnly}>
          {t(
            "Buổi đã bắt đầu nên không sửa được nữa.",
            "The session has started, so it can no longer be edited.",
          )}
        </p>
      ) : null}
      {publishBlocked ? (
        <p id={publishId} className={styles.viewOnly}>
          {t(
            "Buổi đã qua giờ bắt đầu — sửa giờ trước khi đăng",
            "Start time has passed — change it before publishing",
          )}
        </p>
      ) : null}
      {cancelBlocked ? (
        <p id={cancelId} className={styles.viewOnly}>
          {t(
            "Buổi đã bắt đầu nên không huỷ được — hãy đóng buổi.",
            "The session has started, so it can no longer be cancelled — close it instead.",
          )}
        </p>
      ) : null}
    </div>
  );
}
