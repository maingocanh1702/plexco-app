/**
 * Plexco canonical DB schema (Drizzle ORM / pg-core).
 *
 * Mirrors the SQL migrations in ./migrations. The SQL files are AUTHORITATIVE
 * for everything Drizzle cannot express: RLS ENABLE/FORCE + policies, role
 * grants, SECURITY DEFINER functions, append-only ledger triggers, and seeds
 * (see 0009/0010/0011). Keep both in sync.
 *
 * Visibility planes (TDD §3.2):
 *   GLOBAL protected — persons, channel_identities, link/merge, accounts,
 *                      web auth, magic_links, player_chat_context, oauth, sports.
 *   TENANT-private   — has tenant_id; RLS fail-closed via app.tenant_id GUC.
 *   PUBLIC read model— public_sessions (no RLS, field whitelist).
 *
 * Money is integer minor units (VND). Timestamps are timestamptz. PII is *_enc
 * (bytea) with deterministic *_lookup_hash for equality lookup.
 */
import {
  pgTable, uuid, text, integer, bigint, bigserial, smallint, boolean, jsonb, timestamp,
  time, customType, uniqueIndex, unique, index, primaryKey, check, foreignKey,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// bytea helper (KMS-encrypted blobs / hashes stored as bytes)
const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

/* ===========================================================================
 * GLOBAL protected directory
 * ======================================================================== */

export const sports = pgTable("sports", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull().unique(),
  name: text("name").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const persons = pgTable("persons", {
  id: uuid("id").primaryKey().defaultRandom(),
  displayName: text("display_name"),
  phoneEnc: bytea("phone_enc"),
  phoneLookupHash: text("phone_lookup_hash"),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  status: text("status").notNull().default("active"), // active|merged|deleted
  mergedIntoPersonId: uuid("merged_into_person_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  verifiedPhoneUq: uniqueIndex("persons_verified_phone_unique")
    .on(t.phoneLookupHash)
    .where(sql`${t.phoneVerifiedAt} IS NOT NULL AND ${t.status} = 'active'`),
  statusChk: check("persons_status_chk", sql`${t.status} IN ('active','merged','deleted')`),
}));

export const channelIdentities = pgTable("channel_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull().references(() => persons.id),
  platform: text("platform").notNull(), // telegram|zalo|messenger
  platformUserIdEnc: bytea("platform_user_id_enc").notNull(),
  platformUserLookupHash: text("platform_user_lookup_hash").notNull(),
  usernameEnc: bytea("username_enc"),
  status: text("status").notNull().default("active"), // active|inactive
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  platformUq: uniqueIndex("channel_identities_platform_uid_uq")
    .on(t.platform, t.platformUserLookupHash),
  personIdx: index("idx_channel_identities_person").on(t.personId),
  platformChk: check("channel_identities_platform_chk",
    sql`${t.platform} IN ('telegram','zalo','messenger')`),
  // 0042 (audit 2026-09-06 W-1) narrows this further to exclude 'telegram', but with a BEFORE
  // INSERT/UPDATE trigger rather than a second CHECK: a CHECK (even NOT VALID) is re-enforced on
  // every later UPDATE of a legacy row, which would freeze existing telegram rows against
  // deactivation and merge re-parenting. Drizzle has no trigger DSL — see the migration.
  statusChk: check("channel_identities_status_chk", sql`${t.status} IN ('active','inactive')`),
}));

export const linkCodes = pgTable("link_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourcePersonId: uuid("source_person_id").notNull().references(() => persons.id),
  // DD-50 issuer shape is XOR (migration 0039, audit 2026-09-06 D-9): exactly one of
  // source_channel_identity_id / source_account_id. Nullable since 0039 (was NOT NULL in 0001).
  sourceChannelIdentityId: uuid("source_channel_identity_id")
    .references(() => channelIdentities.id),
  sourceAccountId: uuid("source_account_id").references(() => accounts.id),
  codeLookupHash: text("code_lookup_hash").notNull().unique(),
  codeHash: bytea("code_hash").notNull(),
  salt: bytea("salt").notNull(),
  action: text("action").notNull().default("merge_identity"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(5),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  maxAttemptsChk: check("link_codes_max_attempts_chk", sql`${t.maxAttempts} BETWEEN 1 AND 20`),
  issuerXorChk: check("link_codes_issuer_xor_chk",
    sql`num_nonnulls(${t.sourceChannelIdentityId}, ${t.sourceAccountId}) = 1`),
}));

export const mergeAudit = pgTable("merge_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourcePersonId: uuid("source_person_id").notNull(),
  targetPersonId: uuid("target_person_id").notNull(),
  canonicalPersonId: uuid("canonical_person_id").notNull(),
  method: text("method").notNull(),
  actorType: text("actor_type").notNull(),
  actorId: uuid("actor_id"),
  reasonCode: text("reason_code"),
  beforeSnapshotEnc: bytea("before_snapshot_enc").notNull(),
  afterSnapshotEnc: bytea("after_snapshot_enc").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const mergeTombstones = pgTable("merge_tombstones", {
  oldPersonId: uuid("old_person_id").primaryKey(),
  canonicalPersonId: uuid("canonical_person_id").notNull().references(() => persons.id),
  mergeAuditId: uuid("merge_audit_id").notNull().references(() => mergeAudit.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable("accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").references(() => persons.id),
  // Revoke-all validity authority (DD-80 v1.88, migration 0015): bumped once
  // per logout-all under the account's own row lock. A session only resolves
  // when its minted_epoch equals this exact value — see webSessions below.
  sessionEpoch: bigint("session_epoch", { mode: "number" }).notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionEpochChk: check("accounts_session_epoch_chk", sql`${t.sessionEpoch} >= 0`),
}));

export const webSessions = pgTable("web_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  csrfSecret: text("csrf_secret").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rotatedFrom: uuid("rotated_from"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  // Epoch stamped under the locked account row at create/rotate time (0015).
  // Exact equality against accounts.session_epoch is the sole bulk validity
  // rule — never `>=` (DD-80 v1.88, G3-I1).
  mintedEpoch: bigint("minted_epoch", { mode: "number" }).notNull().default(0),
  // 0040 (audit 2026-09-06 W-6): touched by auth_resolve_web_session (throttled to once a minute);
  // a session idle longer than the resolver's p_idle (default 14 days) no longer resolves.
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  mintedEpochChk: check("web_sessions_minted_epoch_chk", sql`${t.mintedEpoch} >= 0`),
  // Partial index (0015/v1.86, D0-13): revoke-all walks only the LIVE rows
  // of one account while holding the accounts parent lock.
  accountActiveIdx: index("idx_web_sessions_account_active")
    .on(t.accountId).where(sql`${t.revokedAt} IS NULL`),
}));

export const accountIdentities = pgTable("account_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  platform: text("platform").notNull(),
  platformUserHash: text("platform_user_hash").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uq: uniqueIndex("account_identities_platform_uq").on(t.platform, t.platformUserHash),
}));

/**
 * Function-only auth tables (0012) — previously live-but-unmirrored drift;
 * closed here per B0 §9 resolution "(a)": SQL migrations stay authoritative
 * for grants/functions/search_path (see 0012's own header comment), but
 * schema.ts mirrors every table, including ones only a SECURITY DEFINER
 * function ever touches. `app` has zero grant on any of these three.
 */
export const authLoginNonces = pgTable("auth_login_nonces", {
  loginHash: text("login_hash").primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  seenAtIdx: index("idx_auth_login_nonces_seen_at").on(t.seenAt),
}));

export const authLoginState = pgTable("auth_login_state", {
  stateHash: text("state_hash").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  expiresAtIdx: index("idx_auth_login_state_expires_at").on(t.expiresAt),
}));

// UNLOGGED in 0012 (throughput over durability) — Drizzle has no storage-
// parameter builder, so that attribute lives only in the SQL migration.
export const rateLimitHits = pgTable("rate_limit_hits", {
  bucket: text("bucket").notNull(),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  bucketAtIdx: index("idx_rate_limit_bucket_at").on(t.bucket, t.at),
  atIdx: index("idx_rate_limit_at").on(t.at),
}));

/**
 * Shared append-only auth audit — column-for-column per the pinned shape in
 * B0 §3.1/§8.3, plus the v1.88 session_epoch_before/after amendment. This
 * slice (D0a) only ever inserts `logout_all` rows (link_codes_revoked /
 * merge_artifacts_cancelled stay NULL); later slices reuse/extend this same
 * table rather than creating a parallel one. No grants: written only from
 * inside SECURITY DEFINER functions. No FK on account_id/account_email_id —
 * matches the pinned shape (an audit trail outlives normal referential
 * concerns; account_emails does not exist yet at D0a).
 */
export const authAuditEvents = pgTable("auth_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventType: text("event_type").notNull(),
  accountId: uuid("account_id"),
  accountEmailId: uuid("account_email_id"),
  outcomeClass: text("outcome_class").notNull(),
  actorClass: text("actor_class").notNull(),
  requestRef: text("request_ref").notNull(),
  sessionsRevoked: integer("sessions_revoked"),
  // Nullable: an event that never touches session_epoch leaves both NULL
  // rather than fabricating a before/after pair (DD-80 v1.88).
  sessionEpochBefore: bigint("session_epoch_before", { mode: "number" }),
  sessionEpochAfter: bigint("session_epoch_after", { mode: "number" }),
  linkCodesRevoked: integer("link_codes_revoked"),
  mergeArtifactsCancelled: integer("merge_artifacts_cancelled"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Retention/cleanup scan index (codex round-03) — same pattern as every
  // other retention-swept table in this migration set.
  createdAtIdx: index("auth_audit_events_created_at_idx").on(t.createdAt),
  sessionsRevokedChk: check("auth_audit_events_sessions_revoked_chk",
    sql`${t.sessionsRevoked} IS NULL OR ${t.sessionsRevoked} >= 0`),
  epochBeforeChk: check("auth_audit_events_epoch_before_chk",
    sql`${t.sessionEpochBefore} IS NULL OR ${t.sessionEpochBefore} >= 0`),
  epochAfterChk: check("auth_audit_events_epoch_after_chk",
    sql`${t.sessionEpochAfter} IS NULL OR ${t.sessionEpochAfter} >= 0`),
  linkCodesRevokedChk: check("auth_audit_events_link_codes_revoked_chk",
    sql`${t.linkCodesRevoked} IS NULL OR ${t.linkCodesRevoked} >= 0`),
  mergeArtifactsCancelledChk: check("auth_audit_events_merge_artifacts_cancelled_chk",
    sql`${t.mergeArtifactsCancelled} IS NULL OR ${t.mergeArtifactsCancelled} >= 0`),
  epochShapeChk: check("auth_audit_events_epoch_shape_chk", sql`
    (${t.sessionEpochBefore} IS NULL AND ${t.sessionEpochAfter} IS NULL)
    OR (
      ${t.sessionEpochBefore} IS NOT NULL AND ${t.sessionEpochAfter} IS NOT NULL
      AND ${t.sessionEpochAfter} = ${t.sessionEpochBefore} + 1
    )`),
}));

