import { and, eq, sql } from "drizzle-orm";
import { outboxEvents, processedCommands, sessions, sports } from "../schema.js";
import { authorizeTenantAction } from "./authorization.js";
import type { Db } from "./client.js";
import { withTenant } from "./tenant.js";

/**
 * SessionService — CreateSession command (root of the Session BE vertical). Single
 * write path for a DRAFT session in one withTenant transaction: reserve the command
 * key (advisory xact lock) -> dedup -> validate the WHOLE input up front -> insert the
 * tenant-injected row -> one `session.created` outbox row (first producer) -> record
 * the result. FORCE RLS gives cross-tenant invisibility by construction. No suspension
 * gate (DD-105: create-draft is exempt — invisible-until-publish AND money-free); the
 * `publish_new_sessions` gate lives on the separate PublishSession slice. The two design
 * choices are (1) a command-type-INDEPENDENT advisory-lock key matching the
 * processed_commands (tenant_id, command_id) uniqueness, and (2) one comprehensive
 * validateInput() (presence + type + domain, every field, one place).
 */

// Typed domain error codes owned by this service (like auth.ts's LoginReplayError);
// the later route slice maps them onto the packages/core api-contract 400 envelope.
export type SessionCommandErrorCode =
  | "INVALID_INPUT"
  | "INVALID_TIME_RANGE"
  | "SPORT_INACTIVE"
  | "MISSING_DISCOVERY_FIELDS"
  | "INVALID_PRICE"
  | "INVALID_SLOTS"
  | "INVALID_TIMEZONE"
  | "INVALID_VISIBILITY"
  | "INVALID_JOIN_POLICY"
  | "INVALID_TEXT_FIELD"
  | "COMMAND_ID_CONFLICT";

export class SessionCommandError extends Error {
  readonly code: SessionCommandErrorCode;
  constructor(code: SessionCommandErrorCode, message: string) {
    super(message);
    this.name = "SessionCommandError";
    this.code = code;
  }
}

const fail = (code: SessionCommandErrorCode, message: string): never => {
  throw new SessionCommandError(code, message);
};

/** User payload. Carries NO tenant_id/actor/commandId: those are trusted context. */
export interface CreateSessionInputPayload {
  sportId: string;
  startsAt: Date;
  endsAt: Date;
  timezone: string;
  visibility?: "private" | "public";
  priceAmount?: number;
  slotsMax?: number | null;
  area?: string | null;
  venueName?: string | null;
  joinPolicy?: "open" | "approval";
}

export interface CreateSessionParams {
  tenantId: string; // trusted routing context, asserted as a UUID by withTenant
  commandId: string; // idempotency key from trusted context (edge #3 dedup)
  input: CreateSessionInputPayload;
}

interface StoredCreateResult {
  sessionId: string;
  visibility: string;
  status: string;
  version: number;
}

/** replayed=true when a prior processed_commands row was returned (zero new mutation). */
export interface CreateSessionResult extends StoredCreateResult {
  replayed: boolean;
}

const COMMAND_TYPE = "CreateSession";
const INT4_MAX = 2_147_483_647;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const isValidDate = (value: unknown): value is Date =>
  value instanceof Date &&
  !Number.isNaN(value.getTime()) &&
  value.getUTCFullYear() >= 1 &&
  value.getUTCFullYear() <= 9999; // representable by PostgreSQL timestamptz
const isInt4 = (value: unknown, min: number): boolean =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= INT4_MAX;
const isOptionalText = (value: unknown): boolean =>
  value === undefined || value === null || (typeof value === "string" && !value.includes("\u0000")); // PG text rejects NUL
const isEnum = (value: unknown, ...allowed: readonly string[]): boolean =>
  value === undefined || (typeof value === "string" && allowed.includes(value));
