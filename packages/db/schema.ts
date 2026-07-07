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
  pgTable, uuid, text, integer, bigint, bigserial, boolean, jsonb, timestamp,
  time, customType, uniqueIndex, index, primaryKey, check, foreignKey,
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
}));

export const linkCodes = pgTable("link_codes", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourcePersonId: uuid("source_person_id").notNull().references(() => persons.id),
  sourceChannelIdentityId: uuid("source_channel_identity_id").notNull()
    .references(() => channelIdentities.id),
  codeLookupHash: text("code_lookup_hash").notNull().unique(),
  codeHash: bytea("code_hash").notNull(),
  salt: bytea("salt").notNull(),
  action: text("action").notNull().default("merge_identity"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const webSessions = pgTable("web_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  tokenHash: text("token_hash").notNull().unique(),
  csrfSecret: text("csrf_secret").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  rotatedFrom: uuid("rotated_from"),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accountIdentities = pgTable("account_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  accountId: uuid("account_id").notNull().references(() => accounts.id),
  platform: text("platform").notNull(),
  platformUserHash: text("platform_user_hash").notNull(),
  verifiedAt: timestamp("verified_at", { withTimezone: true }).notNull(),
}, (t) => ({
  uq: uniqueIndex("account_identities_platform_uq").on(t.platform, t.platformUserHash),
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
}));

export const memberships = pgTable("memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  personId: uuid("person_id").notNull().references(() => persons.id),
  displayName: text("display_name"),
  payCode: text("pay_code"),
  status: text("status").notNull().default("active"), // active|guest|left|merged
  mergedIntoMembershipId: uuid("merged_into_membership_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  activePersonUq: uniqueIndex("memberships_active_person_unique")
    .on(t.tenantId, t.personId).where(sql`${t.status} IN ('active','guest')`),
  payCodeUq: uniqueIndex("memberships_tenant_paycode_unique")
    .on(t.tenantId, t.payCode).where(sql`${t.payCode} IS NOT NULL`),
  statusChk: check("memberships_status_chk",
    sql`${t.status} IN ('active','guest','left','merged')`),
}));

export const aliases = pgTable("aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  aliasNorm: text("alias_norm").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  uq: uniqueIndex("aliases_tenant_norm_uq").on(t.tenantId, t.aliasNorm),
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
}, (t) => ({
  tenantStatusIdx: index("idx_sessions_tenant_status").on(t.tenantId, t.status),
  startsIdx: index("idx_sessions_starts_at").on(t.startsAt).where(sql`${t.status} = 'open'`),
  timeChk: check("sessions_time_chk", sql`${t.endsAt} > ${t.startsAt}`),
  priceChk: check("sessions_price_chk", sql`${t.priceAmount} >= 0`),
  slotsChk: check("sessions_slots_chk", sql`${t.slotsMax} IS NULL OR ${t.slotsMax} > 0`),
  visChk: check("sessions_vis_chk", sql`${t.visibility} IN ('private','public')`),
  joinChk: check("sessions_join_chk", sql`${t.joinPolicy} IN ('open','approval')`),
  statusChk: check("sessions_status_chk",
    sql`${t.status} IN ('draft','open','closed','cancelled')`),
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
}));

export const players = pgTable("players", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  sessionId: uuid("session_id").notNull().references(() => sessions.id),
  membershipId: uuid("membership_id").notNull().references(() => memberships.id),
  status: text("status").notNull().default("active"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
  lastRemindedAt: timestamp("last_reminded_at", { withTimezone: true }),
}, (t) => ({
  uq: uniqueIndex("players_tenant_session_member_uq")
    .on(t.tenantId, t.sessionId, t.membershipId),
  sessionIdx: index("idx_players_session").on(t.sessionId),
  statusChk: check("players_status_chk", sql`${t.status} IN ('active','left')`),
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
}));

export const paymentAllocations = pgTable("payment_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id),
  bankTransactionId: uuid("bank_transaction_id").references(() => bankTransactions.id),
  chargeId: uuid("charge_id").notNull().references(() => charges.id),
  amount: integer("amount").notNull(), // signed; reversal negative
  source: text("source").notNull(),
  reversesAllocationId: uuid("reverses_allocation_id"),
  createdBy: uuid("created_by"),
  reasonCode: text("reason_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  chargeIdx: index("idx_alloc_charge").on(t.chargeId),
  bankTxnIdx: index("idx_alloc_bank_txn").on(t.bankTransactionId),
  amountChk: check("alloc_amount_nonzero_chk", sql`${t.amount} <> 0`),
  sourceChk: check("alloc_source_chk", sql`${t.source} IN ('auto','manual','cash','waiver','reversal')`),
  shapeChk: check("alloc_shape_chk", sql`
    (${t.source} IN ('auto','manual') AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NOT NULL)
    OR (${t.source} IN ('cash','waiver') AND ${t.amount} > 0 AND ${t.bankTransactionId} IS NULL AND ${t.createdBy} IS NOT NULL)
    OR (${t.source} = 'reversal' AND ${t.amount} < 0 AND ${t.reversesAllocationId} IS NOT NULL)`),
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
});

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
});

export const messengerPages = pgTable("messenger_pages", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id).unique(),
  pageId: text("page_id").notNull().unique(),
  pageTokenEnc: bytea("page_token_enc").notNull(),
  appSecretEnc: bytea("app_secret_enc"),
  status: text("status").notNull().default("connecting"),
  verifiedAt: timestamp("verified_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

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
}, (t) => ({
  aggSeqUq: uniqueIndex("outbox_agg_seq_uq").on(t.aggregateId, t.sequence),
  unclaimedIdx: index("idx_outbox_unclaimed")
    .on(t.aggregateId, t.sequence).where(sql`${t.claimedAt} IS NULL`),
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
}, (t) => ({
  pk: primaryKey({ columns: [t.eventId, t.projector] }),
  pendingIdx: index("idx_projector_pending").on(t.nextAttemptAt).where(sql`${t.status} = 'pending'`),
  statusChk: check("projector_status_chk", sql`${t.status} IN ('pending','delivered','failed','dlq')`),
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
}, (t) => ({
  // plain btree — a WHERE starts_at > now() predicate is invalid (now() is
  // STABLE, not IMMUTABLE); mirrors the 0006 fix
  startsIdx: index("idx_public_starts").on(t.startsAt),
  sportTimeIdx: index("idx_public_sport_time").on(t.sportKey, t.startsAt),
  areaTimeIdx: index("idx_public_area_time").on(t.area, t.startsAt),
  priceIdx: index("idx_public_price").on(t.priceAmount),
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
    sql`${t.planKey} IN ('free_web','telegram','plus_channel','all_channels')`),
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
