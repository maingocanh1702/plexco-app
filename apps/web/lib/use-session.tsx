"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { apiFetch, ApiClientError } from "./api-client";
import type { SessionDto } from "./session-dto";

export type SessionState =
  | { status: "loading"; session: null }
  | { status: "signed-out"; session: null }
  | { status: "ready"; session: SessionDto }
  | { status: "error"; session: null; error: ApiClientError };

export interface UseSession {
  state: SessionState;
  status: SessionState["status"];
  session: SessionDto | null;
  refresh: () => Promise<void>;
}

/** Plain React state + effect over GET /api/auth/session; AUTH_REQUIRED means signed out. */
export function useSession(): UseSession {
  const [state, setState] = useState<SessionState>({ status: "loading", session: null });

  const refresh = useCallback(async () => {
    try {
      const session = await apiFetch<SessionDto>("/api/auth/session");
      setState({ status: "ready", session });
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "AUTH_REQUIRED") {
        setState({ status: "signed-out", session: null });
      } else {
        const wrapped =
          error instanceof ApiClientError ? error : new ApiClientError("CLIENT_UNKNOWN", "", 0);
        setState({ status: "error", session: null, error: wrapped });
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { state, status: state.status, session: state.session, refresh };
}

const SessionContext = createContext<UseSession | null>(null);

/** One fetch for a whole subtree (the club workspace shell wraps its pages in this). */
export function SessionProvider({ children }: { children: ReactNode }) {
  const value = useSession();
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): UseSession {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSessionContext must be used inside <SessionProvider>");
  return ctx;
}
