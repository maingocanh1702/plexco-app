import { LinkCodeForm } from "../../../components/me/link-code-form";

// Session-dependent: never prerender or cache.
export const dynamic = "force-dynamic";

/**
 * /me/link -- enter the code the Zalo bot gave you (`/link`). Language: the /me chrome's
 * (MeFrame), one source for heading, form and nav; never Accept-Language (DD-118).
 */
export default function LinkZaloPage() {
  return (
    <main>
      <LinkCodeForm />
    </main>
  );
}
