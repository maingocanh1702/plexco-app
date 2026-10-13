import { runWithLang, t } from "@plexco/core/i18n";
import { onboardingSnapshot } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { resolveClubGate } from "../../../../lib/club-config-route";
import { appDb } from "../../../../lib/session-cookies";

/**
 * GET /api/onboarding/readiness?tenant=<uuid> — WAO-UC-10 checklist shell.
 * AuthZ: authorize(content.manage) (DD-56) through resolveClubGate -- no role check here. Until M1b
 * this was owner-only; the capability also admits admin/co_admin (preset), per the DD-56 matrix.
 * Steps beyond run-creation stay not_configured until their feature slices
 * (bank → payment-reconcile, Zalo → zalo-adapter, first_session → session flow).
 *
 * Predicate = feature_web_auth_onboarding_tech.md §"Tenant readiness matrix" (WAO-OQ-2):
 * required = club config verified + bank verified + at least one first session verified;
 * Zalo bot is optional and never changes the answer. Until audit 2026-09-06 (W-5) this list
 * required `tg_bind` — a step no code path ever writes, since Telegram left phase-1 in DD-37 —
 * so `ready` could never become true. `first_session` was optional, the opposite of the spec.
 */
const REQUIRED_STEPS = ["club_config", "bank_connect", "first_session"] as const;
const OPTIONAL_STEPS = ["zalo_connect"] as const;

export async function GET(request: Request): Promise<Response> {
  // authorize(content.manage) via the shared club gate; language resolves only after authz (DD-118).
  const gate = await resolveClubGate(request, { csrf: false });
  if (gate instanceof Response) return gate;
  const { tenantId, lang } = gate;

  return runWithLang(lang, async () => {
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
  });
}
