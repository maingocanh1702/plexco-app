import { redirect } from "next/navigation";
import { NewClubForm } from "../../../components/onboarding/new-club-form";
import { currentSession } from "../../../lib/session-cookies";

/** Auth gate only; the form (client) owns the rest. No session cookie never opens the DB. */
export default async function NewClubPage() {
  if (!(await currentSession())) redirect("/");
  return <NewClubForm />;
}
