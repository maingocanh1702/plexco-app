import { runWithLang, t } from "@plexco/core/i18n";
import {
  ClubConfigError,
  getClubConfig,
  getPublicAlias,
  setPublicAlias,
  updateClubConfig,
  type ClubConfigPatch,
} from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { resolveClubGate } from "../../../../lib/club-config-route";
import { readBoundedBody } from "../../../../lib/read-bounded-body";
import { isUnsafeCommandKey } from "../../../../lib/session-command-route";
import { appDb } from "../../../../lib/session-cookies";

/**
 * PATCH /api/onboarding/club?tenant=<uuid> — club configuration step (WAO). Authority:
 * authorize(content.manage). GET returns the current values. See club-config-route.ts for order.
 * The public alias (0060) is its own command, sent ALONE as { commandId, publicAlias }: every set
 * waits for the platform owner's approval. Every club answer carries publicAlias + publicAliasStatus.
 */
const MAX_BODY_BYTES = 8 * 1024;
const PATCH_LIMIT = { bucket: "club-config", limit: 10 };
const GET_LIMIT = { bucket: "club-config-read", limit: 60 };
const FIELDS = [
  "name",
  "timezone",
  "locale",
  "defaultSportKey",
  "defaultPriceAmount",
  "defaultVisibility",
] as const;

const invalid = () => err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);

export async function GET(request: Request): Promise<Response> {
  const gate = await resolveClubGate(request, { csrf: false, tenantBucket: GET_LIMIT });
  if (gate instanceof Response) return gate;
  return runWithLang(gate.lang, async () => {
    const params = { tenantId: gate.tenantId };
    const club = await getClubConfig(appDb().db, params);
    return ok({ club: { ...club, ...(await getPublicAlias(appDb().db, params)) } });
  });
}

export async function PATCH(request: Request): Promise<Response> {
  const gate = await resolveClubGate(request, { csrf: true, tenantBucket: PATCH_LIMIT });
  if (gate instanceof Response) return gate;

  return runWithLang(gate.lang, async () => {
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
      return invalid();
    }
    const read = await readBoundedBody(request, MAX_BODY_BYTES);
    if (!read.ok) {
      return read.reason === "too_large"
        ? err("INVALID_BODY", t("Dữ liệu quá lớn.", "Payload too large."), 413)
        : invalid();
    }
    let raw: unknown;
    try {
      raw = JSON.parse(read.text);
    } catch {
      return invalid();
    }
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const body = raw as Record<string, unknown>;

    const commandId = body.commandId;
    if (
      typeof commandId !== "string" ||
      commandId.trim().length === 0 ||
      commandId.length > 200 ||
      isUnsafeCommandKey(commandId)
    ) {
      return err("INVALID_BODY", t("Thiếu commandId.", "Missing commandId."), 400);
    }
    // Only declared keys travel on; the command validates values. Unknown keys are rejected.
    const allowed = new Set<string>(["commandId", "publicAlias", ...FIELDS]);
    if (Object.keys(body).some((k) => !allowed.has(k))) return invalid();
    // The alias travels with its commandId only, as a string (M-7: clearing is unsupported).
    const isAlias = "publicAlias" in body;
    if (isAlias && (Object.keys(body).length !== 2 || typeof body.publicAlias !== "string")) {
      return invalid();
    }
    const patch: Record<string, unknown> = {};
    for (const key of FIELDS) if (key in body) patch[key] = body[key];
    const tenantId = gate.tenantId;
    const actorPersonId = gate.personId;

    try {
      if (isAlias) {
        const set = await setPublicAlias(appDb().db, {
          tenantId,
          actorPersonId,
          commandId,
          publicAlias: body.publicAlias,
        });
        const club = await getClubConfig(appDb().db, { tenantId });
        const { publicAlias, publicAliasStatus } = set;
        return ok({ club: { ...club, publicAlias, publicAliasStatus } });
      }
      const result = await updateClubConfig(appDb().db, {
        tenantId,
        actorPersonId,
        commandId,
        patch: patch as ClubConfigPatch,
      });
      const alias = await getPublicAlias(appDb().db, { tenantId });
      return ok({ club: { ...result.club, ...alias }, step: result.step });
    } catch (error) {
      if (error instanceof ClubConfigError) {
        switch (error.code) {
          case "FORBIDDEN":
            return err(
              "FORBIDDEN",
              t("Bạn không có quyền với CLB này.", "Not permitted for this club."),
              403,
            );
          case "TENANT_SUSPENDED":
            return err(
              "TENANT_SUSPENDED",
              t("CLB đang bị tạm ngưng.", "This club is suspended."),
              403,
            );
          case "INVALID_INPUT":
            return invalid();
          case "COMMAND_ID_CONFLICT":
            return err(
              "COMMAND_ID_CONFLICT",
              t("commandId đã được dùng.", "commandId already used."),
              409,
            );
          case "NO_ONBOARDING_RUN":
            return err("NOT_FOUND", t("Chưa có onboarding run.", "No onboarding run yet."), 404);
        }
      }
      throw error;
    }
  });
}
