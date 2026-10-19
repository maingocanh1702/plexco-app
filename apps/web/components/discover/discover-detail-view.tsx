"use client";

import { useEffect, useState, type ReactNode } from "react";
import { getDiscoveryListing, type DiscoveryListing } from "../../lib/discover-api";
import { useT } from "../../lib/i18n-client";
import { describePlayerError } from "../../lib/session-error-ui";
import { useOnlineStatus } from "../../lib/use-online-status";
import { ApiErrorNotice } from "../sessions/api-error-notice";
import { JoinPanel } from "../sessions/join-panel";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { DiscoverFrame, OfflineNotice, isOffline } from "./discover-frame";
import { ListingSkeleton, ListingSummary } from "./listing-summary";
import styles from "./discover.module.css";

export type DiscoverDetailState =
  | { status: "loading" }
  | { status: "ready"; listing: DiscoveryListing }
  | { status: "error"; error: unknown }
  | { status: "offline" };

/** S-2 as a pure function of its props; `children` is the join panel (S-3), shown with a listing. */
export function DiscoverDetailView({
  state,
  onRetry,
  children,
}: {
  state: DiscoverDetailState;
  onRetry: () => void;
  children?: ReactNode;
}) {
  const t = useT();
  const failure = state.status === "error" ? describePlayerError(state.error, t) : null;
  const notFound = failure?.code === "NOT_FOUND";
  return (
    <main className={styles.page} data-state={notFound ? "empty" : state.status}>
      <Button href="/discover" variant="ghost">
        {t("Tất cả kèo", "All games")}
      </Button>

      {state.status === "loading" ? (
        <div aria-busy="true">
          <ListingSkeleton />
        </div>
      ) : null}

      {state.status === "ready" ? (
        <Card className={styles.card}>
          <ListingSummary listing={state.listing} as="h1" />
          {children}
        </Card>
      ) : null}

      {notFound && failure ? <EmptyState title={failure.message} /> : null}

      {state.status === "error" && !notFound ? (
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
            "Bạn đang offline. Chưa tải được kèo này.",
            "You are offline. This game could not be loaded.",
          )}
          onRetry={onRetry}
        />
      ) : null}
    </main>
  );
}

/** S-2 container: fetches the listing client-side (P-17); the join panel mounts with a listing. */
export function DiscoverDetail({ publicListingId }: { publicListingId: string }) {
  const online = useOnlineStatus();
  const [state, setState] = useState<DiscoverDetailState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    getDiscoveryListing(publicListingId).then(
      (listing) => {
        if (current) setState({ status: "ready", listing });
      },
      (error: unknown) => {
        if (current) setState({ status: "error", error });
      },
    );
    return () => {
      current = false;
    };
  }, [publicListingId, attempt]);

  const reload = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };
  const shown: DiscoverDetailState =
    state.status === "error" && isOffline(state.error, online) ? { status: "offline" } : state;
  return (
    <DiscoverFrame>
      <DiscoverDetailView state={shown} onRetry={reload}>
        <JoinPanel publicListingId={publicListingId} onReload={reload} />
      </DiscoverDetailView>
    </DiscoverFrame>
  );
}