/**
 * Email credential + token lifecycle (D1, migration 0016 — CODE DARK, order-2).
 * Provider-neutral verified email, password credential, INDEPENDENT pending
 * registration attempts, one-real-verifier email tokens, and the
 * enumeration-safe dark delivery ledger. Every table here is FUNCTION-ONLY:
 * `app` has ZERO grant, so direct DML on password_phc and EXECUTE on the
 * internal helpers are denied by construction (D1E-13). All privileged
 * behavior lives ONLY in the SQL migration (B0 §5.2/§8.1/§9):
 *   - `_auth_assert_password_phc` + its constraint triggers on BOTH write
 *     paths (auth_pending_email_registrations, email_password_credentials);
 *   - the verified-email gate trigger on email_password_credentials;
 *   - the parent-first `_auth_consume_email_token` consume helper;
 *   - the `_auth_email_cleanup` retention sweep.
 * auth_audit_events is REUSED from D0a/0015 (not redefined here).
 */
export const accountEmails = pgTable("account_emails", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  emailLookupHash: text("email_lookup_hash").notNull().unique(),
  emailEnc: bytea("email_enc").notNull(),
  kmsKeyVersion: text("kms_key_version").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // One email per account; one owner per normalized email (the inline .unique()
  // on email_lookup_hash covers the latter).
  accountUq: unique("account_emails_account_uq").on(t.accountId),
  // Orphan-cleanup scan index — only pending rows (the retention sweep target).
  pendingExpiresIdx: index("account_emails_pending_expires_idx")
    .on(t.pendingExpiresAt)
    .where(sql`${t.verifiedAt} IS NULL`),
  // Exactly one of verified_at / pending_expires_at is set (D1E-2).
  lifecycleChk: check("account_emails_lifecycle_chk", sql`
    (${t.verifiedAt} IS NULL AND ${t.pendingExpiresAt} IS NOT NULL)
    OR (${t.verifiedAt} IS NOT NULL AND ${t.pendingExpiresAt} IS NULL)`),
}));

// PK = account_email_id (one credential per verified email). A credential may
// exist ONLY for a verified email (verified-gate trigger, D1E-4) and only with
// a policy-valid Argon2id PHC (PHC trigger, 0016) — neither is expressible in
// Drizzle, so both live in the migration.
export const emailPasswordCredentials = pgTable("email_password_credentials", {
  accountEmailId: uuid("account_email_id").primaryKey().references(() => accountEmails.id),
  passwordPhc: text("password_phc").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authPendingEmailRegistrations = pgTable("auth_pending_email_registrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountEmailId: uuid("account_email_id").notNull()
    .references(() => accountEmails.id, { onDelete: "cascade" }),
  passwordPhc: text("password_phc"),
  registrationKeyHash: text("registration_key_hash").unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Referenced by the token composite FK below.
  idEmailUq: unique("auth_pending_email_registrations_id_email_uq").on(t.id, t.accountEmailId),
  // Active-attempt lookup — partial, now()-independent (expired-but-unswept
  // rows stay visible for supersede-before-insert).
  activeIdx: index("auth_pending_email_registrations_active_idx")
    .on(t.accountEmailId, t.createdAt)
    .where(sql`${t.consumedAt} IS NULL AND ${t.supersededAt} IS NULL`),
  expiresIdx: index("auth_pending_email_registrations_expires_idx").on(t.expiresAt),
  // Non-partial FK index for the account_email -> attempts ON DELETE CASCADE.
  accountEmailIdx: index("auth_pending_email_registrations_account_email_idx").on(t.accountEmailId),
  // Active ⇒ both candidates NOT NULL; terminal ⇒ exactly one of
  // consumed/superseded (XOR) and both candidates NULL (D1E-5).
  lifecycleChk: check("auth_pending_email_registrations_lifecycle_chk", sql`
    (${t.consumedAt} IS NULL AND ${t.supersededAt} IS NULL
      AND ${t.passwordPhc} IS NOT NULL AND ${t.registrationKeyHash} IS NOT NULL)
    OR
    ((${t.consumedAt} IS NOT NULL) <> (${t.supersededAt} IS NOT NULL)
      AND ${t.passwordPhc} IS NULL AND ${t.registrationKeyHash} IS NULL)`),
}));

export const authEmailTokens = pgTable("auth_email_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountEmailId: uuid("account_email_id").notNull()
    .references(() => accountEmails.id, { onDelete: "cascade" }),
  pendingRegistrationId: uuid("pending_registration_id"),
  purpose: text("purpose").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Verify token's attempt must belong to the SAME account_email (D1E-7).
  attemptFk: foreignKey({
    columns: [t.pendingRegistrationId, t.accountEmailId],
    foreignColumns: [authPendingEmailRegistrations.id, authPendingEmailRegistrations.accountEmailId],
    name: "auth_email_tokens_attempt_fk",
  }).onDelete("cascade"),
  // One ACTIVE verify token per attempt (D1E-8) and one ACTIVE reset token per
  // email (D1E-9) — partial on the lifecycle flags only, never on now().
  oneActiveVerifyUq: uniqueIndex("auth_email_tokens_one_active_verify_per_attempt_uq")
    .on(t.pendingRegistrationId)
    .where(sql`${t.purpose} = 'verify_email' AND ${t.consumedAt} IS NULL AND ${t.supersededAt} IS NULL`),
  oneActiveResetUq: uniqueIndex("auth_email_tokens_one_active_reset_uq")
    .on(t.accountEmailId, t.purpose)
    .where(sql`${t.purpose} = 'password_reset' AND ${t.consumedAt} IS NULL AND ${t.supersededAt} IS NULL`),
  expiresIdx: index("auth_email_tokens_expires_at_idx").on(t.expiresAt),
  // Non-partial index on the composite FK's referencing columns so a retention
  // delete of a (terminal) pending attempt does not full-scan this child table.
  pendingFkIdx: index("auth_email_tokens_pending_fk_idx").on(
    t.pendingRegistrationId,
    t.accountEmailId,
  ),
  // Non-partial FK index for the account_email -> tokens ON DELETE CASCADE.
  accountEmailIdx: index("auth_email_tokens_account_email_idx").on(t.accountEmailId),
  purposeChk: check("auth_email_tokens_purpose_chk",
    sql`${t.purpose} IN ('verify_email','password_reset')`),
  terminalChk: check("auth_email_tokens_terminal_chk",
    sql`${t.consumedAt} IS NULL OR ${t.supersededAt} IS NULL`),
  purposeRegChk: check("auth_email_tokens_purpose_reg_chk", sql`
    (${t.purpose} = 'verify_email' AND ${t.pendingRegistrationId} IS NOT NULL)
    OR (${t.purpose} = 'password_reset' AND ${t.pendingRegistrationId} IS NULL)`),
}));

// Dark delivery ledger. command_id is the public command-receipt fence;
// provider_idempotency_key is a SEPARATE persisted upstream-send key (§3.4,
// D1E-19). token_id → auth_email_tokens ON DELETE SET NULL (added after the
// token table in the SQL; here it is a plain reference).
export const authEmailDeliveries = pgTable("auth_email_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").notNull(),
  tokenId: uuid("token_id").references(() => authEmailTokens.id, { onDelete: "set null" }),
  payloadEnc: bytea("payload_enc"),
  kmsKeyVersion: text("kms_key_version"),
  commandId: uuid("command_id").notNull().unique(),
  commandOwnerHash: text("command_owner_hash").notNull(),
  commandOperation: text("command_operation").notNull(),
  commandTargetFingerprint: text("command_target_fingerprint").notNull(),
  providerIdempotencyKey: text("provider_idempotency_key").notNull().unique(),
  providerKeyVersion: text("provider_key_version").notNull(),
  outcome: text("outcome").notNull(),
  enqueuedAt: timestamp("enqueued_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
  lastErrorClass: text("last_error_class"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  expiresIdx: index("auth_email_deliveries_expires_idx").on(t.expiresAt),
  terminalIdx: index("auth_email_deliveries_terminal_idx")
    .on(t.terminalAt).where(sql`${t.terminalAt} IS NOT NULL`),
  dispatchIdx: index("auth_email_deliveries_dispatch_idx")
    .on(t.createdAt).where(sql`${t.outcome} = 'queued' AND ${t.enqueuedAt} IS NULL`),
  // FK index so a token delete can find the delivery rows to ON DELETE SET NULL.
  tokenIdIdx: index("auth_email_deliveries_token_id_idx")
    .on(t.tokenId).where(sql`${t.tokenId} IS NOT NULL`),
  kindChk: check("auth_email_deliveries_kind_chk",
    sql`${t.kind} IN ('verify_email','password_reset')`),
  operationChk: check("auth_email_deliveries_operation_chk",
    sql`${t.commandOperation} IN ('register','verify_resend','forgot')`),
  outcomeChk: check("auth_email_deliveries_outcome_chk",
    sql`${t.outcome} IN ('queued','delivered','noop','dead_letter','failed_terminal')`),
  // queued is the only non-terminal outcome (D1E-19).
  terminalChk: check("auth_email_deliveries_terminal_chk", sql`
    (${t.outcome} = 'queued' AND ${t.terminalAt} IS NULL)
    OR (${t.outcome} IN ('delivered','noop','dead_letter','failed_terminal') AND ${t.terminalAt} IS NOT NULL)`),
  // ciphertext/key live only while replayable (queued|dead_letter) (D1E-19).
  payloadChk: check("auth_email_deliveries_payload_chk", sql`
    (${t.outcome} IN ('queued','dead_letter') AND ${t.payloadEnc} IS NOT NULL AND ${t.kmsKeyVersion} IS NOT NULL)
    OR (${t.outcome} IN ('delivered','noop','failed_terminal') AND ${t.payloadEnc} IS NULL AND ${t.kmsKeyVersion} IS NULL)`),
  operationKindChk: check("auth_email_deliveries_operation_kind_chk", sql`
    (${t.commandOperation} IN ('register','verify_resend') AND ${t.kind} = 'verify_email')
    OR (${t.commandOperation} = 'forgot' AND ${t.kind} = 'password_reset')`),
}));

/**
 * Cross-site OAuth transaction store (D1, migration 0017 — order-3). One
 * protected row per started Google (later Facebook) redirect flow: `state_hash`
 * travels in the authorization URL, `browser_binding_hash` lives only in the
 * path-scoped Lax cookie, and a Google row also carries `nonce_hash` + the S256
 * PKCE verifier CIPHERTEXT (`pkce_verifier_enc` bytea, NEVER plaintext) with its
 * own `kms_key_version`. FUNCTION-ONLY: `app` has ZERO grant — issue/claim run
 * only inside the SECURITY DEFINER functions in 0017. Distinct from the live
 * `oauth_transactions` channel-bootstrap table. Lifecycle CHECKs mirror
 * auth_email_deliveries (consume ⇒ terminal; verifier/key NULLed at terminal).
 */
