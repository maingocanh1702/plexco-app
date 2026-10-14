import { t } from "@plexco/core/i18n";
import { detachMyChannel } from "@plexco/db";
import { err, ok } from "../../../../../../lib/api-envelope";
import { resolveMeGate } from "../../../../../../lib/me-route-gate";
import { appDb } from "../../../../../../lib/session-cookies";

/**
 * POST /api/me/channels/:id/detach -- UNLINK a channel. The identity moves to a fresh empty Person
 * (the channel user becomes a stranger again); the account's Person, its memberships and charges are
 * never merged, tombstoned or deleted. No body and no commandId: the operation is naturally
 * idempotent -- a repeat finds the identity already gone and answers CHANNEL_NOT_LINKED (409), the
 * same answer as "not yours" or "unknown" (no existence oracle). 5 per 10 minutes per account.
 */
const DETACH_LIMIT = { name: "me-detach", limit: 5, windowSeconds: 600 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const gate = await resolveMeGate(request, { csrf: true, bucket: DETACH_LIMIT });
  if (gate instanceof Response) return gate;
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return err("INVALID_BODY", t("Mã kênh không hợp lệ.", "Invalid channel id."), 400);
  }
  const { outcome } = await detachMyChannel(appDb().pool, gate.accountId, id.toLowerCase());
  if (outcome === "invalid") {
    return err(
      "CHANNEL_NOT_LINKED",
      t(
        "Kênh này không còn liên kết với tài khoản của bạn.",
        "This channel is no longer linked to your account.",
      ),
      409,
    );
  }
  return ok({ detached: true });
}
