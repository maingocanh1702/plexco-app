import { and, eq, sql } from "drizzle-orm";
import { memberships, tenantAdmins } from "../schema.js";
import type { Db } from "../src/client.js";
import { withTenant } from "../src/tenant.js";

/**
 * Dev seed only (`pnpm dev:seed`, apps/web/lib/dev-login/seed.ts): give an EXISTING account-backed
 * Person a membership in the dev tenant and, for a co_admin persona, a web admin row.
 *
 * Why this file exists. The product has no entry point that adds an existing account's Person to a
 * club, and none that grants co_admin (owner rows come only from tenant_provision, which the seed
 * uses for the owner). The narrowest existing DB entry point is the `app` role's own tenant-scoped
 * DML on memberships and tenant_admins (0009 grants, FORCE RLS tenant_isolation), reached through
 * withTenant(): the same shape roster-service.ts uses for its memberships insert. It lives in
 * packages/db because apps/** may not build tenant SQL (HR1 lint: no @plexco/db/schema there).
 *
 * Idempotent: ON CONFLICT DO NOTHING on the partial unique indexes
 * memberships_active_person_unique and idx_tenant_admins_unique, then the existing row is read back,
 * so a second run creates nothing and returns the same ids. No table is created, no migration, no
 * SECURITY DEFINER: it can do only what RLS lets `app` do inside the one tenant it scopes to.
 */
export interface DevClubMemberInput {
  personId: string;
  displayName: string;
  /** null = plain member. "owner" is refused: owner rows come only from tenant_provision. */
  adminGrant: "co_admin" | null;
}

export interface DevClubMemberResult {
  membershipId: string;
  adminRowId: string | null;
}

export async function ensureDevClubMember(
  db: Db,
  tenantId: string,
  member: DevClubMemberInput,
): Promise<DevClubMemberResult> {
  if (member.adminGrant !== null && member.adminGrant !== "co_admin") {
    throw new Error("ensureDevClubMember: only co_admin may be granted here (owner: tenant_provision)");
  }
  return withTenant(db, tenantId, async (tx) => {
    await tx
      .insert(memberships)
      .values({ tenantId, personId: member.personId, displayName: member.displayName, status: "active" })
      .onConflictDoNothing({
        target: [memberships.tenantId, memberships.personId],
        // The index predicate, spelled unqualified (it is an ON CONFLICT inference clause).
        where: sql`status IN ('active', 'guest')`,
      });
    const [membership] = await tx
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.tenantId, tenantId),
          eq(memberships.personId, member.personId),
          sql`${memberships.status} IN ('active', 'guest')`,
        ),
      );
    if (membership === undefined) throw new Error("ensureDevClubMember: membership not visible");

    if (member.adminGrant === null) return { membershipId: membership.id, adminRowId: null };

    // platform 'web' + the internal person uuid: the exact shape tenant_provision writes for the
    // owner and tenant_capability_authorize (0049) matches on.
    await tx
      .insert(tenantAdmins)
      .values({
        tenantId,
        platform: "web",
        platformUserLookupHash: member.personId,
        role: member.adminGrant,
      })
      .onConflictDoNothing({
        target: [tenantAdmins.tenantId, tenantAdmins.platform, tenantAdmins.platformUserLookupHash],
        where: sql`active = true`,
      });
    const [admin] = await tx
      .select({ id: tenantAdmins.id })
      .from(tenantAdmins)
      .where(
        and(
          eq(tenantAdmins.tenantId, tenantId),
          eq(tenantAdmins.platform, "web"),
          eq(tenantAdmins.platformUserLookupHash, member.personId),
          eq(tenantAdmins.active, true),
        ),
      );
    if (admin === undefined) throw new Error("ensureDevClubMember: admin row not visible");
    return { membershipId: membership.id, adminRowId: admin.id };
  });
}
