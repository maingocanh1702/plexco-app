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
import { useRealtime } from "./use-realtime";

/** AUTH_REQUIRED anywhere means the cookie is gone: drop offline snapshots before the redirect. */
function noteError(error: unknown): ApiClientError {
  const wrapped =
    error instanceof ApiClientError ? error : new ApiClientError("CLIENT_UNKNOWN", "", 0);
  if (wrapped.code === "AUTH_REQUIRED") clearSessionSnapshots();
  return wrapped;
}

/** Live refresh is opt-in per view (lane L5, R-13); only these errors replace data on screen. */
export interface LiveOptions {
  live?: boolean;
}
const LIVE_STOP = new Set(["AUTH_REQUIRED", "FORBIDDEN"]);

/** A view streams only when it opted in and is not in its error state (which turns live off). */
export function liveStreamEnabled(options: LiveOptions | undefined, state: { status: string }) {
  return options?.live === true && state.status !== "error";
}

/** R-16: at most one run in flight plus at most one queued rerun, with no fixed delay. */
function useSingleFlight(task: () => Promise<void>): () => void {
  const latest = useRef(task);
  const flight = useRef({ running: false, queued: false });
  useEffect(() => {
    latest.current = task;
  });
  return useCallback(() => {
    const f = flight.current;
    if (f.running) {
      f.queued = true;
      return;
    }
    f.running = true;
    void (async () => {
      do {
        f.queued = false;
        await latest.current().catch(() => undefined);
      } while (f.queued);
      f.running = false;
    })();
  }, []);
}

export type Loadable<T> =
  { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiClientError };

/**
 * Generic one-shot loader. `reload()` shows the loading state; `refresh()` refetches while keeping
 * the current data on screen (used after a command so focus is not lost to a skeleton swap).
 * Aborts the in-flight request on change/unmount.
 */
export function useLoadable<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const [nonce, setNonce] = useState(0);
  const silent = useRef(false);
  // For liveRefresh: the latest `load`, a generation that discards a refetch from older deps, and
  // the current (re)load, which a live round waits for (F2).
  const latestLoad = useRef(load);
  const generation = useRef(0);
  const settled = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    latestLoad.current = load;
  });
  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    if (!silent.current) setState({ status: "loading" });
    silent.current = false;
    settled.current = load(controller.signal).then(
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
  /** Silent refetch for a live change: keeps the data on screen unless access is gone. */
  const liveRefresh = useCallback(async () => {
    await settled.current; // F2: an older in-flight snapshot never lands after a live refetch
    const gen = generation.current;
    try {
      const data = await latestLoad.current(new AbortController().signal);
      if (gen === generation.current) setState({ status: "ready", data });
    } catch (raw) {
      const error = noteError(raw);
      if (gen === generation.current && LIVE_STOP.has(error.code))
        setState({ status: "error", error });
    }
  }, []);
  return { state, reload, refresh, liveRefresh };
}

export function useSessionDetail(tenantId: string, sessionId: string, options?: LiveOptions) {
  const loadable = useLoadable<SessionDetailDto>(
    (signal) => getSession(tenantId, sessionId, signal),
    [tenantId, sessionId],
  );
  const refreshLive = useSingleFlight(loadable.liveRefresh);
  useRealtime(tenantId, liveStreamEnabled(options, loadable.state), (signal) => {
    if (signal.kind === "resync" || signal.message.sessionId === sessionId) refreshLive();
  });
  return loadable;
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

export function useSessionList(tenantId: string, tab: ListTab, options?: LiveOptions) {
  const [streams, setStreams] = useState<Stream[] | null>(null);
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<ApiClientError | null>(null);
  const [nonce, setNonce] = useState(0);
  const now = useRef(Date.now());
  // Bumped whenever the tab/tenant/nonce effect restarts; a loadMore that started under an older
  // generation must not write its (old-tab) rows over the new tab's state.
  const generation = useRef(0);
  const moreController = useRef<AbortController | null>(null);
  // `streams` for liveRefresh, written next to every setStreams (no render lag), and the current
  // tab load, which a live round waits for (F2: a change during the first load is not dropped).
  const streamsRef = useRef<Stream[] | null>(null);
  const settled = useRef<Promise<unknown>>(Promise.resolve());

  useEffect(() => {
    const controller = new AbortController();
    generation.current += 1;
    moreController.current?.abort();
    now.current = Date.now();
    setLoadingMore(false);
    setState({ status: "loading" });
    setStreams(null);
    streamsRef.current = null;
    setMoreError(null);
    settled.current = Promise.all(
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
        streamsRef.current = loaded;
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
    return () => {
      controller.abort();
      moreController.current?.abort();
    };
  }, [tenantId, tab, nonce]);

  const loadMore = useCallback(async () => {
    if (!streams || loadingMore) return;
    const gen = generation.current;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const next = await Promise.all(
        streams.map(async (s): Promise<Stream> => {
          if (!s.hasMore) return s;
          const page = await listSessions(
            tenantId,
            { status: s.status, cursor: s.cursor, limit: PAGE },
            controller.signal,
          );
          return {
            ...s,
            items: [...s.items, ...page.sessions],
            cursor: page.pageInfo.nextCursor,
            hasMore: page.pageInfo.hasMore,
          };
        }),
      );
      if (gen !== generation.current) return;
      streamsRef.current = next;
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

  // Live refresh (R-16): refetch every loaded stream silently, up to 50 rows each, with no loading
  // state. The generation is bumped at the start and again on apply, so a loadMore built on the
  // stale cursors is discarded; only AUTH_REQUIRED/FORBIDDEN replace the list.
  const liveRefresh = useCallback(async () => {
    await settled.current;
    const current = streamsRef.current;
    if (!current) return;
    generation.current += 1;
    const gen = generation.current;
    moreController.current?.abort();
    setLoadingMore(false);
    try {
      const next = await Promise.all(
        current.map(async (s): Promise<Stream> => {
          const limit = Math.min(50, Math.max(PAGE, s.items.length));
          const page = await listSessions(tenantId, { status: s.status, limit });
          const { nextCursor: cursor, hasMore } = page.pageInfo;
          return { status: s.status, items: page.sessions, cursor, hasMore };
        }),
      );
      if (gen !== generation.current) return;
      generation.current += 1;
      const visible = visibleSessions(next, tab, now.current);
      saveSnapshot(tenantId, tab, visible);
      streamsRef.current = next;
      setStreams(next);
      setLoadingMore(false);
      const hasMore = hasMorePages(next, tab, now.current);
      setState({ status: "ready", sessions: visible, hasMore, offlineSavedAt: null });
    } catch (raw) {
      const error = noteError(raw);
      if (gen === generation.current && LIVE_STOP.has(error.code))
        setState({ status: "error", error });
    }
  }, [tenantId, tab]);
  useRealtime(tenantId, liveStreamEnabled(options, state), useSingleFlight(liveRefresh));

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { state, loadMore, loadingMore, moreError, reload };
}