export const authOauthTransactions = pgTable("auth_oauth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  provider: text("provider").notNull(),
  browserBindingHash: text("browser_binding_hash").notNull(),
  nonceHash: text("nonce_hash"),
  pkceVerifierEnc: bytea("pkce_verifier_enc"),
  kmsKeyVersion: text("kms_key_version"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  terminalAt: timestamp("terminal_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  // auth-s4-d1b completion hop (migration 0018): the callback resolves the
  // account under full OIDC proof but cannot mint (Strict cookie absent
  // cross-site), so it ARMS a one-time handoff on this row; the same-site
  // /complete POST consumes it and runs issueSession(). Single-use is the
  // durable server-side fence (handoff_consumed_at), never a cookie signature.
  resolvedAccountId: uuid("resolved_account_id").references(() => accounts.id),
  handoffHash: text("handoff_hash"),
  handoffExpiresAt: timestamp("handoff_expires_at", { withTimezone: true }),
  handoffConsumedAt: timestamp("handoff_consumed_at", { withTimezone: true }),
}, (t) => ({
  // PARTIAL sweep indexes matching the two traffic-path sweep predicates
  // (terminalize expired-nonterminal / retention-delete terminal) — codex round-02.
  expiryIdx: index("auth_oauth_transactions_expiry_idx")
    .on(t.expiresAt).where(sql`${t.terminalAt} IS NULL`),
  terminalIdx: index("auth_oauth_transactions_terminal_idx")
    .on(t.terminalAt).where(sql`${t.terminalAt} IS NOT NULL`),
  providerChk: check("auth_oauth_transactions_provider_check",
    sql`${t.provider} IN ('google','facebook')`),
  // consume always terminalizes (D1-3).
  consumedTerminalChk: check("auth_oauth_transactions_consumed_terminal_chk",
    sql`${t.consumedAt} IS NULL OR ${t.terminalAt} IS NOT NULL`),
  // Google carries nonce+verifier+key while live, NULLs verifier+key at terminal
  // (D1-12); Facebook (future) is unconstrained by this CHECK.
  googleLifecycleChk: check("auth_oauth_transactions_google_lifecycle_chk", sql`
    ${t.provider} <> 'google'
    OR (${t.terminalAt} IS NULL
        AND ${t.nonceHash} IS NOT NULL AND ${t.pkceVerifierEnc} IS NOT NULL AND ${t.kmsKeyVersion} IS NOT NULL)
    OR (${t.terminalAt} IS NOT NULL
        AND ${t.pkceVerifierEnc} IS NULL AND ${t.kmsKeyVersion} IS NULL)`),
  // Completion-handoff lifecycle (0018): arming sets account+hash+expiry
  // together; a consumed handoff must have been armed first.
  handoffArmedChk: check("auth_oauth_transactions_handoff_armed_chk",
    sql`${t.handoffHash} IS NULL
        OR (${t.resolvedAccountId} IS NOT NULL AND ${t.handoffExpiresAt} IS NOT NULL)`),
  handoffConsumedChk: check("auth_oauth_transactions_handoff_consumed_chk",
    sql`${t.handoffConsumedAt} IS NULL OR ${t.handoffHash} IS NOT NULL`),
  // Consume lookup by handoff_hash; UNIQUE (partial) forbids hash reuse.
  handoffIdx: uniqueIndex("auth_oauth_transactions_handoff_idx")
    .on(t.handoffHash).where(sql`${t.handoffHash} IS NOT NULL`),
}));

export const magicLinks = pgTable("magic_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  hash: text("hash").notNull().unique(),
  personId: uuid("person_id").notNull().references(() => persons.id),
  channel: text("channel").notNull(),
  sessionId: uuid("session_id").references(() => webSessions.id),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  hashIdx: index("idx_magic_links_hash").on(t.hash).where(sql`${t.usedAt} IS NULL`),
}));

/* ===========================================================================
 * TENANT root + core
 * ======================================================================== */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  status: text("status").notNull().default("trialing"),
  locale: text("locale").notNull().default("vi"),
  timezone: text("timezone").notNull().default("Asia/Ho_Chi_Minh"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusChk: check("tenants_status_chk",
    sql`${t.status} IN ('trialing','active','past_due','suspended','cancelled')`),
  // 0039 (audit 2026-09-06 W-8): the route trims + rejects empty; the DB bounds the length.
  nameLenChk: check("tenants_name_len_chk", sql`char_length(${t.name}) BETWEEN 1 AND 120`),
}));

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  personId: uuid("person_id").notNull().references(() => persons.id),
  displayName: text("display_name"),
  payCode: text("pay_code"),
  status: text("status").notNull().default("active"), // active|guest|left|merged
  // Self-referencing single-column FK exists in SQL since 0002
  // (memberships_merged_into_membership_id_fkey); the Drizzle mirror had
  // drifted (no .references) and is fixed as part of 0021's non-money tenant
  // binding — the same class of drift 0020 fixed on
  // payment_allocations.reversesAllocationId.
  mergedIntoMembershipId: uuid("merged_into_membership_id")
    .references((): AnyPgColumn => memberships.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activePersonUq: uniqueIndex("memberships_active_person_unique")
    .on(t.tenantId, t.personId).where(sql`${t.status} IN ('active','guest')`),
  payCodeUq: uniqueIndex("memberships_tenant_paycode_unique")
    .on(t.tenantId, t.payCode).where(sql`${t.payCode} IS NOT NULL`),
  statusChk: check("memberships_status_chk",
    sql`${t.status} IN ('active','guest','left','merged')`),
  // DD-68 (migration 0019): candidate key that the same-tenant composite FKs
  // (players/charges/aliases → memberships) target. id is already the PK, so
  // UNIQUE (tenant_id, id) is a strict-superset uniqueness — additive, cannot
  // reject any existing row.
  tenantIdCandidateKey: unique("memberships_tenant_id_candidate_key").on(t.tenantId, t.id),
  // dd38-dd86-chat-schema-core (migration 0031, codex round-01 [P2]): candidate key the chat
  // schema's own composite FKs (chat_channels/chat_members/chat_messages -> memberships) target.
  // id is already the PK, so this is a strict-superset uniqueness -- additive, cannot reject any
  // existing row.
  idPersonTenantUq: unique("memberships_id_person_tenant_uq").on(t.id, t.personId, t.tenantId),
  // Non-money tenant-integrity (migration 0021): same-tenant self-referencing
  // composite FK, additive over the single-column FK above. Nullable (set
  // only when status='merged') — MATCH SIMPLE (the PostgreSQL default) leaves
  // the composite unenforced while NULL, enforced the moment a merge sets it,
  // binding the merge target to the SAME tenant.
  tenantMergedIntoFk: foreignKey({
    columns: [t.tenantId, t.mergedIntoMembershipId],
    foreignColumns: [t.tenantId, t.id],
    name: "memberships_tenant_merged_into_fk",
  }),
}));

export const aliases = pgTable("aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  aliasNorm: text("alias_norm").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("aliases_tenant_norm_uq").on(t.tenantId, t.aliasNorm),
  // DD-68 (migration 0019): same-tenant composite FK. Additive — the single-
  // column aliases_membership_id_fkey (0002) stays and still governs ON DELETE.
  tenantMembershipFk: foreignKey({
    columns: [t.tenantId, t.membershipId],
    foreignColumns: [memberships.tenantId, memberships.id],
    name: "aliases_tenant_membership_fk",
  }),
}));

export const channelReachability = pgTable("channel_reachability", {
  personId: uuid("person_id").notNull().references(() => persons.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  platform: text("platform").notNull(),
  canDm: boolean("can_dm").notNull().default(false),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  windowExpiresAt: timestamp("window_expires_at", { withTimezone: true }),
  otnTokenEnc: bytea("otn_token_enc"),
}, (t) => ({
  pk: primaryKey({ columns: [t.personId, t.tenantId, t.platform] }),
}));

export const settings = pgTable("settings", {
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  key: text("key").notNull(),
  value: jsonb("value").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.tenantId, t.key] }),
}));

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sportId: uuid("sport_id").notNull().references(() => sports.id),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  timezone: text("timezone").notNull(),
  venueName: text("venue_name"),
  venueAddress: text("venue_address"),
  area: text("area"),
  skillLevel: text("skill_level"),
  priceAmount: integer("price_amount").notNull().default(0),
  slotsMax: integer("slots_max"),
  visibility: text("visibility").notNull().default("private"),
  joinPolicy: text("join_policy").notNull().default("open"),
  status: text("status").notNull().default("draft"),
  version: integer("version").notNull().default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // 0044: host toggle for SES-UC-16 invite-friend (future InviteFriend command).
  // Declared LAST to match the physical column order 0044's ALTER TABLE ADD
  // COLUMN produces.
  allowPlayerInvite: boolean("allow_player_invite").notNull().default(true),
}, (t) => ({
  tenantStatusIdx: index("idx_sessions_tenant_status").on(t.tenantId, t.status),
  startsIdx: index("idx_sessions_starts_at").on(t.startsAt).where(sql`${t.status} = 'open'`),
  timeChk: check("sessions_time_chk", sql`${t.endsAt} > ${t.startsAt}`),
  priceChk: check("sessions_price_chk", sql`${t.priceAmount} >= 0`),
  slotsChk: check("sessions_slots_chk", sql`${t.slotsMax} IS NULL OR ${t.slotsMax} > 0`),
  visChk: check("sessions_vis_chk", sql`${t.visibility} IN ('private','public')`),
  // 0024: a public session must have finite capacity — NULL (unlimited) stays valid for non-public only.
  publicCapacityChk: check(
    "sessions_public_capacity_chk",
    sql`NOT (${t.visibility} = 'public' AND ${t.slotsMax} IS NULL)`,
  ),
  joinChk: check("sessions_join_chk", sql`${t.joinPolicy} IN ('open','approval')`),
  statusChk: check("sessions_status_chk",
    sql`${t.status} IN ('draft','open','closed','cancelled')`),
  // DD-68 (migration 0019): candidate key that the same-tenant composite FKs
  // (session_surface_refs/players/charges/join_requests → sessions) target.
  // id is already the PK, so this strict-superset UNIQUE is additive.
  tenantIdCandidateKey: unique("sessions_tenant_id_candidate_key").on(t.tenantId, t.id),
}));

export const sessionRecurrenceRules = pgTable("session_recurrence_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  rrule: text("rrule").notNull(),
  timezone: text("timezone").notNull(),
  version: integer("version").notNull().default(1),
  lastGeneratedAt: timestamp("last_generated_at", { withTimezone: true }),
});

