import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { MeFrame } from "../../components/me/me-frame";
import { currentSession } from "../../lib/session-cookies";

/**
 * Server-side auth boundary for every /me/* page: no valid session -> back to the landing page,
 * BEFORE any child renders (no return-to: nothing consumes it yet; the client gate in MeFrame uses
 * the real path once a session expires while the page is open). Lane M4 owns this file: it renders
 * the account chrome (MeFrame) around /me/settings and /me/link.
 */
export default async function MeLayout({ children }: { children: ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/");
  return <MeFrame>{children}</MeFrame>;
}
