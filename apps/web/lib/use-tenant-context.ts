"use client";

import { useMemo } from "react";
import { useLang } from "./i18n-client";
import { resolveTimeZone } from "./session-time";
import type { SessionApiContext } from "./sessions-api";
import { useSessionContext } from "./use-session";

export interface TenantContext extends SessionApiContext {
  /** Club zone for NEW sessions (existing sessions render in their own `timezone`). */
  timezone: string;
  lang: ReturnType<typeof useLang>;
}

/** The club workspace's tenant, CSRF secret and zone; only valid inside the shell (session ready). */
export function useTenantContext(tenantId: string): TenantContext {
  const { session } = useSessionContext();
  const lang = useLang();
  const tenant = session?.tenants.find((item) => item.tenantId === tenantId);
  const csrfToken = session?.csrfToken ?? "";
  const timezone = resolveTimeZone(tenant?.timezone);
  return useMemo(
    () => ({ tenantId, csrfToken, timezone, lang }),
    [tenantId, csrfToken, timezone, lang],
  );
}
