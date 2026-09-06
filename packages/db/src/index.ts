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
  tenantLocale,
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
export { resolveCapability, type Capability, type CapabilityDecision } from "./capability.js";
export {
  createSession,
  publishSession,
  announceSession,
  updateSession,
  closeSession,
  cancelSession,
  SessionCommandError,
  SessionPublishError,
  SessionPublishAuthorizationError,
  SessionAnnounceError,
  SessionAnnounceAuthorizationError,
  SessionUpdateError,
  SessionUpdateAuthorizationError,
  SessionCloseError,
  SessionCloseAuthorizationError,
  SessionCancelError,
  SessionCancelAuthorizationError,
  type SessionCommandErrorCode,
  type CreateSessionInputPayload,
  type CreateSessionParams,
  type CreateSessionResult,
  type PublishSessionErrorCode,
  type PublishSessionInputPayload,
  type PublishSessionParams,
  type PublishSessionResult,
  type AnnounceChannel,
  type AnnounceSessionErrorCode,
  type AnnounceSessionInputPayload,
  type AnnounceSessionParams,
  type AnnounceSessionResult,
  type UpdateSessionErrorCode,
  type UpdateSessionInputPayload,
  type UpdateSessionParams,
  type UpdateSessionResult,
  type CloseSessionErrorCode,
  type CloseSessionInputPayload,
  type CloseSessionParams,
  type CloseSessionResult,
  type CancelSessionErrorCode,
  type CancelSessionInputPayload,
  type CancelSessionParams,
  type CancelSessionResult,
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
  SESSION_IDLE_SECONDS,
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