export const sessionOccurrences = pgTable("session_occurrences", {
  id: uuid("id").primaryKey().defaultRandom(),
  recurrenceRuleId: uuid("recurrence_rule_id").notNull()
    .references(() => sessionRecurrenceRules.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  localOccurrenceKey: text("local_occurrence_key").notNull(),
}, (t) => ({
  uq: uniqueIndex("session_occ_uq").on(t.recurrenceRuleId, t.localOccurrenceKey),
}));

export const sessionSurfaceRefs = pgTable("session_surface_refs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  platform: text("platform").notNull(),
  target: text("target").notNull(),
  externalRef: text("external_ref"),
}, (t) => ({
  uq: uniqueIndex("session_surface_refs_uq").on(t.sessionId, t.platform, t.target),
  sessionIdx: index("idx_session_surface_refs_session").on(t.sessionId),
  // DD-68 (migration 0019): same-tenant composite FK, additive over the single-
  // column session_surface_refs_session_id_fkey (0002).
  tenantSessionFk: foreignKey({
    columns: [t.tenantId, t.sessionId],
    foreignColumns: [sessions.tenantId, sessions.id],
    name: "session_surface_refs_tenant_session_fk",
  }),
}));

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  status: text("status").notNull().default("active"), // active|left|waitlisted (DD-45)
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
  // DD-45 queue rank. Set ONLY while status='waitlisted'; promotion/leave must
  // clear it in the same statement that changes status. Total order is
  // (waitlist_position, joined_at, id); ranks are non-contiguous by contract
  // (tail assignment is max(position)+1 under the session lock, and DD-42
  // deprioritize reuses that rule). Declared LAST to match the physical column
  // order 0014's ALTER TABLE ADD COLUMN produces.
  waitlistPosition: integer("waitlist_position"),
  // 0044: NULL = self-join; non-NULL = invited by another player (SES-UC-16).
  // Declared LAST to match 0044's ALTER TABLE ADD COLUMN physical order.
  invitedByPersonId: uuid("invited_by_person_id").references(() => persons.id),
}, (t) => ({
  uq: uniqueIndex("players_tenant_session_member_uq")
    .on(t.tenantId, t.sessionId, t.membershipId),
  sessionIdx: index("idx_players_session").on(t.sessionId),
  statusChk: check("players_status_chk", sql`${t.status} IN ('active','left','waitlisted')`),
  // Equivalence: waitlisted <=> has a position. Makes a half-written
  // status/position pair unrepresentable (migration 0014).
  waitlistShapeChk: check("players_waitlist_shape_chk",
    sql`(${t.status} = 'waitlisted') = (${t.waitlistPosition} IS NOT NULL)`),
  waitlistPositionPositiveChk: check("players_waitlist_position_positive_chk",
    sql`${t.waitlistPosition} IS NULL OR ${t.waitlistPosition} > 0`),
  // Mirrors the promotion query: WHERE session_id AND status='waitlisted'
  // ORDER BY waitlist_position, joined_at, id FOR UPDATE.
  waitlistOrderIdx: index("idx_players_waitlist_order")
    .on(t.sessionId, t.status, t.waitlistPosition, t.joinedAt, t.id),
  // 0044: NULL = self-join; non-NULL = invited by another player (SES-UC-16).
  invitedByIdx: index("idx_players_invited_by")
    .on(t.invitedByPersonId)
    .where(sql`${t.invitedByPersonId} IS NOT NULL`),
  // DD-68 (migration 0019): candidate key targeted by the same-tenant composite
  // FK charges.player_id -> players. id is already the PK, so this is additive.
  tenantIdCandidateKey: unique("players_tenant_id_candidate_key").on(t.tenantId, t.id),
  // 0039 (audit D-12): candidate key so charges can bind (tenant, session, player) at once.
  tenantSessionCandidateKey: unique("players_tenant_session_candidate_key")
    .on(t.tenantId, t.sessionId, t.id),
  // DD-68 (migration 0019): same-tenant composite FKs, additive over the single-
  // column players_session_id_fkey / players_membership_id_fkey (0002). Both
  // referencing columns are NOT NULL, so the tenant match is always enforced.
  tenantSessionFk: foreignKey({
    columns: [t.tenantId, t.sessionId],
    foreignColumns: [sessions.tenantId, sessions.id],
    name: "players_tenant_session_fk",
  }),
  tenantMembershipFk: foreignKey({
    columns: [t.tenantId, t.membershipId],
    foreignColumns: [memberships.tenantId, memberships.id],
    name: "players_tenant_membership_fk",
  }),
}));

// 0044: SES-UC-16/17 guest notes (host session, player-authored note for a
// non-member guest). created_by_person_id references persons directly (not
// players/memberships) — the DDL has no membership requirement at the DB
// layer; "must be an active player of this session" is a service-layer check
// (Milestone 3b, not this migration).
export const sessionGuestNotes = pgTable("session_guest_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => persons.id),
  guestName: text("guest_name").notNull(),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  sessionIdx: index("idx_session_guest_notes_session").on(t.sessionId, t.createdByPersonId),
  // Constraint names match the BE spec's DDL verbatim (feature_session_management_tech.md
  // §2, lines 144-177) — not this file's usual table-prefixed _chk convention.
  guestNameLengthChk: check("guest_name_length",
    sql`char_length(${t.guestName}) BETWEEN 1 AND 100`),
  noteLengthChk: check("note_length",
    sql`${t.note} IS NULL OR char_length(${t.note}) <= 200`),
  // DD-68 pattern (migration 0019 precedent): same-tenant composite FK so a
  // row's session_id cannot belong to a different tenant than its own
  // tenant_id — RLS alone does not stop this (FK checks are not RLS-filtered).
  // Added inline since this table is new/empty in 0044 (no NOT VALID needed).
  tenantSessionFk: foreignKey({
    columns: [t.tenantId, t.sessionId],
    foreignColumns: [sessions.tenantId, sessions.id],
    name: "session_guest_notes_tenant_session_fk",
  }),
}));

export const telegramLinks = pgTable("telegram_links", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  chatId: bigint("chat_id", { mode: "bigint" }).notNull(),
  kind: text("kind").notNull().default("group"),
  active: boolean("active").notNull().default(true),
  linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  linkedBy: uuid("linked_by").references(() => persons.id),
}, (t) => ({
  chatUq: uniqueIndex("idx_telegram_links_chat").on(t.chatId).where(sql`${t.active} = true`),
  kindChk: check("telegram_links_kind_chk", sql`${t.kind} IN ('group','channel','admin')`),
}));

export const tenantAdmins = pgTable("tenant_admins", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  platform: text("platform").notNull().default("telegram"),
  platformUserLookupHash: text("platform_user_lookup_hash").notNull(),
  role: text("role").notNull().default("admin"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("idx_tenant_admins_unique")
    .on(t.tenantId, t.platform, t.platformUserLookupHash).where(sql`${t.active} = true`),
  lookupIdx: index("idx_tenant_admins_lookup")
    .on(t.platform, t.platformUserLookupHash).where(sql`${t.active} = true`),
  roleChk: check("tenant_admins_role_chk", sql`${t.role} IN ('owner','admin','co_admin')`),
}));

export const tenantLinkCodes = pgTable("tenant_link_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  codeLookupHash: text("code_lookup_hash").notNull().unique(),
  codeHash: text("code_hash").notNull(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  intendedRole: text("intended_role").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
});

export const playerChatContext = pgTable("player_chat_context", {
  personId: uuid("person_id").notNull().references(() => persons.id),
  platform: text("platform").notNull().default("telegram"),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.personId, t.platform] }),
}));

export const routingAudit = pgTable("routing_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  action: text("action").notNull(),
  actorId: uuid("actor_id"),
  tenantId: uuid("tenant_id"),
  detail: jsonb("detail"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ===========================================================================
 * Chat DM safety authority (GLOBAL protected, DD-55, migration 0030)
 * Cross-tenant, person-scoped — no RLS, zero grant to app/readonly. Reached
 * only through chat_definer-owned SECURITY DEFINER functions
 * (dm_safety_enabled/chat_pair_blocked/assert_dm_allowed), same model as
 * persons/accounts above.
 *
 * No chat_dm_safety_audit table (owner-amended 2026-08-05): an INSERT
 * immediately before RAISE EXCEPTION in the same statement can never
 * persist — PL/pgSQL's exception handling is savepoint-rollback-based, so
 * the RAISE unconditionally undoes it. assert_dm_allowed() emits RAISE LOG
 * instead (see the migration's own comment); a queryable table is a
 * separate, deferred follow-up (backlog: chat-dm-safety-audit-queryable-path).
 * ======================================================================== */

export const chatDmSafetyConfig = pgTable("chat_dm_safety_config", {
  singleton: boolean("singleton").primaryKey().default(true),
  // All four default false (codex round-02 [P1]): an enablement gate, not a
  // guessed-safe default — see the migration's own comment for the full
  // reasoning. assert_dm_allowed() denies with safety_disabled until an
  // explicit UPDATE turns each on.
  blockEnabled: boolean("block_enabled").notNull().default(false),
  reportEnabled: boolean("report_enabled").notNull().default(false),
  rateLimitEnabled: boolean("rate_limit_enabled").notNull().default(false),
  auditEnabled: boolean("audit_enabled").notNull().default(false),
  dmSenderLimitPerMin: integer("dm_sender_limit_per_min").notNull().default(30),
  dmTargetLimitPerMin: integer("dm_target_limit_per_min").notNull().default(30),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  singletonChk: check("chat_dm_safety_config_singleton_chk", sql`${t.singleton}`),
  senderLimitPositiveChk: check("chat_dm_safety_config_sender_limit_positive_chk",
    sql`${t.dmSenderLimitPerMin} > 0`),
  targetLimitPositiveChk: check("chat_dm_safety_config_target_limit_positive_chk",
    sql`${t.dmTargetLimitPerMin} > 0`),
}));

export const chatBlocks = pgTable("chat_blocks", {
  blockerPersonId: uuid("blocker_person_id").notNull().references(() => persons.id),
  blockedPersonId: uuid("blocked_person_id").notNull().references(() => persons.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.blockerPersonId, t.blockedPersonId] }),
  noSelfChk: check("chat_blocks_no_self_chk", sql`${t.blockerPersonId} <> ${t.blockedPersonId}`),
}));

export const chatReports = pgTable("chat_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  reporterPersonId: uuid("reporter_person_id").notNull().references(() => persons.id),
  reportedPersonId: uuid("reported_person_id").notNull().references(() => persons.id),
  reasonCode: text("reason_code").notNull(),
  note: text("note"),
  status: text("status").notNull().default("submitted"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  reasonCodeChk: check("chat_reports_reason_code_chk",
    sql`${t.reasonCode} IN ('spam','harassment','unsafe','off_topic','other')`),
  statusChk: check("chat_reports_status_chk",
    sql`${t.status} IN ('submitted','triaged','actioned','closed')`),
  noSelfChk: check("chat_reports_no_self_chk", sql`${t.reporterPersonId} <> ${t.reportedPersonId}`),
  // Reused DD-95 taxonomy: 'other' requires a bounded note, every non-other rejects one.
  // Raw length(note) <= 500 bounds the STORED value (codex round-02 [P2] — trimmed-only would
  // let a padded note store far more than 500 chars); trimmed length >= 1 rejects whitespace-only.
  noteShapeChk: check("chat_reports_note_shape_chk",
    sql`(${t.reasonCode} = 'other' AND ${t.note} IS NOT NULL AND length(${t.note}) <= 500 AND length(btrim(${t.note})) >= 1)
        OR (${t.reasonCode} <> 'other' AND ${t.note} IS NULL)`),
}));

/* ===========================================================================
 * Chat content (DD-38/DD-86, migration 0031 — dd38-dd86-chat-schema-core)
 * RLS FORCE on all three; app has SELECT only, zero mutation grant (mutation
 * RPCs are later slices). Declared channels -> messages -> members (not the
 * conceptual channels -> members -> messages reading order) because
 * chat_members' own cross-table FK targets chat_messages, and JS evaluates
 * these top-to-bottom.
 * ======================================================================== */