const isValidTimezone = (tz: string): boolean => {
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/**
 * Guards a replayed processed_commands.result_ref before it is trusted as our
 * envelope: validates the full CreateSession domain (UUID id, visibility/status
 * enums, version >= 1), not just field types, so a corrupt or hand-written ledger
 * row fails closed. The stored envelope IS the idempotency record: a replay never
 * re-queries the session, so validation stops at the stored value's own domain.
 */
function isStoredCreateResult(value: unknown): value is StoredCreateResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" &&
    UUID_RE.test(r.sessionId) &&
    (r.visibility === "private" || r.visibility === "public") &&
    r.status === "draft" &&
    typeof r.version === "number" &&
    Number.isInteger(r.version) &&
    r.version >= 1
  );
}

/**
 * Comprehensive up-front validation: presence + type + domain for EVERY field, in one
 * place, each producing a typed SessionCommandError. This is the v2 design change that
 * closes the input-validation edge-family — no field can reach an insert as undefined
 * (crash), a non-IANA/non-UUID value (raw 22P02), an out-of-range int (int4 overflow),
 * or an off-enum literal (raw CHECK violation). Pure: no DB access (sport ACTIVE is a
 * separate lookup in createSession).
 */
function validateInput(input: CreateSessionInputPayload): void {
  // Payload itself: a transport passing JSON null, a primitive, or an ARRAY (which is
  // typeof "object") must get a typed error, not a TypeError or a misleading field error,
  // before ANY field dereference below.
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    fail("INVALID_INPUT", "input must be a plain object");
  }
  // edge #7 / matrix B3: a PUBLIC session MISSING any discovery field (sport, area, start
  // time, finite capacity) is MISSING_DISCOVERY_FIELDS — decided BEFORE the per-field format
  // checks below, which would otherwise report the same absence as SPORT_INACTIVE /
  // INVALID_TIME_RANGE. Presence only here; validity (UUID, range, integer) is checked after,
  // so a public session with a PRESENT-but-invalid field still gets its specific typed error.
  if (input.visibility === "public") {
    const missing =
      input.sportId == null ||
      input.startsAt == null ||
      !(typeof input.area === "string" && input.area.trim().length > 0) ||
      typeof input.slotsMax !== "number";
    if (missing) {
      fail(
        "MISSING_DISCOVERY_FIELDS",
        "a public session requires sport, area, start time, and a finite slots_max",
      );
    }
  }
  // Per-field format + domain (all sessions).
  if (typeof input.sportId !== "string" || !UUID_RE.test(input.sportId)) {
    fail("SPORT_INACTIVE", "sport_id must be an active-taxonomy UUID");
  }
  if (!isValidDate(input.startsAt) || !isValidDate(input.endsAt)) {
    fail("INVALID_TIME_RANGE", "starts_at and ends_at must be valid dates");
  }
  if (input.endsAt.getTime() <= input.startsAt.getTime()) {
    fail("INVALID_TIME_RANGE", "ends_at must be after starts_at");
  }
  if (typeof input.timezone !== "string" || !isValidTimezone(input.timezone)) {
    fail("INVALID_TIMEZONE", "timezone must be a valid IANA zone");
  }
  if (!isEnum(input.visibility, "private", "public")) {
    fail("INVALID_VISIBILITY", "visibility must be 'private' or 'public'");
  }
  if (!isEnum(input.joinPolicy, "open", "approval")) {
    fail("INVALID_JOIN_POLICY", "join_policy must be 'open' or 'approval'");
  }
  if (input.priceAmount !== undefined && !isInt4(input.priceAmount, 0)) {
    fail("INVALID_PRICE", "price_amount must be an integer in [0, 2147483647]");
  }
  if (input.slotsMax != null && !isInt4(input.slotsMax, 1)) {
    fail("INVALID_SLOTS", "slots_max must be an integer in [1, 2147483647] or null");
  }
  if (!isOptionalText(input.area) || !isOptionalText(input.venueName)) {
    fail("INVALID_TEXT_FIELD", "area and venue_name must be a string or null");
  }
}

