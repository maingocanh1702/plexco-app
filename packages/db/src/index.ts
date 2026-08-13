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
  authorizeTenantAction,
  type ActionClass,
  type AuthorizationDecision,
  type EffectiveStatus,
} from "./authorization.js";
export {
  createSession,
  SessionCommandError,
  type SessionCommandErrorCode,
  type CreateSessionInputPayload,
  type CreateSessionParams,
  type CreateSessionResult,
} from "./session-service.js";
export {
  LoginReplayError,
  SlugTakenError,
  armOauthCompletionHandoff,
  consumeLoginState,
  consumeOauthCompletionHandoff,
  createWebSession,
  issueLoginState,
  loginTelegram,
  onboardingSnapshot,
  provisionTenant,
  rateLimitCheck,
  resolveWebSession,
  revokeAllWebSessions,
  revokeWebSession,
  rotateWebSession,
  tenantsForPerson,
  type LoginResult,
  type OnboardingSnapshot,
  type ResolvedSession,
  // Email credential-lifecycle app-boundary helpers (D1, migration 0016) — the
  // order-3/4 email routes reach them through this entrypoint (B0 §3.3/§3.4).
  InvalidEmailError,
  decryptEmailEnc,
  deriveEmailArtifacts,
  deriveProviderIdempotencyKey,
  normalizeEmail,
  type EmailArtifactKeys,
  type EmailArtifacts,
} from "./auth.js";
