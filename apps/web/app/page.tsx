import { LandingView } from "../components/landing/landing-view";
import { WorkspaceRedirect } from "../components/landing/workspace-redirect";
import { normalizeAuthErrorParam } from "../lib/auth-error-message";
import { log } from "../lib/log";
import { currentSession } from "../lib/session-cookies";

/**
 * `/` — signed-out landing, or (signed in) the router into the right club workspace. The server
 * only decides signed-in vs signed-out; which club is client-side because tenant membership
 * lookup is confined to GET /api/auth/session (DD-56 clause 2 lint). With no session cookie
 * `currentSession()` returns before touching the DB, so the signed-out path needs no database.
 */
export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ auth_error?: string | string[] }>;
}) {
  const params = await searchParams;
  // Closed set only: the raw query value never enters the RSC payload.
  const authError = normalizeAuthErrorParam(params.auth_error);

  let signedIn = false;
  try {
    signedIn = (await currentSession()) !== null;
  } catch (error) {
    // Fail closed: an unresolvable session is treated as signed out, never as signed in.
    log.error("landing.session_resolve_failed", { error });
  }
  return signedIn ? <WorkspaceRedirect /> : <LandingView authError={authError} />;
}
