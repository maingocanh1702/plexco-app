"use client";

import { useEffect, useState } from "react";
import { listDiscovery, type DiscoveryFilter, type DiscoveryListing } from "../../lib/discover-api";
import { useT } from "../../lib/i18n-client";
import { describePlayerError } from "../../lib/session-error-ui";
import { useOnlineStatus } from "../../lib/use-online-status";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { TextField } from "../ui/text-field";
import { DiscoverFrame, OfflineNotice, isOffline } from "./discover-frame";
import { ListingSkeleton, ListingSummary } from "./listing-summary";
import styles from "./discover.module.css";

export type DiscoverListState =
  | { status: "loading" }
  | { status: "ready"; items: DiscoveryListing[]; nextCursor: string | null }
  | { status: "error"; error: unknown }
  | { status: "offline" };

export interface FilterDraft {
  area: string;
  availableOnly: boolean;
}
export const EMPTY_FILTER: FilterDraft = { area: "", availableOnly: false };

interface LoadMore {
  busy: boolean;
  error: unknown;
}
const IDLE: LoadMore = { busy: false, error: null };

/** S-1 as a pure function of its props, so a view test can render every state (P-19). */
export function DiscoverListView({
  state,
  draft,
  onDraft,
  onApply,
  onReset,
  onRetry,
  more,
  onLoadMore,
}: {
  state: DiscoverListState;
  draft: FilterDraft;
  onDraft: (next: FilterDraft) => void;
  onApply: () => void;
  onReset: () => void;
  onRetry: () => void;
  more: LoadMore;
  onLoadMore: () => void;
}) {
  const t = useT();
  const empty = state.status === "ready" && state.items.length === 0;
  const reset = (
    <Button variant="secondary" onClick={onReset}>
      {t("Đặt lại bộ lọc", "Reset filters")}
    </Button>
  );
  return (
    <main className={styles.page} data-state={empty ? "empty" : state.status}>
      <h1 className={styles.heading}>{t("Tìm kèo chơi", "Find a game")}</h1>
      <form
        className={styles.filters}
        onSubmit={(event) => {
          event.preventDefault();
          onApply();
        }}
      >
        <TextField
          label={t("Khu vực", "Area")}
          value={draft.area}
          onChange={(event) => onDraft({ ...draft, area: event.target.value })}
        />
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={draft.availableOnly}
            onChange={(event) => onDraft({ ...draft, availableOnly: event.target.checked })}
          />
          {t("Chỉ kèo còn chỗ", "Open spots only")}
        </label>
        <Button type="submit">{t("Lọc", "Filter")}</Button>
        {reset}
      </form>

      {state.status === "loading" ? (
        <div className={styles.list} aria-busy="true">
          {[0, 1, 2].map((i) => (
            <ListingSkeleton key={i} />
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <ApiErrorNotice
          error={state.error}
          describe={describePlayerError}
          onRetry={onRetry}
          onReload={onRetry}
        />
      ) : null}

      {state.status === "offline" ? (
        <OfflineNotice
          message={t(
            "Bạn đang offline. Chưa tải được danh sách kèo.",
            "You are offline. The listings could not be loaded.",
          )}
          onRetry={onRetry}
        />
      ) : null}

      {empty ? (
        <EmptyState
          title={t("Không có kèo phù hợp", "No games match")}
          body={t("Thử đổi hoặc bỏ bộ lọc.", "Try changing or clearing the filters.")}
          action={reset}
        />
      ) : null}

      {state.status === "ready" && !empty ? (
        <ul className={styles.list}>
          {state.items.map((listing) => (
            <li key={listing.publicListingId}>
              <Card className={styles.card}>
                <ListingSummary listing={listing} />
                <Button
                  href={`/discover/${encodeURIComponent(listing.publicListingId)}`}
                  variant="secondary"
                >
                  {t("Xem chi tiết", "View details")}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {state.status === "ready" && state.nextCursor !== null ? (
        <div className={styles.more}>
          {more.error ? (
            <ApiErrorNotice
              error={more.error}
              describe={describePlayerError}
              onRetry={onLoadMore}
            />
          ) : null}
          <Button
            variant="secondary"
            onClick={onLoadMore}
            disabled={more.busy}
            aria-busy={more.busy || undefined}
          >
            {more.busy ? t("Đang tải…", "Loading…") : t("Tải thêm", "Load more")}
          </Button>
        </div>
      ) : null}
    </main>
  );
}

/** S-1 container: fetches /api/discover client-side (P-17) and hands plain state to the view. */
export function DiscoverList() {
  const online = useOnlineStatus();
  const [draft, setDraft] = useState(EMPTY_FILTER);
  const [filter, setFilter] = useState<DiscoveryFilter>({});
  const [state, setState] = useState<DiscoverListState>({ status: "loading" });
  const [more, setMore] = useState(IDLE);

  useEffect(() => {
    let current = true; // a slower, older search never overwrites a newer one
    listDiscovery(filter).then(
      (page) => {
        if (current) setState({ status: "ready", items: page.items, nextCursor: page.nextCursor });
      },
      (error: unknown) => {
        if (current) setState({ status: "error", error });
      },
    );
    return () => {
      current = false;
    };
  }, [filter]);

  // A fresh filter object every time, so Retry and Reset refetch even when nothing changed.
  const start = (next: DiscoveryFilter) => {
    setState({ status: "loading" });
    setMore(IDLE);
    setFilter(next);
  };

  const loadMore = () => {
    if (state.status !== "ready" || state.nextCursor === null || more.busy) return;
    const cursor = state.nextCursor;
    setMore({ busy: true, error: null });
    listDiscovery({ ...filter, cursor }).then(
      (page) => {
        // Dropped when a newer search replaced the list while this page was in flight.
        setState((s) =>
          s.status === "ready" && s.nextCursor === cursor
            ? { status: "ready", items: [...s.items, ...page.items], nextCursor: page.nextCursor }
            : s,
        );
        setMore(IDLE);
      },
      (error: unknown) => setMore({ busy: false, error }),
    );
  };

  const shown: DiscoverListState =
    state.status === "error" && isOffline(state.error, online) ? { status: "offline" } : state;
  return (
    <DiscoverFrame>
      <DiscoverListView
        state={shown}
        draft={draft}
        onDraft={setDraft}
        onApply={() => start({ area: draft.area.trim(), availableOnly: draft.availableOnly })}
        onReset={() => {
          setDraft(EMPTY_FILTER);
          start({});
        }}
        onRetry={() => start({ ...filter })}
        more={more}
        onLoadMore={loadMore}
      />
    </DiscoverFrame>
  );
}
