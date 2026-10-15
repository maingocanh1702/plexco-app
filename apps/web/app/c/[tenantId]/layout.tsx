import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "../../../components/shell/app-shell";
import { log } from "../../../lib/log";
import { currentSession } from "../../../lib/session-cookies";

/**
 * Trust boundary for /c/**: pages under /c/** take only `tenantId`; all tenant data comes through
 * /api after the client-side membership proof. app/c/server-boundary.test.ts enforces it.
 *
 * Club workspace layout. The server only proves "someone is signed in"; whether THIS tenant
 * belongs to them is decided by the client shell from /api/auth/session (see AppShell).
 */
export default async function ClubLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  let signedIn = false;
  try {
    signedIn = (await currentSession()) !== null;
  } catch (error) {
    // Fail closed to the landing page rather than a default-language 500 on a DB blip.
    log.error("club_layout.session_resolve_failed", { error });
  }
  if (!signedIn) redirect("/");
  return <AppShell tenantId={tenantId}>{children}</AppShell>;
}
