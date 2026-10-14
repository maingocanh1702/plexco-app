import { redirect } from "next/navigation";
import { NewClubForm } from "../../../components/onboarding/new-club-form";
import { log } from "../../../lib/log";
import { currentSession } from "../../../lib/session-cookies";

/** Auth gate only; the form (client) owns the rest. No session cookie never opens the DB. */
export default async function NewClubPage() {
  let signedIn = false;
  try {
    signedIn = (await currentSession()) !== null;
  } catch (error) {
    log.error("new_club.session_resolve_failed", { error });
  }
  if (!signedIn) redirect("/");
  return <NewClubForm />;
}