const tsvectorType = customType<{ data: string }>({ dataType: () => "tsvector" });

export const chatChannels = pgTable("chat_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").references(() => tenants.id),
  kind: text("kind").notNull(),
  dmKey: text("dm_key"),
  title: text("title"),
  isDefault: boolean("is_default"),
  sortOrder: integer("sort_order"),
  createdByMembershipId: uuid("created_by_membership_id"),
  createdByPersonId: uuid("created_by_person_id"),
  creationOrigin: text("creation_origin"),
  postPolicy: text("post_policy"),
  assistantEnabled: boolean("assistant_enabled"),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  kindChk: check("chat_channels_kind_chk", sql`${t.kind} IN ('club','dm')`),
  shapeChk: check("chat_channels_shape_chk", sql`
    (${t.kind} = 'club'
      AND ${t.tenantId} IS NOT NULL AND ${t.dmKey} IS NULL
      AND ${t.title} IS NOT NULL AND ${t.isDefault} IS NOT NULL AND ${t.sortOrder} IS NOT NULL
      AND ${t.creationOrigin} IS NOT NULL AND ${t.creationOrigin} IN ('actor','system_bootstrap')
      AND ${t.postPolicy} IS NOT NULL AND ${t.postPolicy} IN ('all_members','admins_only')
      AND ${t.assistantEnabled} IS NOT NULL)
    OR
    (${t.kind} = 'dm'
      AND ${t.tenantId} IS NULL AND ${t.dmKey} IS NOT NULL
      AND ${t.title} IS NULL AND ${t.isDefault} IS NULL AND ${t.sortOrder} IS NULL
      AND ${t.createdByMembershipId} IS NULL AND ${t.createdByPersonId} IS NULL
      AND ${t.creationOrigin} IS NULL
      AND ${t.postPolicy} IS NULL AND ${t.assistantEnabled} IS NULL)
  `),
  createdByPairChk: check("chat_channels_created_by_pair_chk",
    sql`(${t.createdByMembershipId} IS NULL) = (${t.createdByPersonId} IS NULL)`),
  creationOriginChk: check("chat_channels_creation_origin_chk", sql`
    ${t.kind} <> 'club'
    OR (${t.creationOrigin}='actor' AND ${t.createdByMembershipId} IS NOT NULL)
    OR (${t.creationOrigin}='system_bootstrap' AND ${t.createdByMembershipId} IS NULL)
  `),
  createdByMembershipFk: foreignKey({
    columns: [t.createdByMembershipId, t.createdByPersonId, t.tenantId],
    foreignColumns: [memberships.id, memberships.personId, memberships.tenantId],
    name: "chat_channels_created_by_membership_fk",
  }),
  dmKeyUq: unique("chat_channels_dm_key_uq").on(t.dmKey),
  idTenantUq: unique("chat_channels_id_tenant_uq").on(t.id, t.tenantId),
  defaultUq: uniqueIndex("chat_channels_default_uq")
    .on(t.tenantId)
    .where(sql`${t.kind}='club' AND ${t.isDefault} IS TRUE AND ${t.archivedAt} IS NULL`),
}));

export const chatMessages = pgTable("chat_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  channelId: uuid("channel_id").notNull().references(() => chatChannels.id),
  tenantId: uuid("tenant_id"),
  authorType: text("author_type").notNull().default("person"),
  authorPersonId: uuid("author_person_id").references(() => persons.id),
  membershipId: uuid("membership_id"),
  body: text("body").notNull(),
  replyToMessageId: uuid("reply_to_message_id"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  editCount: smallint("edit_count").notNull().default(0),
  authorDeletedAt: timestamp("author_deleted_at", { withTimezone: true }),
  moderationState: text("moderation_state").notNull().default("visible"),
  moderationUpdatedAt: timestamp("moderation_updated_at", { withTimezone: true }),
  moderationActorPersonId: uuid("moderation_actor_person_id").references(() => persons.id),
  moderationReasonCode: text("moderation_reason_code"),
  clientMsgId: text("client_msg_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  searchDocument: tsvectorType("search_document").generatedAlwaysAs(
    sql`to_tsvector('simple'::regconfig, coalesce(body, ''))`,
  ),
}, (t) => ({
  channelClientMsgUq: unique("chat_messages_channel_client_msg_uq").on(t.channelId, t.clientMsgId),
  channelIdUq: unique("chat_messages_channel_id_uq").on(t.channelId, t.id),
  channelCreatedAtIdUq: unique("chat_messages_channel_created_at_id_uq")
    .on(t.channelId, t.createdAt, t.id),
  channelTenantFk: foreignKey({
    columns: [t.channelId, t.tenantId],
    foreignColumns: [chatChannels.id, chatChannels.tenantId],
    name: "chat_messages_channel_tenant_fk",
  }),
  membershipFk: foreignKey({
    columns: [t.membershipId, t.authorPersonId, t.tenantId],
    foreignColumns: [memberships.id, memberships.personId, memberships.tenantId],
    name: "chat_messages_membership_fk",
  }),
  replyToFk: foreignKey({
    columns: [t.channelId, t.replyToMessageId],
    foreignColumns: [t.channelId, t.id],
    name: "chat_messages_reply_to_fk",
  }),
  authorTypeChk: check("chat_messages_author_type_chk",
    sql`${t.authorType} IN ('person','assistant','system')`),
  editCountChk: check("chat_messages_edit_count_chk", sql`${t.editCount} BETWEEN 0 AND 5`),
  moderationStateChk: check("chat_messages_moderation_state_chk",
    sql`${t.moderationState} IN ('visible','hidden')`),
  moderationReasonCodeChk: check("chat_messages_moderation_reason_code_chk", sql`
    ${t.moderationReasonCode} IS NULL
    OR ${t.moderationReasonCode} IN ('spam','harassment','unsafe','off_topic','other')
  `),
  replyNotSelfChk: check("chat_messages_reply_not_self_chk",
    sql`${t.replyToMessageId} IS NULL OR ${t.replyToMessageId} IS DISTINCT FROM ${t.id}`),
  moderationPairChk: check("chat_messages_moderation_pair_chk", sql`
    (${t.moderationState}='visible' AND ${t.moderationUpdatedAt} IS NULL
      AND ${t.moderationActorPersonId} IS NULL AND ${t.moderationReasonCode} IS NULL)
    OR
    (${t.moderationState}='hidden' AND ${t.moderationUpdatedAt} IS NOT NULL
      AND ${t.moderationActorPersonId} IS NOT NULL AND ${t.moderationReasonCode} IS NOT NULL)
  `),
  authorPersonRequiredChk: check("chat_messages_author_person_required_chk",
    sql`${t.authorType} <> 'person' OR ${t.authorPersonId} IS NOT NULL`),
  authorPersonNullChk: check("chat_messages_author_person_null_chk",
    sql`${t.authorType} = 'person' OR ${t.authorPersonId} IS NULL`),
  membershipNullChk: check("chat_messages_membership_null_chk",
    sql`${t.authorType} = 'person' OR ${t.membershipId} IS NULL`),
  membershipRequiredChk: check("chat_messages_membership_required_chk",
    sql`${t.authorType} <> 'person' OR ${t.tenantId} IS NULL OR ${t.membershipId} IS NOT NULL`),
  searchSimpleIdx: index("idx_chat_messages_search_simple")
    .using("gin", t.searchDocument)
    .where(sql`${t.moderationState}='visible' AND ${t.authorDeletedAt} IS NULL`),
}));

export const chatMembers = pgTable("chat_members", {
  channelId: uuid("channel_id").notNull().references(() => chatChannels.id),
  tenantId: uuid("tenant_id"),
  personId: uuid("person_id").notNull().references(() => persons.id),
  membershipId: uuid("membership_id"),
  role: text("role").notNull().default("member"),
  lastReadCreatedAt: timestamp("last_read_created_at", { withTimezone: true }),
  lastReadMessageId: uuid("last_read_message_id"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.channelId, t.personId] }),
  roleChk: check("chat_members_role_chk", sql`${t.role} IN ('member','admin')`),
  channelTenantFk: foreignKey({
    columns: [t.channelId, t.tenantId],
    foreignColumns: [chatChannels.id, chatChannels.tenantId],
    name: "chat_members_channel_tenant_fk",
  }),
  membershipFk: foreignKey({
    columns: [t.membershipId, t.personId, t.tenantId],
    foreignColumns: [memberships.id, memberships.personId, memberships.tenantId],
    name: "chat_members_membership_fk",
  }),
  lastReadMessageFk: foreignKey({
    columns: [t.channelId, t.lastReadCreatedAt, t.lastReadMessageId],
    foreignColumns: [chatMessages.channelId, chatMessages.createdAt, chatMessages.id],
    name: "chat_members_last_read_message_fk",
  }),
  tenantMembershipPairChk: check("chat_members_tenant_membership_pair_chk", sql`
    (${t.tenantId} IS NOT NULL AND ${t.membershipId} IS NOT NULL)
    OR (${t.tenantId} IS NULL AND ${t.membershipId} IS NULL)
  `),
  lastReadPairChk: check("chat_members_last_read_pair_chk",
    sql`(${t.lastReadCreatedAt} IS NULL) = (${t.lastReadMessageId} IS NULL)`),
}));

/* ===========================================================================
 * Payments ledger (TENANT-private, append-only)
 * ======================================================================== */

export const bankAccounts = pgTable("bank_accounts", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(),
  accountNumberEnc: bytea("account_number_enc").notNull(),
  accountFingerprint: text("account_fingerprint").notNull(),
  webhookToken: text("webhook_token").notNull().unique(),
  webhookSecretEnc: bytea("webhook_secret_enc").notNull(),
  active: boolean("active").notNull().default(true),
  pendingAccountNumberEnc: bytea("pending_account_number_enc"),
  pendingAccountHolder: text("pending_account_holder"),
  pendingChangeAt: timestamp("pending_change_at", { withTimezone: true }),
  pendingExpiresAt: timestamp("pending_expires_at", { withTimezone: true }),
  pendingChangeBy: uuid("pending_change_by"),
  stkChangeCount30d: integer("stk_change_count_30d").notNull().default(0),
  providerConnectionId: uuid("provider_connection_id"),
  providerWebhookId: text("provider_webhook_id"),
  providerBankRef: text("provider_bank_ref"),
  autoRegistered: boolean("auto_registered").notNull().default(false),
  webhookStatus: text("webhook_status").notNull().default("connecting"),
  lastRegisterAt: timestamp("last_register_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("bank_accounts_tenant_provider_fp_uq")
    .on(t.tenantId, t.provider, t.accountFingerprint),
  tenantIdx: index("idx_bank_accounts_tenant").on(t.tenantId),
  providerChk: check("bank_accounts_provider_chk", sql`${t.provider} IN ('sepay','apipay')`),
  webhookStatusChk: check("bank_accounts_webhook_status_chk",
    sql`${t.webhookStatus} IN ('connecting','registered','active','drift','error','revoked')`),
  // DD-68 (migration 0020): candidate key targeted by the same-tenant composite
  // FK bank_transactions -> bank_accounts. id is already the PK, so this
  // strict-superset UNIQUE is additive.
  tenantIdCandidateKey: unique("bank_accounts_tenant_id_candidate_key").on(t.tenantId, t.id),
  // DD-68 (migration 0020): same-tenant composite FK, additive over the single-
  // column FK added in 0004. provider_connection_id is NULLABLE (set during
  // connector onboarding) — MATCH SIMPLE leaves the composite unenforced while
  // NULL, enforced when set; the SQL migration spells MATCH SIMPLE out.
  tenantProviderConnectionFk: foreignKey({
    columns: [t.tenantId, t.providerConnectionId],
    foreignColumns: [providerConnections.tenantId, providerConnections.id],
    name: "bank_accounts_tenant_provider_connection_fk",
  }),
}));

