"use client";

import { useState } from "react";
import { useLang, useT } from "../../lib/i18n-client";
import { LIST_TABS, type ListTab } from "../../lib/session-list-streams";
import { useSessionList } from "../../lib/use-sessions-data";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { ApiErrorNotice } from "./api-error-notice";
import { SessionListCard } from "./session-card";
import styles from "./sessions-list-view.module.css";

/** Host session list: 4 filter tabs, cursor "load more", loading/empty/error/offline states. */
export function SessionsListView({ tenantId }: { tenantId: string }) {
  const t = useT();
  const lang = useLang();
  const [tab, setTab] = useState<ListTab>("all");
  const { state, loadMore, loadingMore, moreError, reload } = useSessionList(tenantId, tab, {
    live: true,
  });
  const base = `/c/${tenantId}/sessions`;

  const labels: Record<ListTab, string> = {
    all: t("Tất cả", "All"),
    upcoming: t("Sắp tới", "Upcoming"),
    draft: t("Nháp", "Drafts"),
    closed: t("Đã đóng", "Closed"),
  };
  const emptyCopy: Record<ListTab, [string, string]> = {
    all: [
      t("Chưa có buổi chơi nào", "No sessions yet"),
      t("Tạo buổi đầu tiên để mời người chơi.", "Create your first session to invite players."),
    ],
    upcoming: [
      t("Không có buổi sắp tới", "No upcoming sessions"),
      t("Đăng một buổi nháp hoặc tạo buổi mới.", "Publish a draft or create a new session."),
    ],
    draft: [
      t("Không có bản nháp", "No drafts"),
      t("Các buổi chưa đăng sẽ nằm ở đây.", "Sessions you have not published show up here."),
    ],
    closed: [
      t("Chưa có buổi nào đã đóng", "No closed sessions"),
      t("Buổi đã đóng hoặc đã huỷ sẽ nằm ở đây.", "Closed or cancelled sessions show up here."),
    ],
  };

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <h1>{t("Buổi chơi", "Sessions")}</h1>
        <Button href={`${base}/new`}>{t("+ Tạo buổi mới", "+ New session")}</Button>
      </div>

      <div role="group" aria-label={t("Lọc buổi chơi", "Filter sessions")} className={styles.tabs}>
        {LIST_TABS.map((id) => (
          <button
            key={id}
            type="button"
            className={styles.tab}
            aria-current={tab === id ? "true" : undefined}
            onClick={() => setTab(id)}
          >
            {labels[id]}
          </button>
        ))}
      </div>

      {state.status === "loading" ? (
        <div className={styles.list} aria-busy="true">
          <Spinner />
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.skeletonCard}>
              <Skeleton width="40%" height="var(--space-5)" />
              <Skeleton width="70%" />
              <Skeleton width="55%" />
            </div>
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <ApiErrorNotice error={state.error} onRetry={reload} onReload={reload} />
      ) : null}

      {state.status === "offline" ? (
        <p role="status" className={styles.offline}>
          {t(
            "Bạn đang offline — đang xem dữ liệu đã lưu lúc ",
            "You are offline — showing data saved at ",
          )}
          {new Intl.DateTimeFormat(lang === "en" ? "en-GB" : "vi-VN", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "2-digit",
          }).format(new Date(state.offlineSavedAt))}
          .{" "}
          <button type="button" className={styles.link} onClick={reload}>
            {t("Thử lại", "Try again")}
          </button>
        </p>
      ) : null}

      {state.status === "ready" || state.status === "offline" ? (
        state.sessions.length === 0 ? (
          <EmptyState
            title={emptyCopy[tab][0]}
            body={emptyCopy[tab][1]}
            action={<Button href={`${base}/new`}>{t("Tạo buổi mới", "Create a session")}</Button>}
          />
        ) : (
          <ul className={styles.list}>
            {state.sessions.map((session) => (
              <li key={session.id}>
                <SessionListCard session={session} tenantId={tenantId} />
              </li>
            ))}
          </ul>
        )
      ) : null}

      {state.status === "ready" && state.hasMore ? (
        <div className={styles.more}>
          {moreError ? <ApiErrorNotice error={moreError} onRetry={() => void loadMore()} /> : null}
          <Button variant="secondary" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? t("Đang tải…", "Loading…") : t("Tải thêm", "Load more")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
