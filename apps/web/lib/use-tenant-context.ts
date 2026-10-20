"use client";

import { createContext, useContext, useMemo } from "react";
import { useLang } from "./i18n-client";
import { resolveTimeZone } from "./session-time";
import type { SessionApiContext } from "./sessions-api";
import { useSessionContext } from "./use-session";

export interface TenantContext extends SessionApiContext {
  /** Club zone for NEW sessions (existing sessions render in their own `timezone`). */
  timezone: string;
  lang: ReturnType<typeof useLang>;
}

/** A club zone a page supplies when the session has no zone for that tenant (a plain member's session lists none). */
export const TenantZoneContext = createContext<string | undefined>(undefined);

/** The club workspace's tenant, CSRF secret and zone; only valid inside a ready SessionProvider: the shell or MeFrame. */
export function useTenantContext(tenantId: string): TenantContext {
  const { session } = useSessionContext();
  const lang = useLang();
  const zoneOverride = useContext(TenantZoneContext); // its own statement: never conditional
  const tenant = session?.tenants.find((item) => item.tenantId === tenantId);
  const csrfToken = session?.csrfToken ?? "";
  const timezone = resolveTimeZone(tenant?.timezone ?? zoneOverride);
  return useMemo(
    () => ({ tenantId, csrfToken, timezone, lang }),
    [tenantId, csrfToken, timezone, lang],
  );
}