export async function createSession(
  db: Db,
  params: CreateSessionParams,
): Promise<CreateSessionResult> {
  const { tenantId, commandId, input } = params;
  return withTenant(db, tenantId, async (tx) => {
    // Reserve the command key GLOBALLY (command-type-INDEPENDENT) to match the
    // processed_commands (tenant_id, command_id) uniqueness: a concurrent command of ANY type
    // with the same id serializes here and dedups ("one wins, one dedup" — sync-engine #2)
    // instead of racing past the read to a raw 23505. tenant_id is cast ::uuid::text so the key
    // is canonical (command_id is text, keyed verbatim). Pattern from auth 0017 (hashtextextended).
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );

    // Dedup (edge #3): a replayed commandId returns the stored envelope, zero mutation.
    // The ledger is shared across command types, so fail closed unless the row is OUR
    // command_type AND a domain-valid envelope — never replay a foreign/corrupt result.
    const prior = await tx
      .select({
        commandType: processedCommands.commandType,
        resultRef: processedCommands.resultRef,
      })
      .from(processedCommands)
      .where(
        and(eq(processedCommands.tenantId, tenantId), eq(processedCommands.commandId, commandId)),
      );
    if (prior.length > 0) {
      const stored = prior[0]!.resultRef as StoredCreateResult | null;
      if (prior[0]!.commandType === COMMAND_TYPE && isStoredCreateResult(stored)) {
        // Explicit projection (never spread `stored`): only the four declared fields leave.
        return {
          sessionId: stored.sessionId,
          visibility: stored.visibility,
          status: stored.status,
          version: stored.version,
          replayed: true,
        };
      }
      // Foreign command_type or a corrupt/unusable result: never replay it.
      fail(
        "COMMAND_ID_CONFLICT",
        "command_id belongs to a different command or has no usable result",
      );
    }

    // Validate the whole input up front; typed errors thrown BEFORE any insert, so a
    // rejected command mutates nothing. sport must also be in the ACTIVE taxonomy
    // (global lookup; app has SELECT) — an unknown id or active=false is SPORT_INACTIVE.
    validateInput(input);
    const sportRows = await tx
      .select({ active: sports.active })
      .from(sports)
      .where(eq(sports.id, input.sportId));
    if (sportRows.length === 0 || sportRows[0]!.active !== true) {
      fail("SPORT_INACTIVE", "sport_id is not in the active taxonomy");
    }

    // Insert the draft (status fixed to 'draft' — SES-UC-1); tenant_id injected here.
    const visibility = input.visibility ?? "private";
    const [session] = await tx
      .insert(sessions)
      .values({
        tenantId,
        sportId: input.sportId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        timezone: input.timezone,
        priceAmount: input.priceAmount ?? 0,
        slotsMax: input.slotsMax ?? null,
        area: input.area ?? null,
        venueName: input.venueName ?? null,
        visibility,
        joinPolicy: input.joinPolicy ?? "open",
        status: "draft",
      })
      .returning({
        id: sessions.id,
        visibility: sessions.visibility,
        status: sessions.status,
        version: sessions.version,
      });

    // Outbox (first producer): per-aggregate sequence COALESCE(MAX,0)+1 fenced by
    // outbox_agg_seq_uq (deterministically 1 for a fresh id); lease/ack stay NULL.
    await tx.insert(outboxEvents).values({
      tenantId,
      aggregateType: "session",
      aggregateId: session!.id,
      sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${session!.id}), 0) + 1`,
      type: "session.created",
      payload: { session_id: session!.id, tenant_id: tenantId, visibility: session!.visibility },
    });

    const stored: StoredCreateResult = {
      sessionId: session!.id,
      visibility: session!.visibility,
      status: session!.status,
      version: session!.version,
    };
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: COMMAND_TYPE, resultRef: stored });
    return { ...stored, replayed: false };
  });
}

/* ------------------------------------------------------------------------- *
 * PublishSession — the draft→open transition (feature_session_management_tech.md
 * §4 "Publish transition", edges #21–#24). Sibling of createSession, same single
 * write path in one withTenant transaction. Order is spec-pinned (§4 step 1):
 * billing suspension is checked FAIL-FAST FIRST — authz beats replay/no-op, so a
 * suspended tenant gets TENANT_SUSPENDED even on a replay or an already-open no-op
 * -> reserve the command key (advisory xact lock, command-type-INDEPENDENT to match
 * the shared processed_commands (tenant_id, command_id) uniqueness) -> dedup
 * (fail-closed on a foreign/corrupt ledger row) -> lock the session row FOR UPDATE
 * -> idempotent-open no-op -> transition/public/version guards -> billing
 * suspension re-check UNDER LOCK via authorizeTenantAction('publish_new_sessions')
 * (a defense-in-depth RE-AFFIRMATION under the session lock; the upfront authz's
 * FOR SHARE, retained to commit, already serializes against the Daily Lifecycle
 * Job's suspend, so this re-check is redundant under the current helper) ->
 * status-only draft→open + version bump + exactly one session.published outbox
 * row -> record the result.
 *
 * This is the FIRST production caller of authorizeTenantAction (AP-40's purpose)
 * and the real billing-visibility boundary (DD-105): publishing IS ❌ when the
 * tenant is suspended, fail-closed. createSession (draft) is exempt by DD-105 and
 * does NOT gate; publish does. The session.published outbox row is the durable
 * producer a future public_sessions projector consumes — the projector is NOT
 * built here.
 * ------------------------------------------------------------------------- */

// Typed publish error codes owned by this service. `TENANT_SUSPENDED` is NOT one
// of them: a suspended publish surfaces as the billing-owned AuthorizationDecision
// (SessionPublishAuthorizationError below), so no session literal duplicates the
// billing 403 the route layer maps. Codes mirror the BE §3 error-code table.
export type PublishSessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_OPEN"
  | "MISSING_DISCOVERY_FIELDS"
  | "STALE_VERSION"
  | "COMMAND_ID_CONFLICT";

export class SessionPublishError extends Error {
  readonly code: PublishSessionErrorCode;
  constructor(code: PublishSessionErrorCode, message: string) {
    super(message);
    this.name = "SessionPublishError";
    this.code = code;
  }
}

/**
 * Raised when a billing authorization check denies the publish -- by EITHER the
 * upfront call (step 2) or the under-lock re-check (step 9), both the same
 * authorizeTenantAction. Carries the
 * cause-agnostic billing code (`TENANT_SUSPENDED`) verbatim from
 * authorizeTenantAction — a distinct error type (not a PublishSessionErrorCode)
 * so a caller/route can map the billing-owned 403 without this service inventing
 * a session-scoped suspension literal. Distinct class keeps the trust-boundary
 * denial impossible to confuse with a domain rejection.
 */
export class SessionPublishAuthorizationError extends Error {
  readonly code: "TENANT_SUSPENDED";
  constructor() {
    super("tenant is not permitted to publish new sessions");
    this.name = "SessionPublishAuthorizationError";
    this.code = "TENANT_SUSPENDED";
  }
}

const failPublish = (code: PublishSessionErrorCode, message: string): never => {
  throw new SessionPublishError(code, message);
};

/** User payload. Carries NO tenant_id/actor/commandId (those are trusted context). */
export interface PublishSessionInputPayload {
  sessionId: string;
  /** Optional optimistic-concurrency guard; checked ONLY on the mutate branch. */
  expectedVersion?: number;
}

export interface PublishSessionParams {
  tenantId: string; // trusted routing context, asserted as a UUID by withTenant
  commandId: string; // idempotency key from trusted context
  input: PublishSessionInputPayload;
}

interface StoredPublishResult {
  sessionId: string;
  visibility: string;
  status: string;
  version: number;
}

/** replayed=true when a prior processed_commands row was returned (zero new mutation). */
export interface PublishSessionResult extends StoredPublishResult {
  replayed: boolean;
}

const PUBLISH_COMMAND_TYPE = "PublishSession";

/**
 * Guards a replayed processed_commands.result_ref before it is trusted as our
 * envelope — same full-shape/domain check createSession established as the shared
 * ledger's first consumer: a corrupt or hand-written row fails closed rather than
 * being replayed. status must be 'open' (a published result), version >= 1.
 */
function isStoredPublishResult(value: unknown): value is StoredPublishResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" &&
    UUID_RE.test(r.sessionId) &&
    (r.visibility === "private" || r.visibility === "public") &&
    r.status === "open" &&
    typeof r.version === "number" &&
    Number.isInteger(r.version) &&
    r.version >= 1
  );
}

export async function publishSession(
  db: Db,
  params: PublishSessionParams,
): Promise<PublishSessionResult> {
  const { tenantId, commandId, input } = params;
  return withTenant(db, tenantId, async (tx) => {
    // Billing suspension — FAIL-FAST, BEFORE dedup and state lookup (§4 step 1:
    // "AuthZ re-checked trên MỌI publish call (kể cả replay/no-op — authz đứng
    // TRƯỚC dedup + state lookup) ... authz thắng no-op"). A suspended tenant must
    // get TENANT_SUSPENDED even on a REPLAY of a previously-successful publish or a
    // no-op against an already-open session — so the gate runs here, ahead of the
    // ledger read, and suspension beats every replay/no-op/domain outcome below.
    // authorizeTenantAction takes locking reads on THIS tx (resolve_tenant_status_
    // locked + subscriptions FOR SHARE); they PERSIST to commit (authorization.ts:41),
    // so this upfront call ALREADY serializes against the Daily Lifecycle Job's
    // suspend -- a suspend cannot land after here. The under-lock re-check at step 6
    // re-affirms the same locked value (defense-in-depth; redundant under the current
    // lock-retaining helper).
    const upfront = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
    if (!upfront.allowed) {
      throw new SessionPublishAuthorizationError();
    }

    // Validate the payload shape UP FRONT (typed error, never a raw TypeError): a
    // transport passing JSON null, a primitive, an ARRAY (typeof "object"), or a
    // non-string sessionId must fail closed here, before any dereference. `input`
    // is untrusted user payload (only tenantId/commandId are trusted context).
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      failPublish("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    if (typeof input.sessionId !== "string") {
      failPublish("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    // Canonicalize the user-supplied session id ONCE (lowercase), and use the
    // canonical value everywhere below — for the FOR UPDATE query, the replay
    // equality check, and the stored result. PostgreSQL accepts an upper-case UUID
    // literal but stores/returns the canonical lower-case form, so a publish sent
    // with an upper-case id would otherwise store a lower-case result and then fail
    // its OWN replay on `stored.sessionId === input.sessionId` (raising a spurious
    // COMMAND_ID_CONFLICT). A non-UUID id can match no row -> SESSION_NOT_FOUND
    // (fail-closed, before any cast could raise a raw 22P02).
    if (!UUID_RE.test(input.sessionId)) {
      failPublish("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = input.sessionId.toLowerCase();

    // Reserve the command key GLOBALLY (command-type-INDEPENDENT), IDENTICAL to
    // createSession — matches the processed_commands (tenant_id, command_id)
    // uniqueness so a concurrent command of ANY type with the same id serializes
    // and dedups instead of racing past the read to a raw 23505.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );

    // Dedup (edge #3): a replayed commandId returns the stored envelope, zero
    // mutation. The ledger is shared across command types, so fail closed unless
    // the row is OUR command_type AND a domain-valid published envelope AND that
    // envelope is for THIS request's session. The last check matters because,
    // unlike createSession (whose id is self-generated), publish takes sessionId
    // as input: a commandId reused across two different sessions must NOT replay
    // session A's success for a publish of session B (which is still a draft) — it
    // is a genuine idempotency-key collision, so fail closed COMMAND_ID_CONFLICT.
    const prior = await tx
      .select({
        commandType: processedCommands.commandType,
        resultRef: processedCommands.resultRef,
      })
      .from(processedCommands)
      .where(
        and(eq(processedCommands.tenantId, tenantId), eq(processedCommands.commandId, commandId)),
      );
    if (prior.length > 0) {
      const stored = prior[0]!.resultRef as StoredPublishResult | null;
      if (
        prior[0]!.commandType === PUBLISH_COMMAND_TYPE &&
        isStoredPublishResult(stored) &&
        stored.sessionId === sessionId
      ) {
        // Explicit projection (never spread `stored`): only the four declared fields leave.
        return {
          sessionId: stored.sessionId,
          visibility: stored.visibility,
          status: stored.status,
          version: stored.version,
          replayed: true,
        };
      }
      failPublish(
        "COMMAND_ID_CONFLICT",
        "command_id belongs to a different command or has no usable result",
      );
    }

    // Lock the session row FOR UPDATE inside the tenant GUC (RLS choke-point) and
    // read status/visibility/version UNDER lock — decide from the locked row, never
    // a cache. starts_at is deliberately NOT selected here (codex round-05 [P2]):
    // it is re-read directly, at full Postgres precision, by the separate past-start
    // query below, so fetching it here too would just be an unused, stale-precision
    // copy. Not found (0 rows under the tenant GUC) -> SESSION_NOT_FOUND (edge: §3
    // error codes).
    const [locked] = await tx
      .select({
        status: sessions.status,
        visibility: sessions.visibility,
        version: sessions.version,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (locked === undefined) {
      failPublish("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const current = locked!;

    // Idempotent no-op (wins expectedVersion — edge #21 / §4 step 3): already open
    // -> return success no-op, zero mutation, NO duplicate session.published. Record
    // the dedup row so a later replay short-circuits on the ledger. expectedVersion
    // is NOT checked here (goal state reached).
    if (current.status === "open") {
      const stored: StoredPublishResult = {
        sessionId,
        visibility: current.visibility,
        status: "open",
        version: current.version,
      };
      await tx
        .insert(processedCommands)
        .values({ tenantId, commandId, commandType: PUBLISH_COMMAND_TYPE, resultRef: stored });
      return { ...stored, replayed: false };
    }

    // Transition guard, status half (edge #23 / §4 step 4): closed/cancelled cannot
    // publish, no time check needed. Only a draft proceeds to the past-start check
    // below.
    if (current.status !== "draft") {
      failPublish("SESSION_NOT_OPEN", "only a draft session can be published");
    }

    // Transition guard, past-start half. Deliberately a SEPARATE, SUBSEQUENT query,
    // not a `starts_at <= clock_timestamp()` expression added to the locked SELECT
    // above (codex round-02 [P1] on this fix — measured, not assumed): a lock wait
    // (e.g. blocked on this row's own FOR UPDATE behind a concurrent writer) can
    // make BOTH now() AND clock_timestamp() read a time from BEFORE the wait when
    // they sit in the same statement as the LockRows node — a direct, reproducible
    // test against real Postgres (holder holds the row lock, waiter's SELECT blocks,
    // starts_at passes in real wall-clock time while blocked, holder releases) shows
    // clock_timestamp() in that shape still returns the pre-wait time; it does NOT
    // re-evaluate at row-production time the way its VOLATILE label would suggest.
    // A genuinely separate statement issued AFTER the lock is already held does not
    // have this problem — clock_timestamp() there measures the moment this second
    // query executes, which is only reachable once the FOR UPDATE above has already
    // resolved.
    //
    // Re-read starts_at DIRECTLY from the table here (codex round-05 [P2]) instead
    // of passing current.startsAt (already round-tripped through a JS Date) back in
    // as a parameter: Postgres timestamptz carries microsecond precision, JS Date
    // only milliseconds, so parameterizing the already-truncated JS value could
    // reject (or admit) a draft fractionally around its true stored starts_at. A
    // plain re-read needs no FOR UPDATE of its own -- this transaction already holds
    // the row lock from the SELECT above, held for the rest of the transaction. No
    // FROM-less scalar this time (RLS is a table concern), but the tenant GUC does
    // not narrow it further than the already-locked, already-tenant-scoped id.
    const clockResult = await tx.execute(
      sql`select (${sessions.startsAt} <= clock_timestamp()) as "isPastStart" from ${sessions} where ${sessions.id} = ${sessionId}`,
    );
    const isPastStart = (clockResult.rows[0] as { isPastStart: boolean }).isPastStart;
    if (isPastStart) {
      failPublish("SESSION_NOT_OPEN", "a past-start draft cannot be published");
    }

    // Public precondition (edge #22 / §4 step 5): publish turns on public projection,
    // so a public session must carry finite discovery fields. area/slots_max are the
    // fields that can still be absent on an existing draft row (sport_id/starts_at are
    // NOT NULL columns; a public draft's slots_max was already fenced by
    // sessions_public_capacity_chk at create, but re-validate at the transition per
    // spec). Missing -> MISSING_DISCOVERY_FIELDS, zero mutation. Private -> skip.
    if (current.visibility === "public") {
      const area = await tx
        .select({ area: sessions.area, slotsMax: sessions.slotsMax })
        .from(sessions)
        .where(eq(sessions.id, sessionId));
      const row = area[0]!;
      const missing =
        !(typeof row.area === "string" && row.area.trim().length > 0) || row.slotsMax == null;
      if (missing) {
        failPublish(
          "MISSING_DISCOVERY_FIELDS",
          "a public session requires area and a finite slots_max to be published",
        );
      }
    }

    // Billing re-check UNDER LOCK — defense-in-depth re-affirmation (edge #24 / §4
    // step 6, DD-105). authorizeTenantAction performs the same locking reads
    // (resolve_tenant_status_locked + subscriptions FOR SHARE, tenant axis before
    // billing axis), which is why it receives THIS transaction's tx. Because the
    // UPFRONT call's FOR SHARE already persists to our commit (authorization.ts:41),
    // no suspend can land between it and here, so this reads the same locked value --
    // redundant under the current lock-retaining helper (load-bearing only if that
    // helper ever released its FOR SHARE early; an authority/helper-slice concern).
    // Denied -> TENANT_SUSPENDED, abort, zero mutation, NO event.
    const decision = await authorizeTenantAction(tx, tenantId, "publish_new_sessions");
    if (!decision.allowed) {
      throw new SessionPublishAuthorizationError();
    }

    // expectedVersion guard (mutate branch only, §4 step 6): a supplied version that
    // does not match the live row under lock -> STALE_VERSION. Closes the race where
    // a stale "publish" click could publish a concurrently-changed draft.
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      failPublish("STALE_VERSION", "session version has changed — reload");
    }

    // Mutate: status-only draft->open + version bump. visibility UNCHANGED (§4).
    // updatedAt uses clock_timestamp(), not now() (codex round-03 [P2]): this
    // transaction may have waited on the session FOR UPDATE lock (step 5) or the
    // billing re-check's locking reads (step 9) before reaching here, so
    // now()/transaction_timestamp() -- frozen at transaction start -- could stamp
    // an audit timestamp from BEFORE those waits, moving updated_at backward
    // relative to a concurrent writer that committed during the wait. This UPDATE
    // is a separate, subsequent statement issued only after every earlier wait in
    // THIS transaction has already resolved (unlike the isPastStart query at step
    // 7, this statement does not itself need to wait for a NEW lock -- the session
    // row's lock was already acquired at step 5 and is held for the rest of the
    // transaction), so clock_timestamp() here correctly measures the real current
    // time as of the mutation.
    const [updated] = await tx
      .update(sessions)
      .set({
        status: "open",
        version: sql`${sessions.version} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(sessions.id, sessionId))
      .returning({
        id: sessions.id,
        visibility: sessions.visibility,
        status: sessions.status,
        version: sessions.version,
      });

    // Outbox producer (reuses createSession's per-aggregate sequence rule):
    // sequence := COALESCE(MAX(sequence),0)+1 for this aggregate, fenced by
    // outbox_agg_seq_uq (session.created was 1, so publish is 2 — never colliding).
    // Lease/ack columns stay NULL (the all-null shape the boundary CHECK requires).
    await tx.insert(outboxEvents).values({
      tenantId,
      aggregateType: "session",
      aggregateId: updated!.id,
      sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${updated!.id}), 0) + 1`,
      type: "session.published",
      payload: { session_id: updated!.id, tenant_id: tenantId, visibility: updated!.visibility },
    });

    const stored: StoredPublishResult = {
      sessionId: updated!.id,
      visibility: updated!.visibility,
      status: updated!.status,
      version: updated!.version,
    };
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: PUBLISH_COMMAND_TYPE, resultRef: stored });
    return { ...stored, replayed: false };
  });
}
