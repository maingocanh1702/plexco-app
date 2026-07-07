/**
 * @plexco/db — canonical store access.
 *
 * Application code imports THIS entrypoint: connection factories, the
 * withTenant/tenantRepo choke-point and the migration runner. The raw table
 * objects live in `@plexco/db/schema`, which is lint-restricted to this
 * package plus future service modules — controllers/adapters must never query
 * tenant tables directly (HR1).
 */
export { createDb, type Db, type DbHandle } from "./client.js";
export {
  assertTenantId,
  tenantRepo,
  withTenant,
  type CreateSessionInput,
  type TenantRepo,
} from "./tenant.js";
export { migrate, type MigrateResult } from "./migrate.js";
export {
  LoginReplayError,
  SlugTakenError,
  consumeLoginState,
  createWebSession,
  issueLoginState,
  loginTelegram,
  onboardingSnapshot,
  provisionTenant,
  rateLimitCheck,
  resolveWebSession,
  revokeWebSession,
  rotateWebSession,
  tenantsForPerson,
  type LoginResult,
  type OnboardingSnapshot,
  type ResolvedSession,
} from "./auth.js";
