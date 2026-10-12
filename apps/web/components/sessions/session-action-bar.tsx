"use client";

import { useT } from "../../lib/i18n-client";
import { allowedActions, editBlockedReason, type SessionAction } from "../../lib/session-actions";
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
  const actions = allowedActions(session.status);
  if (actions.length === 0) {
    return (
      <p className={styles.viewOnly}>{t("Buổi này chỉ để xem.", "This session is view-only.")}</p>
    );
  }
  const editBlocked = editBlockedReason(session, Date.now());
  return (
    <div className={styles.actions}>
      {actions.includes("edit") ? (
        editBlocked ? (
          <Button variant="secondary" disabled aria-describedby="edit-blocked">
            {t("Sửa", "Edit")}
          </Button>
        ) : (
          <Button variant="secondary" href={editHref}>
            {t("Sửa", "Edit")}
          </Button>
        )
      ) : null}
      {actions.includes("publish") ? (
        <Button onClick={() => onAction("publish")}>{t("Đăng kèo", "Publish")}</Button>
      ) : null}
      {actions.includes("close") ? (
        <Button onClick={() => onAction("close")}>{t("Đóng buổi", "Close")}</Button>
      ) : null}
      {actions.includes("cancel") ? (
        <Button variant="secondary" onClick={() => onAction("cancel")}>
          {session.status === "draft"
            ? t("Huỷ nháp", "Discard draft")
            : t("Huỷ buổi", "Cancel session")}
        </Button>
      ) : null}
      {editBlocked ? (
        <p id="edit-blocked" className={styles.viewOnly}>
          {t(
            "Buổi đã bắt đầu nên không sửa được nữa.",
            "The session has started, so it can no longer be edited.",
          )}
        </p>
      ) : null}
    </div>
  );
}
