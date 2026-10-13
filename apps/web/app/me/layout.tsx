import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentSession } from "../../lib/session-cookies";

/**
 * Server-side auth boundary for every /me/* page: no valid session -> back to the landing page
 * with a return-to, BEFORE any child renders. Kept generic for lane M4 (me/settings). A layout
 * cannot see its pathname, so the return-to is /me/link until a second page needs another.
 */
export default async function MeLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect(`/?returnTo=${encodeURIComponent("/me/link")}`);
  return <>{children}</>;
}
