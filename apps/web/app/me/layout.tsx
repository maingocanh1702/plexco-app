import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { currentSession } from "../../lib/session-cookies";

/**
 * Server-side auth boundary for every /me/* page: no valid session -> back to the landing page,
 * BEFORE any child renders. Kept generic for lane M4 (me/settings).
 */
export default async function MeLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/");
  return <>{children}</>;
}