export const charges = pgTable("charges", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  playerId: uuid("player_id").notNull().references(() => players.id),
  membershipId: uuid("membership_id").references(() => memberships.id),
  amountDue: integer("amount_due").notNull(),
  amountAllocated: integer("amount_allocated").notNull().default(0),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("charges_tenant_session_player_uq").on(t.tenantId, t.sessionId, t.playerId),
  tenantStatusIdx: index("idx_charges_tenant_status").on(t.tenantId, t.status),
  sessionIdx: index("idx_charges_session").on(t.sessionId),
  dueChk: check("charges_due_chk", sql`${t.amountDue} >= 0`),
  allocChk: check("charges_alloc_chk", sql`${t.amountAllocated} >= 0`),
  allocLeChk: check("charges_alloc_le_due_chk", sql`${t.amountAllocated} <= ${t.amountDue}`),
  statusChk: check("charges_status_chk", sql`${t.status} IN ('open','partial','paid','void')`),
  // DD-68 (migration 0019): same-tenant composite FKs, additive over the single-
  // column charges_session_id_fkey / charges_membership_id_fkey (0003). The
  // session leg is always enforced (tenant_id, session_id NOT NULL). The
  // membership leg is MATCH SIMPLE in the SQL — unenforced when membership_id is
  // NULL (charge without a membership), enforced when it is set. Drizzle emits
  // MATCH SIMPLE (the PostgreSQL default); the SQL migration spells it out.
  tenantSessionFk: foreignKey({
    columns: [t.tenantId, t.sessionId],
    foreignColumns: [sessions.tenantId, sessions.id],
    name: "charges_tenant_session_fk",
  }),
  tenantMembershipFk: foreignKey({
    columns: [t.tenantId, t.membershipId],
    foreignColumns: [memberships.tenantId, memberships.id],
    name: "charges_tenant_membership_fk",
  }),
  // charges.player_id (NOT NULL) -> players, same tenant. Without this a
  // B-tenant charge with a NULL membership could reference an A-tenant player
  // (codex round-01 [P1]).
  tenantPlayerFk: foreignKey({
    columns: [t.tenantId, t.playerId],
    foreignColumns: [players.tenantId, players.id],
    name: "charges_tenant_player_fk",
  }),
  // 0039 (audit 2026-09-06 D-12): the player must belong to charges.session_id, not merely to
  // the tenant — a charge for session S pointing at a player of session T is unrepresentable.
  tenantSessionPlayerFk: foreignKey({
    columns: [t.tenantId, t.sessionId, t.playerId],
    foreignColumns: [players.tenantId, players.sessionId, players.id],
    name: "charges_tenant_session_player_fk",
  }),
  // DD-68 (migration 0020): candidate key targeted by the same-tenant composite
  // FK payment_allocations.charge_id -> charges. Additive (id is the PK).
  tenantIdCandidateKey: unique("charges_tenant_id_candidate_key").on(t.tenantId, t.id),
}));

export const bankTransactions = pgTable("bank_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  bankAccountId: uuid("bank_account_id").notNull().references(() => bankAccounts.id),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  amount: integer("amount").notNull(),
  unallocatedAmount: integer("unallocated_amount").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  contentEnc: bytea("content_enc"),
  rawPayloadEnc: bytea("raw_payload_enc").notNull(),
  reconcileStatus: text("reconcile_status").notNull().default("pending"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("bank_txn_tenant_provider_extid_uq").on(t.tenantId, t.provider, t.externalId),
  reconcileIdx: index("idx_bank_txn_reconcile").on(t.tenantId, t.reconcileStatus),
  amountChk: check("bank_txn_amount_chk", sql`${t.amount} > 0`),
  unallocChk: check("bank_txn_unalloc_chk", sql`${t.unallocatedAmount} >= 0`),
  unallocLeChk: check("bank_txn_unalloc_le_chk", sql`${t.unallocatedAmount} <= ${t.amount}`),
  reconcileChk: check("bank_txn_reconcile_chk",
    sql`${t.reconcileStatus} IN ('pending','matched','partial','unmatched','ignored')`),
  // DD-68 (migration 0020): candidate key targeted by the same-tenant composite
  // FK payment_allocations.bank_transaction_id -> bank_transactions. Additive.
  tenantIdCandidateKey: unique("bank_transactions_tenant_id_candidate_key").on(t.tenantId, t.id),
  // DD-68 (migration 0020): same-tenant composite FK, additive over the single-
  // column bank_transactions_bank_account_id_fkey (0003). Both referencing
  // columns are NOT NULL, so the tenant match is always enforced.
  tenantBankAccountFk: foreignKey({
    columns: [t.tenantId, t.bankAccountId],
    foreignColumns: [bankAccounts.tenantId, bankAccounts.id],
    name: "bank_transactions_tenant_bank_account_fk",
  }),
}));

export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  bankTransactionId: uuid("bank_transaction_id").references(() => bankTransactions.id),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amount: integer("amount").notNull(), // signed; reversal negative
  source: text("source").notNull(),
  // Self-referencing single-column FK exists in SQL since 0003
  // (payment_allocations_reverses_allocation_id_fkey); the mirror had drifted
  // (no .references) and is fixed as part of 0020's ledger tenant binding.
  reversesAllocationId: uuid("reverses_allocation_id")
    .references((): AnyPgColumn => paymentAllocations.id),
  createdBy: uuid("created_by"),
  reasonCode: text("reason_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chargeIdx: index("idx_alloc_charge").on(t.chargeId),
  bankTxnIdx: index("idx_alloc_bank_txn").on(t.bankTransactionId),
  amountChk: check("alloc_amount_nonzero_chk", sql`${t.amount} <> 0`),
  sourceChk: check("alloc_source_chk", sql`${t.source} IN ('auto','manual','cash','waiver','reversal','attested_transfer')`),
  shapeChk: check("alloc_shape_chk", sql`
    (${t.source} IN ('auto','manual') AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NOT NULL)
    OR (${t.source} IN ('cash','waiver') AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NULL AND ${t.createdBy} IS NOT NULL)
    OR (${t.source} = 'attested_transfer' AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NULL AND ${t.createdBy} IS NOT NULL)
    OR (${t.source} = 'reversal' AND ${t.amount} < 0 AND ${t.reversesAllocationId} IS NOT NULL)`),
  // DD-68 (migration 0020): payment_allocations is BOTH child and parent (the
  // reversal self-reference), so it carries its own candidate key. Additive.
  tenantIdCandidateKey: unique("payment_allocations_tenant_id_candidate_key").on(t.tenantId, t.id),
  // DD-68 (migration 0020): same-tenant composite FKs, additive over the
  // single-column FKs from 0003. charge_id is NOT NULL (always enforced);
  // bank_transaction_id and reverses_allocation_id are NULLABLE — MATCH SIMPLE
  // (the PostgreSQL default; spelled out in the SQL migration) leaves each
  // composite unenforced while its fk column is NULL (cash/waiver allocation
  // without a bank transaction; non-reversal without a reversed allocation),
  // enforced the moment it is set.
  tenantChargeFk: foreignKey({
    columns: [t.tenantId, t.chargeId],
    foreignColumns: [charges.tenantId, charges.id],
    name: "payment_allocations_tenant_charge_fk",
  }),
  tenantBankTransactionFk: foreignKey({
    columns: [t.tenantId, t.bankTransactionId],
    foreignColumns: [bankTransactions.tenantId, bankTransactions.id],
    name: "payment_allocations_tenant_bank_transaction_fk",
  }),
  tenantReversesAllocationFk: foreignKey({
    columns: [t.tenantId, t.reversesAllocationId],
    foreignColumns: [t.tenantId, t.id],
    name: "payment_allocations_tenant_reverses_allocation_fk",
  }),
  // 0039 (audit 2026-09-06 D-12): a reversal must reverse an allocation of the SAME charge.
  // MATCH SIMPLE — unenforced while reverses_allocation_id is NULL (non-reversal rows).
  tenantChargeCandidateKey: unique("payment_allocations_tenant_charge_candidate_key")
    .on(t.tenantId, t.chargeId, t.id),
  reversalSameChargeFk: foreignKey({
    columns: [t.tenantId, t.chargeId, t.reversesAllocationId],
    foreignColumns: [t.tenantId, t.chargeId, t.id],
    name: "payment_allocations_reversal_same_charge_fk",
  }),
}));

/* ===========================================================================
 * Channels / connectors (TENANT-private; oauth_transactions GLOBAL bootstrap)
 * ======================================================================== */

export const providerConnections = pgTable("provider_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(),
  authMode: text("auth_mode").notNull(),
  accessTokenEnc: bytea("access_token_enc"),
  refreshTokenEnc: bytea("refresh_token_enc"),
  scope: text("scope"),
  tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
  apiAccessKeyEnc: bytea("api_access_key_enc"),
  apiSecretKeyEnc: bytea("api_secret_key_enc"),
  status: text("status").notNull().default("connecting"),
  lastErrorCode: text("last_error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("provider_connections_tenant_provider_uq").on(t.tenantId, t.provider),
  providerChk: check("provider_connections_provider_chk", sql`${t.provider} IN ('sepay','apipay')`),
  authChk: check("provider_connections_auth_chk", sql`${t.authMode} IN ('oauth2','api_key')`),
  statusChk: check("provider_connections_status_chk",
    sql`${t.status} IN ('connecting','registered','active','drift','error','revoked')`),
  // DD-68 (migration 0020): candidate key targeted by the same-tenant composite
  // FK bank_accounts.provider_connection_id -> provider_connections. Additive.
  tenantIdCandidateKey: unique("provider_connections_tenant_id_candidate_key").on(t.tenantId, t.id),
}));

