/**
 * @plexco/db — canonical store access.
 *
 * Application code imports THIS entrypoint: connection factories, the
 * withTenant/tenantRepo choke-point and the migration runner. The raw table
 * objects live in `@plexco/db/schema`, which is lint-restricted to this
 * package plus future service modules — controllers/adapters must never query
 * tenant tables directly (HR1).
 */
export { createDb, type Db, type DbHandle, type Tx } from "./client.js";
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
export {
  CLUB_ACTION,
  ClubConfigError,
  getClubConfig,
  updateClubConfig,
  type ClubConfig,
  type ClubConfigErrorCode,
  type ClubConfigPatch,
  type UpdateClubConfigParams,
  type UpdateClubConfigResult,
} from "./club-config.js";
export { pgErrorChainText, pgErrorHasCode } from "./pg-error.js";
export {
  ZALO_CONNECTOR_ACTION,
  ZaloConnectError,
  appendSecretDecryptAudit,
  beginZaloConnect,
  claimZaloReplyContext,
  createZaloReplyContext,
  finishInboundEvent,
  finishZaloConnect,
  getZaloOnboardingState,
  markBotVerifiedActive,
  probeZaloConnectReplay,
  readLatestZaloReplyContext,
  readZaloBotTokenEnc,
  readZaloPayContext,
  resolveZaloBotByToken,
  resolveZaloIdentity,
  resolveZaloLinkGate,
  storeInboundEvent,
  type BeginZaloConnectResult,
  type ZaloBotRef,
  type ZaloBotSecretsInput,
  type ZaloBotStatus,
  type ZaloConnectErrorCode,
  type ZaloIdentity,
  type ZaloOnboardingState,
} from "./zalo-ingress.js";
export {
  authorize,
  type AuthorizeDecision,
  type AuthorizeParams,
  type AuthorizeRole,
} from "./tenant-capability-authority.js";
export {
  decodeSessionCursor,
  getSessionDetail,
  listSessions,
  SessionReadError,
  SESSION_STATUSES,
  type ListSessionsParams,
  type SessionDetail,
  type SessionListItem,
  type SessionListPage,
  type SessionScalars,
} from "./session-read.js";
export { listActiveSports, type ActiveSport } from "./sports-read.js";
export { readSessionRealtimeEvent, type SessionRealtimeEvent } from "./realtime-event-read.js";
// Web MVP lane M2c: host roster writer + manual mark-paid (DD-40) + reversal.
export {
  addMemberToSession,
  removePlayerFromSession,
  type AddMemberParams,
  type AddMemberResult,
  type RemovePlayerParams,
  type RemovePlayerResult,
} from "./roster-service.js";
// Web MVP Phase 3 lane L8 (M9): player self-join, self-leave and FIFO waitlist promotion.
export {
  // The web entry gate's P-3 audience check (apps/web/lib/session-command-route.ts selfService).
  hasLiveMembership,
  joinSession,
  leaveSession,
  type JoinSessionParams,
  type JoinSessionResult,
  type LeaveSessionParams,
  type LeaveSessionResult,
  // L13 (M9): the Zalo /join numbered list (RC-3).
  listOwnJoinableSessions,
  type JoinableSession,
  type JoinableSessionsResult,
  // L13 (M9): the Zalo /leave numbered list (RC-3, P-13).
  listOwnLeavableSeats,
  type LeavableSeat,
} from "./session-join-service.js";
// L8 (M9): join requests on approval sessions (openJoinRequest stays internal to joinSession).
export {
  approveJoinRequest,
  cancelJoinRequest,
  listPendingJoinRequests,
  rejectJoinRequest,
  type ApproveJoinRequestResult,
  type CancelJoinRequestParams,
  type DecideJoinRequestParams,
  type JoinRequestClosedResult,
  type ListPendingJoinRequestsParams,
  type PendingJoinRequest,
} from "./join-request-service.js";
export {
  chargeStatusFor,
  markPaid,
  type ChargeStatus,
  type ManualPaymentMethod,
  type MarkPaidItemInput,
  type MarkPaidLine,
  type MarkPaidParams,
  type MarkPaidResult,
} from "./payment-manual.js";
export {
  reversePaymentAllocation,
  type ReversePaymentParams,
  type ReversePaymentResult,
} from "./payment-reversal.js";
export { RosterMoneyError, type RosterMoneyErrorCode } from "./roster-money-shared.js";
export { resolveCapability, type Capability, type CapabilityDecision } from "./capability.js";
export {
  ChatCommandError,
  deleteChatMessage,
  editChatMessage,
  getChatMessage,
  listChatMessages,
  markChatRead,
  moderateChatMessage,
  sendChatMessage,
  withChatActor,
  type ChatActor,
  type ChatCommandErrorCode,
  type ChatMessage,
  type ChatMessageListRow,
  type ChatTx,
} from "./chat-service.js";
export { listChatChannels, type ChatChannelRow } from "./chat-channel-reads.js";
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
  // SES-UC-17 guest notes (BE tech spec §4 "Guest Note management"). One error class for both
  // commands: they share SESSION_NOT_FOUND/COMMAND_ID_CONFLICT and the route maps one union.
  createGuestNote,
  deleteGuestNote,
  SessionGuestNoteError,
  type SessionGuestNoteErrorCode,
  type CreateGuestNoteInputPayload,
  type CreateGuestNoteParams,
  type CreateGuestNoteResult,
  type DeleteGuestNoteInputPayload,
  type DeleteGuestNoteParams,
  type DeleteGuestNoteResult,
} from "./session-service.js";
export {
  SlugTakenError,
  armOauthCompletionHandoff,
  consumeLoginState,
  consumeOauthCompletionHandoff,
  createWebSession,
  issueLoginState,
  onboardingSnapshot,
  provisionTenant,
  rateLimitCheck,
  resolveWebSession,
  SESSION_IDLE_SECONDS,
  revokeAllWebSessions,
  revokeWebSession,
  rotateWebSession,
  tenantsForPerson,
  tenantsForPersonWithProfile,
  type TenantWithProfile,
  guestNoteTenantForPerson,
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
export {
  // Identity link_code issue/consume — typed wrappers over the 0043 definers
  // (feature_identity_tech.md §4, DD-50). Key material is injected by the caller.
  consumeLinkCode,
  deriveLinkCodeLookupHash,
  deriveLinkCodeVerifier,
  formatLinkCode,
  generateLinkCode,
  issueLinkCode,
  normalizeLinkCode,
  LINK_CODE_COOLDOWN_SECONDS,
  LINK_CODE_MAX_ATTEMPTS,
  LINK_CODE_TTL_SECONDS,
  type IssuedLinkCode,
  type LinkCodeConsumeOutcome,
  type LinkCodeConsumeResult,
  type LinkCodeKeys,
  type LinkCodeParty,
} from "./identity.js";
// Web account <-> Zalo link (M3b): consume + re-parent an EMPTY Zalo-side Person (0054).
export { linkZaloToAccount, type LinkZaloOutcome } from "./identity-link-web.js";
// Web MVP lane M4: the signed-in user's own profile + linked channels (0055 definers).
export {
  DisplayNameError,
  DISPLAY_NAME_MAX,
  detachMyChannel,
  listMyChannels,
  readMyProfile,
  updateMyProfile,
  validateDisplayName,
  type DetachOutcome,
  type MyChannel,
  type MyProfile,
} from "./me-settings.js";
// Phase 3 L23 and L29: the invisible-code-point strip (DD-138 A.1) and the name rules built on it.
export {
  checkTypedName,
  normalizeExternalName,
  STRIP_CHAR_RANGES,
  stripInvisibleChars,
} from "./text-safety.js";
// Phase 3 L9: the signed-in player's own cross-club reads (0059 definers; L16c chat context, 0066).
export {
  listMyClubs,
  listMyJoinRequests,
  listMySessions,
  readMyCharges,
  readMyClubChatContext,
  type MyCharges,
  type MyClub,
  type MyClubCharges,
  type MyJoinRequest,
  type MySession,
  type SelfPaymentStatus,
  type SelfPaymentSummary,
} from "./me-player-reads.js";
// Phase 3 L10a: the club's moderated public alias (0060 definers; approval is owner-only, by CLI).
export {
  getPublicAlias,
  PUBLIC_ALIAS_MAX,
  setPublicAlias,
  validatePublicAlias,
  type PublicAliasState,
  type PublicAliasStatus,
  type SetPublicAliasParams,
  type SetPublicAliasResult,
} from "./public-alias.js";
// Phase 3 L10b: the anonymous discovery read over public_session_share_v, as the readonly role.
export {
  DISCOVERY_PAGE_LIMIT_MAX,
  listDiscoveryListings,
  readDiscoveryListing,
  readDiscoveryListingByShareSlug,
  resolveDiscoveryListing,
  type DiscoveryKeyset,
  type DiscoveryListFilter,
  type DiscoveryListingRow,
  type DiscoveryListingTarget,
  type DiscoveryListPage,
} from "./public-discovery-read.js";
export { rotatePublicSessionShareLink } from "./public-session-share-link.js";
