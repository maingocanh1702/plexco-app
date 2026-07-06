import { t } from "@plexco/core/i18n";
import { onboardingSnapshot, tenantsForPerson } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { appDb, currentSession } from "../../../../lib/session-cookies";

/**
 * GET /api/onboarding/readiness?tenant=<uuid> — WAO-UC-10 checklist shell.
 * AuthZ: caller must be a WEB admin of that tenant (tenant_ids_for_person);
 * the read itself runs under withTenant → RLS double-guards it.
 * Steps beyond run-creation stay not_configured until their feature slices
 * (bank → payment-reconcile, TG bind → telegram-adapter, Zalo → zalo-adapter).
 */
const REQUIRED_STEPS = ["club_config", "bank_connect", "tg_bind"] as const;
const OPTIONAL_STEPS = ["zalo_connect", "first_session"] as const;

export async function GET(request: Request): Promise<Response> {
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);

  const tenantId = new URL(request.url).searchParams.get("tenant") ?? "";
  const mine = await tenantsForPerson(appDb().pool, session.personId);
  if (!mine.some((m) => m.tenantId === tenantId)) {
    return err("FORBIDDEN", t("Bạn không quản trị CLB này.", "Not an admin of this club."), 403);
  }

  const snapshot = await onboardingSnapshot(appDb().db, tenantId);
  if (!snapshot) {
    return err("NOT_FOUND", t("Chưa có onboarding run.", "No onboarding run yet."), 404);
  }

  const stepStatus = new Map<string, string>(
    snapshot.steps.map((s): [string, string] => [s.step, s.status]),
  );
  const steps = [...REQUIRED_STEPS, ...OPTIONAL_STEPS].map((step) => ({
    step,
    required: (REQUIRED_STEPS as readonly string[]).includes(step),
    status: stepStatus.get(step) ?? "not_configured",
  }));
  const ready = steps.filter((s) => s.required).every((s) => s.status === "verified");

  return ok({ runStatus: snapshot.runStatus, steps, ready });
}