export const oauthTransactions = pgTable("oauth_transactions", {
  state: text("state").primaryKey(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  provider: text("provider").notNull(),
  codeVerifierEnc: bytea("code_verifier_enc").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => ({
  // Legacy Sepay-only channel-bootstrap table, DISTINCT from
  // auth_oauth_transactions (Google/Facebook login). Single-literal predicate,
  // NOT the 6-value connecting|registered|active|drift|error|revoked enum
  // several sibling channel/connector tables share (design-probe.md pin 2).
  providerChk: check("oauth_transactions_provider_chk", sql`${t.provider} = 'sepay'`),
}));

export const zaloBots = pgTable("zalo_bots", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id).unique(),
  botTokenEnc: text("bot_token_enc").notNull(),
  webhookToken: text("webhook_token").notNull(),
  secret: text("secret"),
  status: text("status").notNull().default("connecting"),
  autoRegistered: boolean("auto_registered").notNull().default(false),
  rotationPending: boolean("rotation_pending").notNull().default(false),
  lastSetwebhookAt: timestamp("last_setwebhook_at", { withTimezone: true }),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  webhookTokenUq: uniqueIndex("idx_zalo_bots_webhook_token").on(t.webhookToken),
  statusChk: check("zalo_bots_status_chk",
    sql`${t.status} IN ('connecting','registered','active','drift','error','revoked')`),
  // Non-money tenant-integrity (migration 0021): candidate key targeted by the
  // same-tenant composite FK zalo_reply_contexts.bot_id -> zalo_bots. id is
  // already the PK, so this strict-superset UNIQUE is additive (tenant_id
  // alone is already unique from the column-level constraint above, but a
  // composite FK still requires a unique constraint on its exact column list).
  tenantIdCandidateKey: unique("zalo_bots_tenant_id_candidate_key").on(t.tenantId, t.id),
}));

export const zaloReplyContexts = pgTable("zalo_reply_contexts", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull().references(() => persons.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  botId: uuid("bot_id").notNull().references(() => zaloBots.id),
  contextType: text("context_type").notNull().default("session_list"),
  itemIds: jsonb("item_ids").notNull(),
  version: integer("version").notNull().default(1),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  // Non-money tenant-integrity (migration 0021): same-tenant composite FK,
  // additive over the single-column zalo_reply_contexts_bot_id_fkey (0004).
  // Both referencing columns are NOT NULL, so the tenant match is always
  // enforced.
  tenantBotFk: foreignKey({
    columns: [t.tenantId, t.botId],
    foreignColumns: [zaloBots.tenantId, zaloBots.id],
    name: "zalo_reply_contexts_tenant_bot_fk",
  }),
}));

export const messengerPages = pgTable("messenger_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id).unique(),
  pageId: text("page_id").notNull().unique(),
  pageTokenEnc: bytea("page_token_enc").notNull(),
  appSecretEnc: bytea("app_secret_enc"),
  status: text("status").notNull().default("connecting"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusChk: check("messenger_pages_status_chk",
    sql`${t.status} IN ('connecting','registered','active','drift','error','revoked')`),
}));

/* ===========================================================================
 * Sync engine
 * ======================================================================== */

export const processedCommands = pgTable("processed_commands", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  commandId: text("command_id").notNull(),
  commandType: text("command_type").notNull(),
  resultHash: text("result_hash"),
  resultRef: jsonb("result_ref"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("processed_commands_tenant_cmd_uq").on(t.tenantId, t.commandId),
}));

export const outboxEvents = pgTable("outbox_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  aggregateType: text("aggregate_type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  sequence: integer("sequence").notNull(),
  type: text("type").notNull(),
  schemaVersion: integer("schema_version").notNull().default(1),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
  // 0022: five-minute reclaimable lease — both-null (available) or both-non-null (leased).
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  // 0023: exact-match guard ack_outbox_event requires so a stale (already-superseded) claimant
  // cannot ack over the current one — mirrors projectorDeliveries.claimToken below. Part of the
  // same all-or-nothing triple as claimedAt/leaseExpiresAt (see leaseShapeChk).
  claimToken: uuid("claim_token"),
  // 0023: completion marker closing 0022:166-181's hard blocking requirement — set once by
  // ack_outbox_event, never cleared; claim_outbox_batch's reclaim/claim passes both skip acked rows.
  ackedAt: timestamp("acked_at", { withTimezone: true }),
}, (t) => ({
  aggSeqUq: uniqueIndex("outbox_agg_seq_uq").on(t.aggregateId, t.sequence),
  // 0022 replaced this index's definition (aggregate_id, sequence) -> (created_at); the claim
  // ordering itself is unchanged (ORDER BY created_at, preserved from 0010).
  unclaimedIdx: index("idx_outbox_unclaimed")
    .on(t.createdAt).where(sql`${t.claimedAt} IS NULL`),
  // 0023: narrowed to exclude acked rows so they stop accumulating here — the actual fix the
  // OAM-2 starvation regression proves (0022's original predicate had no acked_at to filter on).
  expiredLeaseIdx: index("idx_outbox_expired_lease")
    .on(t.leaseExpiresAt).where(sql`${t.claimedAt} IS NOT NULL AND ${t.ackedAt} IS NULL`),
  // 0023: extended from a pair to a strict triple (claimedAt/leaseExpiresAt/claimToken) — always
  // all-null (available) or all-non-null (leased) together, never partially set.
  leaseShapeChk: check(
    "outbox_events_lease_shape_chk",
    sql`(${t.claimedAt} IS NULL AND ${t.leaseExpiresAt} IS NULL AND ${t.claimToken} IS NULL) OR (${t.claimedAt} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL AND ${t.claimToken} IS NOT NULL)`,
  ),
  // 0023: acked implies claimed — the only writer of ackedAt is ack_outbox_event, which already
  // enforces this procedurally; this CHECK is cheap defense-in-depth, same philosophy as leaseShapeChk.
  ackShapeChk: check(
    "outbox_events_ack_shape_chk",
    sql`${t.ackedAt} IS NULL OR ${t.claimedAt} IS NOT NULL`,
  ),
  // 0022/0023: the untrusted `app` role must leave every lease/ack column NULL on its own
  // inserts/updates. Scoped to current_user != 'app' (not "= job_definer") so migration-role/
  // superuser direct ops stay unrestricted — CHECK constraints bind every writer, unlike
  // GRANT/RLS which superusers bypass.
  producerLeaseBoundaryChk: check(
    "outbox_events_producer_lease_boundary_chk",
    sql`current_user != 'app' OR (${t.claimedAt} IS NULL AND ${t.leaseExpiresAt} IS NULL AND ${t.claimToken} IS NULL AND ${t.ackedAt} IS NULL)`,
  ),
}));

export const projectorDeliveries = pgTable("projector_deliveries", {
  eventId: uuid("event_id").notNull().references(() => outboxEvents.id),
  projector: text("projector").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  providerRef: text("provider_ref"),
  errorCode: text("error_code"),
  // 0022: token-bound five-minute reclaimable lease, mirrors outbox_events above.
  claimToken: uuid("claim_token"),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
}, (t) => ({
  pk: primaryKey({ columns: [t.eventId, t.projector] }),
  pendingIdx: index("idx_projector_pending").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  // 0022: claim_projector_delivery_batch scopes both scans by `projector` first — neither
  // pre-existing index carried that column.
  claimableIdx: index("idx_projector_deliveries_claimable")
    .on(t.projector, t.eventId).where(sql`${t.status} IN ('pending', 'failed')`),
  claimedLeaseIdx: index("idx_projector_deliveries_claimed_lease")
    .on(t.projector, t.leaseExpiresAt).where(sql`${t.status} = 'claimed'`),
  // 0022: 'claimed' added between pending and delivered/failed/dlq (token-and-lease held).
  statusChk: check("projector_status_chk", sql`${t.status} IN ('pending','claimed','delivered','failed','dlq')`),
}));

// 0022: platform-plane, append-only job audit. job_id is always the authoritative outbox event
// id (canonical job identity at core), even for projector-delivery rows — no UNIQUE(job_id), a
// reclaimed event is legitimately audited more than once. Owned by job_definer; no runtime role
// gets a table grant; UPDATE/DELETE are trigger-rejected (forbid_job_audit_mutation, 0022).
export const jobAuditEvents = pgTable("job_audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id").notNull().references(() => outboxEvents.id),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actor: text("actor").notNull().default("system"),
  reason: text("reason").notNull(),
  fnName: text("fn_name").notNull(),
  operationId: uuid("operation_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  jobIdx: index("idx_job_audit_events_job_id").on(t.jobId),
  operationIdx: index("idx_job_audit_events_operation_id").on(t.operationId),
}));

export const surfaceRefs = pgTable("surface_refs", {
  id: uuid("id").primaryKey().defaultRandom(),
  aggregateId: uuid("aggregate_id").notNull(),
  platform: text("platform").notNull(),
  target: text("target").notNull(),
  externalRef: text("external_ref"),
}, (t) => ({
  uq: uniqueIndex("surface_refs_uq").on(t.aggregateId, t.platform, t.target),
  aggIdx: index("idx_surface_refs_aggregate").on(t.aggregateId),
}));

/* ===========================================================================
 * Discovery (PUBLIC read model) + cross-club join
 * ======================================================================== */

export const publicSessions = pgTable("public_sessions", {
  id: uuid("id").primaryKey(),            // = sessions.id
  sessionId: uuid("session_id").notNull(),
  tenantId: uuid("tenant_id").notNull(),  // internal routing only — never serialized
  sportKey: text("sport_key").notNull(),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  area: text("area").notNull(),
  skillLevel: text("skill_level"),
  priceAmount: integer("price_amount").notNull(),
  slotsOpen: integer("slots_open").notNull(),
  clubDisplayName: text("club_display_name").notNull(),
  hostDisplayName: text("host_display_name"),
  joinPolicy: text("join_policy").notNull(),
  projectedAt: timestamp("projected_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // control metadata (non-PII) — the sole whitelist-exception column DD-73
  // permits in the guarded public view; DD-78 authorization-before-cache key.
  // Added by 0033_public_projection_fences.sql (ALTER TABLE ADD COLUMN DEFAULT 0).
  publicProjectionVersion: bigint("public_projection_version", { mode: "number" }).notNull().default(0),
}, (t) => ({
  // plain btree — a WHERE starts_at > now() predicate is invalid (now() is
  // STABLE, not IMMUTABLE); mirrors the 0006 fix
  startsIdx: index("idx_public_starts").on(t.startsAt),
  sportTimeIdx: index("idx_public_sport_time").on(t.sportKey, t.startsAt),
  areaTimeIdx: index("idx_public_area_time").on(t.area, t.startsAt),
  priceIdx: index("idx_public_price").on(t.priceAmount),
  // id and session_id both mean sessions.id — enforce equality so the guarded
  // view's session_id fence anti-join matches raise_public_session_fence's
  // canonical-id fence (0033). Without it, id<>session_id would leak a fenced
  // row through the view.
  idSessionIdChk: check("public_sessions_id_session_id_chk", sql`${t.id} = ${t.sessionId}`),
}));

// public_projection_fences — GLOBAL PROTECTED, denial-only (DD-12-owned, DD-75).
// No RLS (global / cross-tenant, like public_sessions) and no grant to
// app/readonly — every access is mediated by the narrow SECURITY DEFINER
// functions in 0033_public_projection_fences.sql. surface='session_share' this
// slice; share_activities later EXTENDS usage to 'activity_card' (adds no column).
export const publicProjectionFences = pgTable("public_projection_fences", {
  surface: text("surface").notNull(),        // 'session_share' | 'activity_card' (later)
  targetKind: text("target_kind").notNull(), // 'session' | 'activity_share' | 'person' | 'tenant'
  targetId: uuid("target_id").notNull(),
  fenceToken: uuid("fence_token").notNull(), // random; projector CAS-clears; never returned/logged
  denyScope: text("deny_scope").notNull(),
  reason: text("reason").notNull(),          // closed enum, validated by the raise function
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.surface, t.targetKind, t.targetId] }),
  denyScopeChk: check("public_projection_fences_deny_scope_chk", sql`${t.denyScope} IN ('public','all')`),
}));

