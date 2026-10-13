"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiClientError, CLIENT_NETWORK_ERROR } from "./api-client";
import {
  hasMorePages,
  tabStatuses,
  visibleSessions,
  type ListTab,
  type Stream,
} from "./session-list-streams";
import { clearSessionSnapshots, loadSnapshot, saveSnapshot } from "./session-snapshot";
import {
  getSession,
  listSessions,
  listSports,
  type SessionDetailDto,
  type SessionListItemDto,
  type SportDto,
} from "./sessions-api";

/** AUTH_REQUIRED anywhere means the cookie is gone: drop offline snapshots before the redirect. */
function noteError(error: unknown): ApiClientError {
  const wrapped =
    error instanceof ApiClientError ? error : new ApiClientError("CLIENT_UNKNOWN", "", 0);
  if (wrapped.code === "AUTH_REQUIRED") clearSessionSnapshots();
  return wrapped;
}

export type Loadable<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiClientError };

/**
 * Generic one-shot loader. `reload()` shows the loading state; `refresh()` refetches while keeping
 * the current data on screen (used after a command so focus is not lost to a skeleton swap).
 * Aborts the in-flight request on change/unmount.
 */
function useLoadable<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const silent = useRef(false);
  useEffect(() => {
    const controller = new AbortController();
    if (!silent.current) setState({ status: "loading" });
    silent.current = false;
    load(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ status: "ready", data });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ status: "error", error: noteError(error) });
      },
    );
    return () => controller.abort();
    // `load` is rebuilt every render on purpose; the explicit `deps` + nonce decide when to refetch.
  }, [...deps, nonce]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const refresh = useCallback(() => {
    silent.current = true;
    setNonce((n) => n + 1);
  }, []);
  return { state, reload, refresh };
}

export function useSessionDetail(tenantId: string, sessionId: string) {
  return useLoadable<SessionDetailDto>(
    (signal) => getSession(tenantId, sessionId, signal),
    [tenantId, sessionId],
  );
}

export function useSports() {
  return useLoadable<SportDto[]>((signal) => listSports(signal), []);
}

export type ListState =
  | { status: "loading" }
  | { status: "ready"; sessions: SessionListItemDto[]; hasMore: boolean; offlineSavedAt: null }
  | { status: "offline"; sessions: SessionListItemDto[]; hasMore: false; offlineSavedAt: number }
  | { status: "error"; error: ApiClientError };

const PAGE = 20;

export function useSessionList(tenantId: string, tab: ListTab) {
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiClientError | null>(null);
  const [nonce, setNonce] = useState(0);
  const now = useRef(Date.now());
  // Bumped whenever the tab/tenant/nonce effect restarts; a loadMore that started under an older
  // generation must not write its (old-tab) rows over the new tab's state.
  const generation = useRef(0);

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    now.current = Date.now();
    setLoadingMore(false);
    setState({ status: "loading" });
    setStreams(null);
    setMoreError(null);
    Promise.all(
      tabStatuses(tab).map(async (status): Promise<Stream> => {
        const page = await listSessions(tenantId, { status, limit: PAGE }, controller.signal);
        return {
          status,
          items: page.sessions,
          cursor: page.pageInfo.nextCursor,
          hasMore: page.pageInfo.hasMore,
        };
      }),
    ).then(
      (loaded) => {
        if (controller.signal.aborted) return;
        const visible = visibleSessions(loaded, tab, now.current);
        saveSnapshot(tenantId, tab, visible);
        setStreams(loaded);
        setState({
          status: "ready",
          sessions: visible,
          hasMore: hasMorePages(loaded, tab, now.current),
          offlineSavedAt: null,
        });
      },
      (raw: unknown) => {
        if (controller.signal.aborted) return;
        const error = noteError(raw);
        const snap = error.code === CLIENT_NETWORK_ERROR ? loadSnapshot(tenantId, tab) : null;
        setState(
          snap
            ? {
                status: "offline",
                sessions: snap.sessions,
                hasMore: false,
                offlineSavedAt: snap.savedAt,
              }
            : { status: "error", error },
        );
      },
    );
    return () => controller.abort();
  }, [tenantId, tab, nonce]);

  const loadMore = useCallback(async () => {
    if (!streams || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await Promise.all(
        streams.map(async (s): Promise<Stream> => {
          if (!s.hasMore) return s;
          const page = await listSessions(tenantId, {
            status: s.status,
            cursor: s.cursor,
            limit: PAGE,
          });
          return {
            ...s,
            items: [...s.items, ...page.sessions],
            cursor: page.pageInfo.nextCursor,
            hasMore: page.pageInfo.hasMore,
          };
        }),
      );
      if (gen !== generation.current) return;
      setStreams(next);
      setState({
        status: "ready",
        sessions: visibleSessions(next, tab, now.current),
        hasMore: hasMorePages(next, tab, now.current),
        offlineSavedAt: null,
      });
    } catch (raw) {
      if (gen === generation.current) setMoreError(noteError(raw));
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  }, [streams, loadingMore, tenantId, tab]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, loadMore, loadingMore, moreError, reload };
}
