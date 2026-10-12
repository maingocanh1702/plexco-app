import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "../../../components/shell/app-shell";
import { currentSession } from "../../../lib/session-cookies";

/**
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
  if (!(await currentSession())) redirect("/");
  return <AppShell tenantId={tenantId}>{children}</AppShell>;
}
