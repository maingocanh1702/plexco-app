import { runWithLang, t } from "@plexco/core/i18n";
import { onboardingSnapshot, tenantsForPerson } from "@plexco/db";
import { err, ok } from "../../../../lib/api-envelope";
import { appDb, currentSession } from "../../../../lib/session-cookies";
import { resolveTenantLang } from "../../../../lib/tenant-lang";

/**
 * GET /api/onboarding/readiness?tenant=<uuid> — WAO-UC-10 checklist shell.
 * AuthZ: the API contract documents this as TenantOwner-only (BE tech spec
 * §3) — caller must hold the OWNER role for that tenant specifically, not
 * merely any tenant_admins row (codex round-14: today tenant_provision()
 * only ever grants 'owner', so this was equivalent in practice, but a
 * future delegated-admin feature would silently widen access without this
 * explicit check). The read itself also runs under withTenant → RLS
 * double-guards it.
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
  const session = await currentSession();
  if (!session) return err("AUTH_REQUIRED", t("Chưa đăng nhập.", "Not signed in."), 401);

  const tenantId = new URL(request.url).searchParams.get("tenant") ?? "";
  const mine = await tenantsForPerson(appDb().pool, session.personId);
  const membership = mine.find((m) => m.tenantId === tenantId);
  if (!membership || membership.role !== "owner") {
    return err("FORBIDDEN", t("Bạn không phải chủ CLB này.", "Not the owner of this club."), 403);
  }

  // DD-118 SEAM. Language is resolvable HERE and no earlier: the tenant is known AND has just been
  // proven to be owned by this actor, which is exactly DD-118's condition. Every `return err(`
  // ABOVE this line is emitted before that proof, so it stays Vietnamese — DD-118's ratified
  // behaviour, not a gap.
  //
  // The ordering is a disclosure boundary, not a formatting preference. Resolving above the
  // ownership check would answer a stranger's probe in the probed tenant's language, turning the
  // 403 into an oracle for both tenant existence and a club's configured locale. `tenant-lang.ts`
  // carries the full threat model; this comment exists so the next reader does not "simplify" the
  // resolution upwards to cover the 403 too.
  const lang = await resolveTenantLang(appDb().db, tenantId);

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