export const joinRequests = pgTable("join_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  personId: uuid("person_id").notNull().references(() => persons.id),
  status: text("status").notNull().default("pending"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedBy: uuid("decided_by").references(() => persons.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  commandId: text("command_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activeUq: uniqueIndex("idx_join_requests_active")
    .on(t.sessionId, t.personId).where(sql`${t.status} = 'pending'`),
  statusChk: check("join_requests_status_chk",
    sql`${t.status} IN ('pending','approved','rejected','expired','cancelled')`),
  // DD-68 (migration 0019): same-tenant composite FK, additive over the single-
  // column join_requests_session_id_fkey (0006).
  tenantSessionFk: foreignKey({
    columns: [t.tenantId, t.sessionId],
    foreignColumns: [sessions.tenantId, sessions.id],
    name: "join_requests_tenant_session_fk",
  }),
}));

/* ===========================================================================
 * Billing
 * ======================================================================== */

export const plans = pgTable("plans", {
  id: uuid("id").primaryKey().defaultRandom(),
  planKey: text("plan_key").notNull(),
  version: integer("version").notNull(),
  price: integer("price").notNull(),
  currency: text("currency").notNull().default("VND"),
  interval: text("interval").notNull().default("monthly"),
  limits: jsonb("limits").notNull().default({}),
  entitlements: jsonb("entitlements").notNull().default({}),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("plans_key_version_uq").on(t.planKey, t.version),
  keyChk: check("plans_key_chk",
    sql`${t.planKey} IN ('free','host_pro')`),
}));

export const subscriptions = pgTable("subscriptions", {
  tenantId: uuid("tenant_id").primaryKey().references(() => tenants.id),
  planKey: text("plan_key").notNull(),
  planVersion: integer("plan_version").notNull(),
  selectedExtraChannel: text("selected_extra_channel"),
  status: text("status").notNull().default("trialing"),
  trialEnd: timestamp("trial_end", { withTimezone: true }),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  graceEnd: timestamp("grace_end", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  planFk: foreignKey({
    columns: [t.planKey, t.planVersion],
    foreignColumns: [plans.planKey, plans.version],
    name: "subscriptions_plan_fk",
  }),
  extraChk: check("subscriptions_extra_chk",
    sql`${t.selectedExtraChannel} IN ('zalo','messenger') OR ${t.selectedExtraChannel} IS NULL`),
  statusChk: check("subscriptions_status_chk",
    sql`${t.status} IN ('trialing','active','past_due','suspended','cancelled')`),
}));

export const subscriptionInvoices = pgTable("subscription_invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  invoiceCode: text("invoice_code").notNull().unique(),
  amountDue: integer("amount_due").notNull(),
  amountPaid: integer("amount_paid").notNull().default(0),
  status: text("status").notNull().default("pending"),
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  periodKey: text("period_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  periodUq: uniqueIndex("subscription_invoices_tenant_period_uq").on(t.tenantId, t.periodKey),
  statusChk: check("subscription_invoices_status_chk",
    sql`${t.status} IN ('pending','paid','partial','overdue','cancelled')`),
}));

export const billingTransactions = pgTable("billing_transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  amount: integer("amount").notNull(),
  contentEnc: text("content_enc"),
  status: text("status").notNull().default("received"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("billing_txn_provider_extid_uq").on(t.provider, t.externalId),
}));

export const billingAllocations = pgTable("billing_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  transactionId: uuid("transaction_id").notNull().references(() => billingTransactions.id),
  invoiceId: uuid("invoice_id").notNull().references(() => subscriptionInvoices.id),
  amount: integer("amount").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const billingOverrides = pgTable("billing_overrides", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  actorId: uuid("actor_id").notNull(),
  reason: text("reason").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ===========================================================================
 * Notifications + onboarding
 * ======================================================================== */

export const notificationPolicies = pgTable("notification_policies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id).unique(),
  thresholds: jsonb("thresholds").notNull().default({}),
  quietHoursStart: time("quiet_hours_start"),
  quietHoursEnd: time("quiet_hours_end"),
  maxCount: integer("max_count").notNull().default(3),
  cooldownMinutes: integer("cooldown_minutes").notNull().default(1440),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const notificationIntents = pgTable("notification_intents", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  type: text("type").notNull(),
  aggregateId: uuid("aggregate_id").notNull(),
  stateVersion: integer("state_version").notNull(),
  personId: uuid("person_id").notNull().references(() => persons.id),
  status: text("status").notNull().default("pending"),
  intentKey: text("intent_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("idx_notif_intents_tenant").on(t.tenantId, t.status),
  statusChk: check("notif_intents_status_chk",
    sql`${t.status} IN ('pending','dispatched','skipped','expired')`),
  // Non-money tenant-integrity (migration 0021): candidate key targeted by the
  // same-tenant composite FK notification_deliveries.intent_id ->
  // notification_intents. id is already the PK, so this strict-superset
  // UNIQUE is additive.
  tenantIdCandidateKey: unique("notification_intents_tenant_id_candidate_key").on(t.tenantId, t.id),
}));

export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  intentId: uuid("intent_id").notNull().references(() => notificationIntents.id),
  platform: text("platform").notNull(),
  targetRef: text("target_ref"),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  providerCode: text("provider_code"),
  deliveryKey: text("delivery_key").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pendingIdx: index("idx_notif_deliveries_pending")
    .on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  statusChk: check("notif_deliveries_status_chk",
    sql`${t.status} IN ('pending','sent','failed','skipped')`),
  // Non-money tenant-integrity (migration 0021): same-tenant composite FK,
  // additive over the single-column notification_deliveries_intent_id_fkey
  // (0008). Both referencing columns are NOT NULL, so the tenant match is
  // always enforced.
  tenantIntentFk: foreignKey({
    columns: [t.tenantId, t.intentId],
    foreignColumns: [notificationIntents.tenantId, notificationIntents.id],
    name: "notification_deliveries_tenant_intent_fk",
  }),
}));

/* ===========================================================================
 * Job runtime plane — worker heartbeats (0041, audit 2026-09-06 X-5). GLOBAL, no tenant_id,
 * owned by job_definer; app_worker reaches it only through job_worker_heartbeat() /
 * job_worker_liveness(). Mirrored so the named CHECKs satisfy the schema-mirror guard.
 * ======================================================================== */
export const jobWorkerHeartbeats = pgTable("job_worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  hostname: text("hostname").notNull(),
  pid: integer("pid").notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  workerIdChk: check("job_worker_heartbeats_worker_id_chk", sql`char_length(${t.workerId}) BETWEEN 1 AND 128`),
  pidChk: check("job_worker_heartbeats_pid_chk", sql`${t.pid} > 0`),
}));

export const onboardingRuns = pgTable("onboarding_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  status: text("status").notNull().default("in_progress"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  statusChk: check("onboarding_runs_status_chk",
    sql`${t.status} IN ('in_progress','completed','abandoned')`),
}));

export const onboardingSteps = pgTable("onboarding_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => onboardingRuns.id),
  step: text("step").notNull(),
  status: text("status").notNull().default("not_configured"),
  idempotencyKey: text("idempotency_key"),
  errorCode: text("error_code"),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // Added by migration 0013 (DD-31 SI-8): retries leave multiple rows per
  // (run_id, step). createdAt is human-readable audit only — NOT used for
  // ordering (codex round-11: transaction-stable now() + migration backfill
  // can tie). `seq` (bigserial) is the authoritative recency tie-breaker.
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  seq: bigserial("seq", { mode: "number" }),
}, (t) => ({
  uq: uniqueIndex("onboarding_steps_uq").on(t.runId, t.step, t.idempotencyKey),
  statusChk: check("onboarding_steps_status_chk",
    sql`${t.status} IN ('not_configured','pending','verified','error','skipped')`),
}));

// ---------------------------------------------------------------------------
// DD-56 tenant capability authority — storage (migration 0047). The SQL is
// authoritative for the registry seed, grants/REVOKEs, RLS policies and the
// two triggers (non-delegable grant rejection, append-only audit).
// ---------------------------------------------------------------------------

/** Migration-owned closed registry; no runtime role has any privilege on it. */
export const tenantCapabilityActions = pgTable("tenant_capability_actions", {
  actionKey: text("action_key").primaryKey(),
  coAdminDefault: boolean("co_admin_default").notNull(),
  delegable: boolean("delegable").notNull(),
  authorityClass: text("authority_class").notNull(),
}, (t) => ({
  authorityClassChk: check("tenant_capability_actions_authority_class_chk",
    sql`${t.authorityClass} IN ('preset', 'owner_grantable', 'owner_only', 'platform_admin_only')`),
  classFlagsChk: check("tenant_capability_actions_class_flags_chk",
    sql`${t.delegable} = (${t.authorityClass} = 'owner_grantable') AND ${t.coAdminDefault} = (${t.authorityClass} = 'preset')`),
}));

/** Tenant-private expiring/revocable delegation; app is SELECT-only. */
export const tenantCapabilityGrants = pgTable("tenant_capability_grants", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  granteePersonId: uuid("grantee_person_id").notNull().references(() => persons.id),
  actionKey: text("action_key").notNull().references(() => tenantCapabilityActions.actionKey),
  reason: text("reason").notNull(),
  grantedByPersonId: uuid("granted_by_person_id").notNull().references(() => persons.id),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  expiryChk: check("tenant_capability_grants_expiry_chk", sql`${t.expiresAt} > ${t.grantedAt}`),
  finiteChk: check("tenant_capability_grants_finite_chk", sql`isfinite(${t.grantedAt}) AND isfinite(${t.expiresAt})`),
  tenantIdCandidateKey: unique("tenant_capability_grants_tenant_id_candidate_key").on(t.tenantId, t.id),
  activeUq: uniqueIndex("idx_tenant_capability_grants_active")
    .on(t.tenantId, t.granteePersonId, t.actionKey)
    .where(sql`${t.revokedAt} IS NULL`),
}));

/** Append-only grant/revoke history (immutability by trigger); app is SELECT-only. */
export const tenantCapabilityGrantAudit = pgTable("tenant_capability_grant_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  grantId: uuid("grant_id").notNull().references(() => tenantCapabilityGrants.id),
  action: text("action").notNull(),
  actorPersonId: uuid("actor_person_id").notNull().references(() => persons.id),
  reason: text("reason").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().default(sql`clock_timestamp()`),
}, (t) => ({
  actionChk: check("tenant_capability_grant_audit_action_chk", sql`${t.action} IN ('grant', 'revoke')`),
  grantIdx: index("idx_tenant_capability_grant_audit_grant").on(t.grantId),
  tenantGrantFk: foreignKey({
    columns: [t.tenantId, t.grantId],
    foreignColumns: [tenantCapabilityGrants.tenantId, tenantCapabilityGrants.id],
    name: "tenant_capability_grant_audit_tenant_grant_fk",
  }),
}));
