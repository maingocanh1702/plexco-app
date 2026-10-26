import { t } from "@plexco/core/i18n";
import { rotatePublicSessionShareLink } from "@plexco/db";
import { err, ok } from "../../../../../lib/api-envelope";
import { handleSessionCommand } from "../../../../../lib/session-command-route";
import { appDb, currentSession } from "../../../../../lib/session-cookies";

/**
 * POST /api/sessions/:id/share-link?tenant=<uuid> — the host mints a fresh public share link
 * (L39 D4b). The 0061 definer revokes the previous link on rotate, so it stops working.
 *
 * Unlike the publish precedent, whose authorization is the route gate alone, the wrapper
 * re-authorizes `session.manage` inside its own transaction and needs the actor; the command
 * context carries none, hence this second currentSession() read. `id` is passed through
 * unvalidated: the wrapper fails a non-UUID closed as SESSION_NOT_FOUND, and its thrown errors map
 * through handleSessionCommand. The raw slug is returned once and never logged or put in an error.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  return handleSessionCommand(
    request,
    { bucket: "session-share-link", limit: 10 },
    async (context) => {
      const actorPersonId = (await currentSession())?.personId;
      if (!actorPersonId) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);

      const { id } = await params;
      const result = await rotatePublicSessionShareLink(appDb().db, {
        tenantId: context.tenantId,
        actorPersonId,
        sessionId: id,
        commandId: context.commandId,
      });
      if (result.kind === "rotated") {
        return ok({ shareLink: { path: `/session/${result.slug}` } });
      }
      if (result.kind === "replayed") {
        return ok({ shareLink: null, replayed: true });
      }
      return err(
        "SESSION_NOT_OPEN",
        t(
          "Kèo này không hiển thị công khai nên không tạo được liên kết chia sẻ.",
          "This session is not publicly listed, so a share link cannot be created.",
        ),
        409,
      );
    },
  );
}
