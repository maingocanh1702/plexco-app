import { and, eq, sql } from "drizzle-orm";
import { charges, outboxEvents, players, processedCommands, sessions, sports } from "../schema.js";
import { authorizeTenantAction } from "./authorization.js";
import type { Db } from "./client.js";
import { raisePublicSessionFence } from "./public-session-fence.js";
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

/* ------------------------------------------------------------------------- *
 * AnnounceSession — request an announcement of an OPEN session to a linked channel
 * (feature_session_management_tech.md §3/§4 Events, SES-UC-3; contract acceptance AN1).
 * Sibling of publishSession, same single write path in one withTenant transaction: upfront
 * billing gate (announce_session, ❌ under suspension — authz beats replay) -> validate payload
 * -> reserve the command key (advisory xact lock) -> dedup (fail-closed on a foreign/corrupt/
 * other-request ledger row) -> lock the session row FOR UPDATE and read status -> require open
 * -> emit exactly one session.announcement_requested outbox row -> record the result.
 *
 * DD-110: announce_session is DENY-when-suspended (active/past_due ✅, suspended ❌ — the same
 * row as publish_new_sessions), so it routes through authorizeTenantAction's existing
 * fail-closed resolution with NO allow-when-suspended handling. announce does NOT change the
 * session's status, but it takes the same per-session FOR UPDATE lock create/publish/close use so
 * concurrent announces serialize their outbox-sequence allocation (see the lock site); it emits the
 * canonical announcement request and the channel projector sends to the group and retries
 * downstream (FE SES-UC-3 / edge #10), NOT here. No refund/roster/money/finance-root — announce
 * never reaches edge #5.
 * ------------------------------------------------------------------------- */

// Typed announce error codes owned by this service. TENANT_SUSPENDED is NOT one of them: a
// denied announce surfaces as the billing-owned SessionAnnounceAuthorizationError.
export type AnnounceSessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_OPEN"
  | "SESSION_ALREADY_ENDED"
  | "INVALID_CHANNEL"
  | "COMMAND_ID_CONFLICT";

export class SessionAnnounceError extends Error {
  readonly code: AnnounceSessionErrorCode;
  constructor(code: AnnounceSessionErrorCode, message: string) {
    super(message);
    this.name = "SessionAnnounceError";
    this.code = code;
  }
}

/**
 * Raised when the billing gate denies the announce — announce_session is ❌ under suspension
 * (DD-110), so a suspended tenant gets this even on a replay/no-op (the upfront gate runs
 * before dedup). Distinct type carrying the cause-agnostic billing code, mirroring
 * SessionPublishAuthorizationError, so a route maps the billing-owned 403 without this service
 * inventing a session-scoped suspension literal.
 */
export class SessionAnnounceAuthorizationError extends Error {
  readonly code: "TENANT_SUSPENDED";
  constructor() {
    super("tenant is not permitted to announce sessions");
    this.name = "SessionAnnounceAuthorizationError";
    this.code = "TENANT_SUSPENDED";
  }
}

const failAnnounce = (code: AnnounceSessionErrorCode, message: string): never => {
  throw new SessionAnnounceError(code, message);
};

/**
 * Closed logical channel enum: announce accepts a channel TYPE, never a raw destination id. The
 * phase-1 channel set is Zalo + Messenger — Telegram was removed (feature_session_management.md:11,
 * DD-37 2026-07-10; PRD.md FLOW 2 step 3 posts to Zalo/Messenger), matching the subscriptions
 * .selected_extra_channel CHECK ('zalo'/'messenger'). A caller can therefore only ever name a logical
 * platform, which the downstream channel projector resolves to the TENANT's OWN linked group (it
 * reacts to the outbox row's tenant_id) — a raw destination, or another tenant's target, can never be
 * announced from here. This command validates membership and emits; it does not resolve or send.
 * (codex round-01 [P1] introduced the closed-enum constraint; round-02 [P1] narrowed it to the
 * phase-1 set — the earlier platform-superset wrongly admitted Telegram.)
 */
export type AnnounceChannel = "zalo" | "messenger";
const ANNOUNCE_CHANNELS: ReadonlySet<AnnounceChannel> = new Set(["zalo", "messenger"]);
const isAnnounceChannel = (value: unknown): value is AnnounceChannel =>
  typeof value === "string" && (ANNOUNCE_CHANNELS as ReadonlySet<string>).has(value);

/** User payload. Carries NO tenant_id/actor/commandId (those are trusted context). */
export interface AnnounceSessionInputPayload {
  sessionId: string;
  /** A closed logical channel type (AnnounceChannel), NOT a raw destination id — the projector
   *  resolves the tenant-scoped destination downstream. */
  channel: AnnounceChannel;
}

export interface AnnounceSessionParams {
  tenantId: string; // trusted routing context, asserted as a UUID by withTenant
  commandId: string; // idempotency key from trusted context
  input: AnnounceSessionInputPayload;
}

interface StoredAnnounceResult {
  sessionId: string;
  channel: AnnounceChannel;
}

/** replayed=true when a prior processed_commands row was returned (zero new mutation). */
export interface AnnounceSessionResult extends StoredAnnounceResult {
  replayed: boolean;
}

const ANNOUNCE_COMMAND_TYPE = "AnnounceSession";

/**
 * Guards a replayed processed_commands.result_ref before it is trusted as our envelope: a corrupt or
 * hand-written row fails closed rather than being replayed. sessionId (UUID) and channel (a recognised
 * AnnounceChannel) must both be present — the replay must match the exact request, so the caller
 * equality check compares both.
 */
function isStoredAnnounceResult(value: unknown): value is StoredAnnounceResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" && UUID_RE.test(r.sessionId) && isAnnounceChannel(r.channel)
  );
}

export async function announceSession(
  db: Db,
  params: AnnounceSessionParams,
): Promise<AnnounceSessionResult> {
  const { tenantId, commandId, input } = params;
  return withTenant(db, tenantId, async (tx) => {
    // Billing suspension — FAIL-FAST, BEFORE dedup and state lookup, mirroring publish:
    // announce_session is ❌ under suspension (DD-110), so a suspended tenant must get
    // TENANT_SUSPENDED even on a replay/no-op. authorizeTenantAction takes locking reads
    // (resolve_tenant_status_locked + subscriptions FOR SHARE) on THIS tx that PERSIST to
    // commit (authorization.ts), so this single upfront call already serializes against the
    // Daily Lifecycle Job's suspend -- no suspend can land between here and commit. announce
    // does not mutate the session, so (unlike publish §4 step 6) there is no session-lock-
    // scoped mutation needing a separate under-lock re-check.
    const decision = await authorizeTenantAction(tx, tenantId, "announce_session");
    if (!decision.allowed) {
      throw new SessionAnnounceAuthorizationError();
    }

    // Validate the payload shape UP FRONT (typed error, never a raw TypeError). `input` is
    // untrusted user payload (only tenantId/commandId are trusted context). A bad sessionId
    // fails closed as SESSION_NOT_FOUND (never revealing existence); a bad channel is
    // INVALID_CHANNEL (announce-specific input).
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      failAnnounce("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    if (typeof input.sessionId !== "string" || !UUID_RE.test(input.sessionId)) {
      failAnnounce("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    // channel is a CLOSED logical enum (AnnounceChannel), not a free string: anything outside the
    // recognised platform set — empty, NUL/whitespace, oversized, a raw destination id, or another
    // tenant's target — fails closed here as INVALID_CHANNEL, before it can reach the outbox.
    if (!isAnnounceChannel(input.channel)) {
      failAnnounce("INVALID_CHANNEL", "channel must be a recognised channel type (zalo/messenger)");
    }
    // Canonicalize the id ONCE (lowercase) — used for the FOR SHARE query, the replay equality
    // check, and the stored result — so an upper-case UUID literal does not store a lower-case
    // result that then fails its own replay.
    const sessionId = input.sessionId.toLowerCase();
    const channel = input.channel;

    // Reserve the command key GLOBALLY (command-type-INDEPENDENT), IDENTICAL to create/publish —
    // matches the processed_commands (tenant_id, command_id) uniqueness.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );

    // Dedup (edge #3): a replayed commandId returns the stored envelope, zero mutation. Fail
    // closed unless the row is OUR command_type AND a domain-valid envelope AND for THIS exact
    // request (same session AND same channel) — a commandId reused for a different session or
    // channel is a genuine idempotency-key collision, so COMMAND_ID_CONFLICT.
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
      const stored = prior[0]!.resultRef as StoredAnnounceResult | null;
      if (
        prior[0]!.commandType === ANNOUNCE_COMMAND_TYPE &&
        isStoredAnnounceResult(stored) &&
        stored.sessionId === sessionId &&
        stored.channel === channel
      ) {
        // Explicit projection (never spread `stored`): only the two declared fields leave.
        return { sessionId: stored.sessionId, channel: stored.channel, replayed: true };
      }
      failAnnounce(
        "COMMAND_ID_CONFLICT",
        "command_id belongs to a different command or has no usable result",
      );
    }

    // Lock the session row FOR UPDATE inside the tenant GUC (RLS choke-point) and read status UNDER
    // lock. announce does not mutate the session, but it MUST take the same exclusive per-session lock
    // create/publish/close use, because the outbox producer allocates its sequence as
    // COALESCE(MAX(sequence),0)+1 for this aggregate: FOR SHARE would let two concurrent announces on
    // the same session both read the same MAX and both insert seq N+1, and outbox_agg_seq_uq would then
    // fail one with a raw 23505. FOR UPDATE serializes them so they get consecutive sequences (and it
    // also keeps the row stable against a concurrent close/cancel). Not found (0 rows under the tenant
    // GUC) -> SESSION_NOT_FOUND.
    const [locked] = await tx
      .select({ status: sessions.status })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (locked === undefined) {
      failAnnounce("SESSION_NOT_FOUND", "session not found in tenant context");
    }

    // announce gates on status='open' (a draft is not player-visible/joinable; a closed/cancelled
    // session is over) -> SESSION_NOT_OPEN. There is deliberately NO starts_at past-guard: a session
    // stays 'open' and joinable through play, so announcing an in-progress (past-start, still-open)
    // session is a valid late-join invite. publish's starts_at cutoff is publish-specific (you cannot
    // OPEN a session whose start has passed) and does not apply to announcing one already open.
    if (locked!.status !== "open") {
      failAnnounce("SESSION_NOT_OPEN", "only an open session can be announced");
    }

    // ends_at freshness guard -- TWO SEPARATE reasons, deliberately not conflated:
    //  (a) announce is EXEMPT from edge #11 (reject mutation on closed/cancelled/past sessions)
    //      because it does not mutate the session -- it emits a notification and changes no row; AND
    //  (b) announce nonetheless rejects a session whose ends_at has passed, because a notification
    //      about a FINISHED session ("join this session") is a harm a state mutation does not carry.
    // These are independent: (a) alone would tempt a later reader to delete this guard. auto-expiry
    // is not built, so an 'open' row persists past ends_at indefinitely -- without this guard an
    // ended session would be announceable forever.
    // Clock: mirror publishSession's post-lock pattern -- a SEPARATE query AFTER the row lock using
    // clock_timestamp(), NOT now()/Date.now(). now() is frozen at transaction start, and a clock read
    // inside the blocking locked SELECT measures a pre-wait time (publish round-05 [P2]); a separate
    // post-lock clock_timestamp() measures the real current moment.
    const clockResult = await tx.execute(
      sql`select (${sessions.endsAt} <= clock_timestamp()) as "isEnded" from ${sessions} where ${sessions.id} = ${sessionId}`,
    );
    const isEnded = (clockResult.rows[0] as { isEnded: boolean }).isEnded;
    if (isEnded) {
      failAnnounce("SESSION_ALREADY_ENDED", "cannot announce a session that has already ended");
    }

    // Emit the canonical announcement request (§4 Events: session.announcement_requested, payload
    // {session_id, channel}). This is the durable canonical write (FE SES-UC-3); the channel
    // projector consumes it, sends to the group and retries downstream (FE edge #10), not here.
    // Per-aggregate sequence COALESCE(MAX,0)+1 fenced by outbox_agg_seq_uq; lease/ack stay NULL.
    // No session-row mutation and no status change (§4).
    await tx.insert(outboxEvents).values({
      tenantId,
      aggregateType: "session",
      aggregateId: sessionId,
      sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${sessionId}), 0) + 1`,
      type: "session.announcement_requested",
      payload: { session_id: sessionId, channel },
    });

    const stored: StoredAnnounceResult = { sessionId, channel };
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: ANNOUNCE_COMMAND_TYPE, resultRef: stored });
    return { ...stored, replayed: false };
  });
}

/* ------------------------------------------------------------------------- *
 * UpdateSession — a partial field mutation of a draft or open session
 * (feature_session_management_tech.md SES-UC-4, edges #1/#2/#4/#5/#7/#11/#16/#26;
 * §3 error codes). Sibling of publishSession, same single write path in one
 * withTenant transaction: validate payload shape -> reserve the command key
 * (advisory xact lock, command-type-INDEPENDENT) -> dedup (fail-closed on a
 * foreign/corrupt/other-request ledger row) -> validate the provided editable
 * fields -> lock the session row FOR UPDATE and read the current row -> reject a
 * mutation on a closed/cancelled session (edge #11, SESSION_NOT_OPEN) ->
 * STATUS-DEPENDENT suspension gate -> compute the changed field-set -> mutate +
 * one session.updated outbox row -> record.
 *
 * The suspension gate is status-dependent (DD-110 D1/D4, DD-105): an `open`
 * session re-checks authorizeTenantAction('update_open_session') UNDER LOCK (❌
 * when suspended); a `draft` is EXEMPT (invisible-until-publish + money-free) and
 * does NOT call authorizeTenantAction at all. Because the literal is chosen at the
 * call site by status, and status is only known after the FOR UPDATE lock, the
 * gate runs under lock (unlike publish's upfront call). A consequence: a suspended
 * REPLAY of a prior open-update returns the stored envelope (dedup short-circuits
 * before the gate) — a no-op, no new mutation, so this is correct, not a hole.
 *
 * Money is FAIL-CLOSED, never moved (DD-117): a price change on a session that
 * already carries ANY charge (including a `void` one — no status exemption, per
 * edge #4 "existing charges" + DD-117 D3 fail-closed) is REFUSED with
 * PRICE_CHANGE_REQUIRES_POLICY (edge #4/#5) rather than resolved — applying an
 * impact_policy resolution is the payments/review_policy subsystem, which does not
 * exist on base. Capacity is
 * guarded by CAPACITY_BELOW_ROSTER only (DD-112 is OPEN — NO impact_policy
 * coupling, NO edge #4 edit); CAPACITY_BELOW_OCCUPANCY (live holds) and waitlist
 * promotion on a capacity increase (edge #15) are deferred — those subsystems do
 * not exist on base, so occupancy == the active roster and a capacity change
 * mutates only sessions.slots_max. The active-roster count and the charge-existence
 * probe read `players` / `charges` (both Drizzle-declared) under the tenant GUC (RLS
 * choke-point). An `open` session past its starts_at is a privileged correction, not
 * a normal update (edge #11 realized for update, the same past-boundary cancel uses
 * at edge #31): rejected SESSION_NOT_OPEN via a SEPARATE post-lock clock_timestamp()
 * query (mirror publish/announce — a lock wait must not read a pre-wait clock). A
 * `draft` has no past-guard (it is pre-publish and freely editable). Status is never
 * changed here (draft stays draft, open stays open); the session.published/created
 * producers keep their own transitions.
 * ------------------------------------------------------------------------- */

// Typed update error codes owned by this service; the route slice maps them onto
// the api-contract 400/409 envelope. TENANT_SUSPENDED is NOT one of them — a
// denied open-update surfaces as SessionUpdateAuthorizationError (like publish).
export type UpdateSessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_OPEN"
  | "STALE_VERSION"
  | "CAPACITY_BELOW_ROSTER"
  | "PRICE_CHANGE_REQUIRES_POLICY"
  | "MISSING_DISCOVERY_FIELDS"
  | "INVALID_TIME_RANGE"
  | "INVALID_TIMEZONE"
  | "INVALID_VISIBILITY"
  | "INVALID_JOIN_POLICY"
  | "INVALID_PRICE"
  | "INVALID_SLOTS"
  | "INVALID_TEXT_FIELD"
  | "COMMAND_ID_CONFLICT";

export class SessionUpdateError extends Error {
  readonly code: UpdateSessionErrorCode;
  constructor(code: UpdateSessionErrorCode, message: string) {
    super(message);
    this.name = "SessionUpdateError";
    this.code = code;
  }
}

/**
 * Raised when the billing gate denies an update of an OPEN session —
 * update_open_session is ❌ under suspension (DD-110). Distinct type carrying the
 * cause-agnostic billing code, mirroring SessionPublishAuthorizationError, so a
 * route maps the billing-owned 403 without this service inventing a session-scoped
 * suspension literal. A DRAFT update never reaches this path (DD-105 exemption).
 */
export class SessionUpdateAuthorizationError extends Error {
  readonly code = "TENANT_SUSPENDED" as const;
  constructor() {
    super("tenant is not permitted to update an open session");
    this.name = "SessionUpdateAuthorizationError";
  }
}

const failUpdate = (code: UpdateSessionErrorCode, message: string): never => {
  throw new SessionUpdateError(code, message);
};

/** User payload. Carries NO tenant_id/actor/commandId (those are trusted context).
 *  Every editable field is optional — only PROVIDED fields (key present, value not
 *  `undefined`) are considered; a provided `null` is a real value (e.g. clear area,
 *  or slots_max -> unlimited on a private session). */
export interface UpdateSessionInputPayload {
  sessionId: string;
  /** Optimistic-concurrency guard; checked ONLY on the mutate branch (a no-op
   *  empty change-set does not check it, mirroring publish's idempotent no-op). */
  expectedVersion?: number;
  startsAt?: Date;
  endsAt?: Date;
  timezone?: string;
  priceAmount?: number;
  slotsMax?: number | null;
  visibility?: "private" | "public";
  area?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  joinPolicy?: "open" | "approval";
}

export interface UpdateSessionParams {
  tenantId: string; // trusted routing context, asserted as a UUID by withTenant
  commandId: string; // idempotency key from trusted context
  input: UpdateSessionInputPayload;
}

/**
 * The processed_commands.result_ref envelope: exactly the four returned fields. Dedup is
 * on (tenant_id, command_id) ONLY — identical to createSession/publishSession/announceSession
 * — so a replayed commandId for the same session returns this stored result; NO request
 * content is fingerprinted or stored (DD-117 D5: the session-command family must not persist
 * any PII-derivative verifier in the durable ledger, which survives session deletion).
 */
interface StoredUpdateResult {
  sessionId: string;
  status: string;
  version: number;
  visibility: string;
}

/** The value RETURNED to the caller. replayed=true when a prior processed_commands row
 *  was returned (zero new mutation). */
export interface UpdateSessionResult {
  sessionId: string;
  status: string;
  version: number;
  visibility: string;
  replayed: boolean;
}

const UPDATE_COMMAND_TYPE = "UpdateSession";

/** Drizzle `.set()` partial — only columns UpdateSession is allowed to mutate. */
interface SessionUpdateSet {
  startsAt?: Date;
  endsAt?: Date;
  timezone?: string;
  priceAmount?: number;
  slotsMax?: number | null;
  visibility?: string;
  area?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  joinPolicy?: string;
}

/**
 * Guards a replayed processed_commands.result_ref before it is trusted as our envelope —
 * a SUPERSET of isStoredCreateResult's domain check (UUID id, enum status/visibility,
 * integer version). status stays what it was at update time (update never changes status),
 * so a stored result is 'draft' or 'open'; the version must be in the sessions.version int4
 * domain [1, INT4_MAX] — a corrupt or hand-written row carrying an out-of-int4 version fails
 * closed (→ COMMAND_ID_CONFLICT) rather than replaying an impossible version, since a real
 * sessions.version can never exceed int4. No requestFingerprint: dedup is commandId-only
 * (DD-117 D5), identical to the sibling commands.
 */
function isStoredUpdateResult(value: unknown): value is StoredUpdateResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" &&
    UUID_RE.test(r.sessionId) &&
    (r.status === "draft" || r.status === "open") &&
    (r.visibility === "private" || r.visibility === "public") &&
    typeof r.version === "number" &&
    Number.isInteger(r.version) &&
    r.version >= 1 &&
    r.version <= INT4_MAX
  );
}

export async function updateSession(
  db: Db,
  params: UpdateSessionParams,
): Promise<UpdateSessionResult> {
  const { tenantId, commandId, input } = params;
  return withTenant(db, tenantId, async (tx) => {
    // Validate the payload shape UP FRONT (typed error, never a raw TypeError):
    // `input` is untrusted user payload (only tenantId/commandId are trusted). A
    // bad sessionId fails closed as SESSION_NOT_FOUND (never revealing existence).
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      failUpdate("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    if (typeof input.sessionId !== "string" || !UUID_RE.test(input.sessionId)) {
      failUpdate("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    // Canonicalize the id ONCE (lowercase) — used for the FOR UPDATE query, the
    // replay equality check, and the stored result — so an upper-case UUID literal
    // does not store a lower-case result that then fails its own replay.
    const sessionId = input.sessionId.toLowerCase();

    // Reserve the command key GLOBALLY (command-type-INDEPENDENT), IDENTICAL to
    // create/publish/announce — matches the processed_commands (tenant_id,
    // command_id) uniqueness so a concurrent command of ANY type with the same id
    // serializes and dedups instead of racing past the read to a raw 23505.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );

    // Dedup (edge #3): a replayed commandId returns the stored envelope, zero mutation.
    // Dedup is on (tenant_id, command_id) ONLY, identical to create/publish/announce —
    // fail closed unless the row is OUR command_type AND a domain-valid envelope AND for
    // the SAME session (the operation's identity, like announce's session+channel). A
    // commandId reused for a DIFFERENT session is a genuine idempotency-key collision
    // (COMMAND_ID_CONFLICT); the same commandId replayed for the same session returns the
    // first result regardless of the patch — the caller owns commandId uniqueness per
    // distinct request. NO request content is fingerprinted (DD-117 D5): storing a hash of
    // the location fields in this durable ledger, which survives session deletion, would
    // let a reader dictionary-recover the deleted PII.
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
      const stored = prior[0]!.resultRef as StoredUpdateResult | null;
      if (
        prior[0]!.commandType === UPDATE_COMMAND_TYPE &&
        isStoredUpdateResult(stored) &&
        stored.sessionId === sessionId
      ) {
        return {
          sessionId: stored.sessionId,
          status: stored.status,
          version: stored.version,
          visibility: stored.visibility,
          replayed: true,
        };
      }
      failUpdate(
        "COMMAND_ID_CONFLICT",
        "command_id belongs to a different command or session, or has no usable result",
      );
    }

    // LEDGER MISS (prior.length === 0) -> a genuinely new command. Validate the PROVIDED
    // editable fields NOW, AFTER the dedup: a replayed commandId for the same session must
    // return the stored result REGARDLESS of the (possibly malformed) retry payload —
    // validating the patch BEFORE the dedup would report failure for an operation that
    // already committed (DD-117 D5 "regardless of the patch"; only session-IDENTITY, the
    // sessionId, is validated up front, mirroring announce validating only session+channel).
    // Each check runs only when the field is present (value !== undefined); a provided
    // `null` is a real value for the nullable columns. expectedVersion, if provided, must be
    // a positive int4 (the sessions.version domain: NOT NULL, default 1) — validated here,
    // before the no-op/mutate branches, so a malformed value cannot slip through the no-op
    // branch (which does not re-check the version).
    if (input.expectedVersion !== undefined && !isInt4(input.expectedVersion, 1)) {
      failUpdate("STALE_VERSION", "expected_version must be a positive integer");
    }
    if (input.startsAt !== undefined && !isValidDate(input.startsAt)) {
      failUpdate("INVALID_TIME_RANGE", "starts_at must be a valid date");
    }
    if (input.endsAt !== undefined && !isValidDate(input.endsAt)) {
      failUpdate("INVALID_TIME_RANGE", "ends_at must be a valid date");
    }
    if (
      input.timezone !== undefined &&
      (typeof input.timezone !== "string" || !isValidTimezone(input.timezone))
    ) {
      failUpdate("INVALID_TIMEZONE", "timezone must be a valid IANA zone");
    }
    if (!isEnum(input.visibility, "private", "public")) {
      failUpdate("INVALID_VISIBILITY", "visibility must be 'private' or 'public'");
    }
    if (!isEnum(input.joinPolicy, "open", "approval")) {
      failUpdate("INVALID_JOIN_POLICY", "join_policy must be 'open' or 'approval'");
    }
    if (input.priceAmount !== undefined && !isInt4(input.priceAmount, 0)) {
      failUpdate("INVALID_PRICE", "price_amount must be an integer in [0, 2147483647]");
    }
    if (input.slotsMax !== undefined && input.slotsMax !== null && !isInt4(input.slotsMax, 1)) {
      failUpdate("INVALID_SLOTS", "slots_max must be an integer in [1, 2147483647] or null");
    }
    if (
      !isOptionalText(input.area) ||
      !isOptionalText(input.venueName) ||
      !isOptionalText(input.venueAddress)
    ) {
      failUpdate(
        "INVALID_TEXT_FIELD",
        "area, venue_name and venue_address must be a string or null",
      );
    }

    // Lock the session row FOR UPDATE inside the tenant GUC (RLS choke-point) and
    // read the current row UNDER lock — decide from the locked row, never a cache.
    // Not found (0 rows under the tenant GUC) -> SESSION_NOT_FOUND.
    const [locked] = await tx
      .select({
        status: sessions.status,
        version: sessions.version,
        visibility: sessions.visibility,
        startsAt: sessions.startsAt,
        endsAt: sessions.endsAt,
        timezone: sessions.timezone,
        priceAmount: sessions.priceAmount,
        slotsMax: sessions.slotsMax,
        area: sessions.area,
        venueName: sessions.venueName,
        venueAddress: sessions.venueAddress,
        joinPolicy: sessions.joinPolicy,
      })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (locked === undefined) {
      failUpdate("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const current = locked!;

    // Transition guard (edge #11 / FE edge #11): a closed or cancelled session is
    // terminal — reject every mutation (a privileged correction with audit trail is
    // out of scope). Only draft/open proceed.
    if (current.status !== "draft" && current.status !== "open") {
      failUpdate("SESSION_NOT_OPEN", "a closed or cancelled session cannot be updated");
    }

    // Past-guard (edge #11 "past" realized for update — the same past-boundary cancel
    // uses at edge #31, per DD-111 D3): an OPEN session whose starts_at has passed has
    // gone live; mutating its price/capacity/time/venue is a privileged correction,
    // not a normal update -> SESSION_NOT_OPEN. A DRAFT has NO past-guard (pre-publish,
    // freely editable — e.g. to FIX a wrong starts_at). SEPARATE post-lock query using
    // clock_timestamp() (NOT now()/Date.now()): mirror publish/announce — a lock wait
    // spanning starts_at would make an in-statement or transaction-frozen clock read a
    // PRE-wait time, so the check must be its own statement, reached only after the
    // FOR UPDATE above has resolved (proven by REG-CLOCK-UPDATE + publish REG-CLOCK2).
    if (current.status === "open") {
      const clockRes = await tx.execute(
        sql`select (${sessions.startsAt} <= clock_timestamp()) as "isPast" from ${sessions} where ${sessions.id} = ${sessionId}`,
      );
      if ((clockRes.rows[0] as { isPast: boolean }).isPast) {
        failUpdate(
          "SESSION_NOT_OPEN",
          "a past-start open session cannot be updated (privileged correction required)",
        );
      }
    }

    // LOCK ORDER (audit 2026-09-06 D-14, documented not changed): this command takes
    // `sessions FOR UPDATE` FIRST and only then `tenants`/`subscriptions FOR SHARE` (inside
    // authorizeTenantAction below), while publish/announce/close/cancel authorize UPFRONT
    // (subscriptions FOR SHARE first, then sessions FOR UPDATE). Today no third party takes
    // `subscriptions FOR UPDATE` and then `sessions`, so the inversion cannot deadlock; the
    // future Daily Lifecycle suspend job WOULD, and the fix belongs to that lane: pre-read the
    // status without a lock, authorize when it is `open`, then lock the session and re-check
    // (re-authorizing only in the draft→open race). Not done here because the DD-110 D4
    // negative test pins that the literal is never sent for a draft, and that suite could not be
    // run in the session that wrote this note. Row: audit-2026-09-06-d14-lock-order-publish-vs-update.
    // STATUS-DEPENDENT suspension gate. An OPEN session is player-visible, so an
    // update re-checks tenant suspension UNDER LOCK via
    // authorizeTenantAction('update_open_session') (❌ when suspended, DD-110 D2) —
    // the resolver's FOR SHARE reads serialize against the Daily Lifecycle Job's
    // suspend, held to commit. A DRAFT is invisible-until-publish and money-free,
    // so it is EXEMPT (DD-105) and this resolver is NOT called at all — the
    // updateSession-on-draft negative test (DD-110 D4) enforces that the literal
    // is never sent for a draft (which would silently break the DD-105 exemption).
    if (current.status === "open") {
      const decision = await authorizeTenantAction(tx, tenantId, "update_open_session");
      if (!decision.allowed) {
        throw new SessionUpdateAuthorizationError();
      }
    }

    // Compute the changed field-set: a field is "changed" only when PROVIDED and
    // DIFFERENT from the locked current value. changedFields carries the canonical
    // snake_case column names for the session.updated event; changes carries the
    // Drizzle column props for the UPDATE.
    const changes: SessionUpdateSet = {};
    const changedFields: string[] = [];
    if (input.startsAt !== undefined && input.startsAt.getTime() !== current.startsAt.getTime()) {
      changes.startsAt = input.startsAt;
      changedFields.push("starts_at");
    }
    if (input.endsAt !== undefined && input.endsAt.getTime() !== current.endsAt.getTime()) {
      changes.endsAt = input.endsAt;
      changedFields.push("ends_at");
    }
    if (input.timezone !== undefined && input.timezone !== current.timezone) {
      changes.timezone = input.timezone;
      changedFields.push("timezone");
    }
    if (input.priceAmount !== undefined && input.priceAmount !== current.priceAmount) {
      changes.priceAmount = input.priceAmount;
      changedFields.push("price_amount");
    }
    if (input.slotsMax !== undefined && input.slotsMax !== current.slotsMax) {
      changes.slotsMax = input.slotsMax;
      changedFields.push("slots_max");
    }
    if (input.visibility !== undefined && input.visibility !== current.visibility) {
      changes.visibility = input.visibility;
      changedFields.push("visibility");
    }
    if (input.area !== undefined && input.area !== current.area) {
      changes.area = input.area;
      changedFields.push("area");
    }
    if (input.venueName !== undefined && input.venueName !== current.venueName) {
      changes.venueName = input.venueName;
      changedFields.push("venue_name");
    }
    if (input.venueAddress !== undefined && input.venueAddress !== current.venueAddress) {
      changes.venueAddress = input.venueAddress;
      changedFields.push("venue_address");
    }
    if (input.joinPolicy !== undefined && input.joinPolicy !== current.joinPolicy) {
      changes.joinPolicy = input.joinPolicy;
      changedFields.push("join_policy");
    }

    // Idempotent no-op: nothing to change (no field provided, or every provided
    // field already equals current). Return the current state, record the dedup row
    // so a later replay short-circuits, no version bump, NO session.updated event.
    // expectedVersion is NOT checked here (goal state already reached — mirror
    // publish's idempotent-no-op-wins-version).
    if (changedFields.length === 0) {
      const stored: StoredUpdateResult = {
        sessionId,
        status: current.status,
        version: current.version,
        visibility: current.visibility,
      };
      await tx
        .insert(processedCommands)
        .values({ tenantId, commandId, commandType: UPDATE_COMMAND_TYPE, resultRef: stored });
      return {
        sessionId: stored.sessionId,
        status: stored.status,
        version: stored.version,
        visibility: stored.visibility,
        replayed: false,
      };
    }

    // expectedVersion guard — MANDATORY on the mutate branch (edge #2/#26, matching
    // cancel: "expectedVersion bắt buộc trên nhánh mutate"). Optimistic locking only
    // prevents a lost update if the caller PROVES it edited the version it read; an
    // omitted version would let a stale caller silently overwrite a concurrent edit.
    // So a NON-EMPTY change-set REQUIRES a version that matches the live row under
    // lock — missing OR mismatched -> STALE_VERSION, zero mutation. (The idempotent
    // no-op branch above deliberately does NOT check it — goal state already reached,
    // mirror publish.)
    if (input.expectedVersion === undefined || input.expectedVersion !== current.version) {
      failUpdate(
        "STALE_VERSION",
        "expected_version is required and must match the current version — reload",
      );
    }

    // Effective post-change values for the cross-field guards (provided-or-current).
    const effStartsAt = input.startsAt !== undefined ? input.startsAt : current.startsAt;
    const effEndsAt = input.endsAt !== undefined ? input.endsAt : current.endsAt;
    const effVisibility = input.visibility !== undefined ? input.visibility : current.visibility;
    const effArea = input.area !== undefined ? input.area : current.area;
    const effSlotsMax = input.slotsMax !== undefined ? input.slotsMax : current.slotsMax;

    // Time range (edge #1): the RESULTING ends_at must be after starts_at. Mirrors
    // the sessions_time_chk CHECK, but returns a typed error instead of a raw 23514.
    if (effEndsAt.getTime() <= effStartsAt.getTime()) {
      failUpdate("INVALID_TIME_RANGE", "ends_at must be after starts_at");
    }

    // Discovery completeness (edge #7/#12): if the RESULTING session is public it
    // must carry area + a finite slots_max (re-validated at update per §3). Mirrors
    // sessions_public_capacity_chk; a public private->public flip or a public
    // session clearing area/slots_max fails MISSING_DISCOVERY_FIELDS.
    if (effVisibility === "public") {
      const missing =
        !(typeof effArea === "string" && effArea.trim().length > 0) || effSlotsMax == null;
      if (missing) {
        failUpdate(
          "MISSING_DISCOVERY_FIELDS",
          "a public session requires area and a finite slots_max",
        );
      }
    }

    // Capacity guard (edge #16, DD-112): only when slots_max is being CHANGED to a
    // FINITE value — reject if it would fall below the active roster. Reads the active
    // roster through the SINGLE canonical helper `sessionActiveRosterCount` (the one
    // source for the active-roster aggregate — also consumed by cancelSession's gate-#3
    // refuse and its event), so capacity and cancellation can never drift on two formulas.
    // Under the tenant GUC (RLS): players is tenant-scoped, and the session row is already
    // locked in this tenant, so the count is this session's active roster only.
    // CAPACITY_BELOW_OCCUPANCY (active + live holds) is NOT implemented: no booking-hold
    // table exists on base, so occupancy == active roster.
    if (changes.slotsMax !== undefined && changes.slotsMax !== null) {
      const activeCount = await sessionActiveRosterCount(tx, sessionId);
      if (changes.slotsMax < activeCount) {
        failUpdate("CAPACITY_BELOW_ROSTER", "slots_max cannot be below the active roster");
      }
    }

    // Price guard (edge #4/#5, DD-117 — FAIL-CLOSED, money never moves): a price
    // change on a session that already carries ANY charge is REFUSED, not resolved —
    // with NO status exemption. The Reviewed session contract edge #4 requires policy
    // for a "price change with existing charges" (no void carve-out), and DD-117 D3
    // authorizes the charge branch ONLY as a fail-closed refuse, never a success path —
    // so a `void`-only charge must refuse too (fail-closed: block when we cannot prove
    // the change is safe; a void charge still evidences prior financial activity whose
    // reconciliation is a review_policy question). Applying an impact_policy resolution
    // (re-derive existing charges) is the payments/review_policy subsystem, absent on
    // base — so this refuses rather than silently mutating money. Drizzle-typed `charges`
    // existence probe under the tenant GUC (RLS). The retry-root dimension of edge #4 is
    // vacuously absent (no promotion-retry table on base).
    if (changes.priceAmount !== undefined) {
      const chargeRows = await tx
        .select({ x: sql`1` })
        .from(charges)
        .where(eq(charges.sessionId, sessionId))
        .limit(1);
      if (chargeRows.length > 0) {
        failUpdate(
          "PRICE_CHANGE_REQUIRES_POLICY",
          "price cannot change while charges exist — resolution requires review_policy",
        );
      }
    }

    // Mutate ONLY the changed columns + version bump. status is UNCHANGED (draft
    // stays draft, open stays open). updated_at uses clock_timestamp(), not now():
    // this transaction may have waited on the FOR UPDATE lock or the billing
    // re-check's locking reads, so now()/transaction_timestamp() (frozen at
    // transaction start) could stamp a time from before those waits. This UPDATE is
    // a separate statement issued only after every earlier wait has resolved.
    const [updated] = await tx
      .update(sessions)
      .set({
        ...changes,
        version: sql`${sessions.version} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(sessions.id, sessionId))
      .returning({
        id: sessions.id,
        status: sessions.status,
        version: sessions.version,
        visibility: sessions.visibility,
      });

    // Final atomic past-fence (edge #11 realized for the EFFECTIVE starts_at — codex
    // round-3 [P1]). The early past-guard only checked the CURRENT starts_at, and the
    // time-range guard only checked ends > starts, NOT starts vs the clock. So an update
    // that SETS starts_at to a past value, OR an open session whose current starts_at is
    // crossed by the clock DURING a lock / FOR SHARE wait in this transaction, could
    // otherwise mutate a now-past open session. Re-read the just-WRITTEN starts_at from
    // the column and compare to the DB clock in ONE post-write query (column value = no
    // JS ms-truncation; clock_timestamp() = the post-wait instant): a past result throws,
    // rolling the whole transaction back (this UPDATE included) — zero net mutation. A
    // DRAFT is exempt: status is never changed here, so updated!.status is 'draft' for a
    // draft update and this fence is skipped (a draft is pre-publish and freely editable;
    // publish's own past-guard blocks a past-start draft at publish time).
    if (updated!.status === "open") {
      const fenceRes = await tx.execute(
        sql`select (${sessions.startsAt} <= clock_timestamp()) as "isPast" from ${sessions} where ${sessions.id} = ${sessionId}`,
      );
      if ((fenceRes.rows[0] as { isPast: boolean }).isPast) {
        failUpdate(
          "SESSION_NOT_OPEN",
          "the resulting starts_at is in the past — a privileged correction is required",
        );
      }
    }

    // Outbox producer (reuses the per-aggregate sequence rule): sequence :=
    // COALESCE(MAX(sequence),0)+1 for this aggregate, fenced by outbox_agg_seq_uq.
    // Lease/ack columns stay NULL. The tenant is on the row's tenant_id COLUMN; the
    // PAYLOAD is EXACTLY the spec's {session_id, changed_fields[]} (§4 Events — no
    // tenant_id), where changed_fields are the canonical snake_case column names
    // (never roster/amount). The dispatcher schedule stays OFF.
    await tx.insert(outboxEvents).values({
      tenantId,
      aggregateType: "session",
      aggregateId: updated!.id,
      sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${updated!.id}), 0) + 1`,
      type: "session.updated",
      payload: { session_id: updated!.id, changed_fields: changedFields },
    });

    // A visibility transition (public <-> private) ALSO emits the spec's specific
    // session.visibility_changed event (§4 Events: {session_id, new_visibility}) — the
    // signal the public_sessions projector consumes to add/remove the listing (FE edge
    // #8). Emitted atomically with the NEXT per-aggregate sequence in the SAME tx (the
    // subquery sees the session.updated row just inserted above, so this is
    // session.updated + 1). No PII — visibility is a public/private flag.
    if (changes.visibility !== undefined) {
      await tx.insert(outboxEvents).values({
        tenantId,
        aggregateType: "session",
        aggregateId: updated!.id,
        sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${updated!.id}), 0) + 1`,
        type: "session.visibility_changed",
        payload: { session_id: updated!.id, new_visibility: updated!.visibility },
      });
    }

    // DD-12 immediate-deny fence: raise on EVERY public->private transition, in THIS source
    // transaction — the guarded view public_session_share_v anti-joins public_projection_fences
    // and denies the public read path IMMEDIATELY, not after the async projector (the async
    // session.visibility_changed event above still drives the eventual public_sessions removal +
    // fence CAS-clear). Deliberately NOT gated on status: public_session_share_v has NO
    // sessions.status predicate, so "a draft is never publicly served" is a PROJECTOR ASSUMPTION,
    // not a schema guarantee — the fence PRODUCER must not depend on the behavior of the (unbuilt)
    // projector (owner ruling 2026-08-25; DD-12 literal "privacy-reducing mutation"). private->
    // private is not a visibility change, so it raises nothing. Cancel/close (a later slice) reuse
    // the shared helper with 'cancelled'/'closed' and likewise raise unconditionally.
    if (changes.visibility === "private") {
      await raisePublicSessionFence(tx, updated!.id, "visibility_private");
    }

    const stored: StoredUpdateResult = {
      sessionId: updated!.id,
      status: updated!.status,
      version: updated!.version,
      visibility: updated!.visibility,
    };
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: UPDATE_COMMAND_TYPE, resultRef: stored });
    return {
      sessionId: stored.sessionId,
      status: stored.status,
      version: stored.version,
      visibility: stored.visibility,
      replayed: false,
    };
  });
}

// so a tx from withTenant passes to the helper below without a cast). Used by the shared
// close/cancel money choke-point.
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Money choke-point for the obligation-termination commands (edge #5 / DD-117 D3): a session
 * carrying ANY charge has nonterminal finance roots a review_policy must resolve BEFORE a
 * close/cancel can commit ("no silent cancellation"). That subsystem does not exist on base, so
 * close/cancel FAIL-CLOSED (CANCEL_REQUIRES_REVIEW) whenever a charge exists — money never
 * terminates silently. ANY charge, NO status carve-out (matching updateSession's price guard: a
 * `void` charge still evidences prior financial activity whose reconciliation is a review
 * question). On current main this is vacuously false (no join/waitlist/payments → no charges
 * reachable); the guard exists so the refuse path is in place BEFORE paid rosters become
 * reachable. SINGLE source for both close and cancel — the derived "has charges" money check.
 */
async function sessionHasCharges(tx: Tx, sessionId: string): Promise<boolean> {
  const rows = await tx
    .select({ x: sql`1` })
    .from(charges)
    .where(eq(charges.sessionId, sessionId))
    .limit(1);
  return rows.length > 0;
}

// ============================ CloseSession ============================

export type CloseSessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_OPEN"
  | "STALE_VERSION"
  | "CANCEL_REQUIRES_REVIEW"
  | "COMMAND_ID_CONFLICT";

export class SessionCloseError extends Error {
  readonly code: CloseSessionErrorCode;
  constructor(code: CloseSessionErrorCode, message: string) {
    super(message);
    this.name = "SessionCloseError";
    this.code = code;
  }
}

/**
 * Authorization denial for close_session. close_session is a DD-110 D2 obligation-termination class:
 * allowed for active/past_due AND for a `suspended` tenant OR subscription — but authorizeTenantAction
 * still DENIES a `cancelled`/missing subscription or a `cancelled`/anomalous tenant, so this error IS
 * reachable (not a dead default). Carries the cause-agnostic billing code, like the sibling commands.
 */
export class SessionCloseAuthorizationError extends Error {
  readonly code: "TENANT_SUSPENDED";
  constructor() {
    super("tenant is not permitted to close sessions");
    this.name = "SessionCloseAuthorizationError";
    this.code = "TENANT_SUSPENDED";
  }
}

const failClose = (code: CloseSessionErrorCode, message: string): never => {
  throw new SessionCloseError(code, message);
};

/** User payload. Carries NO tenant_id/actor/commandId (those are trusted context). */
export interface CloseSessionInputPayload {
  sessionId: string;
  /** Optimistic-concurrency guard; MANDATORY on the mutate branch (edge #26). */
  expectedVersion?: number;
}

export interface CloseSessionParams {
  tenantId: string; // trusted routing context, asserted as a UUID by withTenant
  commandId: string; // idempotency key from trusted context
  input: CloseSessionInputPayload;
}

/** processed_commands.result_ref envelope: the returned fields only. status is always 'closed'
 *  after the command (real close OR no-op replay of an already-closed session). Dedup is
 *  commandId-only (DD-117 D5); no request content is stored. */
interface StoredCloseResult {
  sessionId: string;
  status: string;
  version: number;
}

/** replayed=true when a prior processed_commands row was returned (zero new mutation). */
export interface CloseSessionResult {
  sessionId: string;
  status: string;
  version: number;
  replayed: boolean;
}

const CLOSE_COMMAND_TYPE = "CloseSession";

/** Guards a replayed result_ref before trusting it: UUID id, status 'closed', integer version in
 *  the sessions.version int4 domain [1, INT4_MAX] — a corrupt/hand-written row fails closed. */
function isStoredCloseResult(value: unknown): value is StoredCloseResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.sessionId === "string" &&
    UUID_RE.test(r.sessionId) &&
    r.status === "closed" &&
    typeof r.version === "number" &&
    Number.isInteger(r.version) &&
    r.version >= 1 &&
    r.version <= INT4_MAX
  );
}

/**
 * CloseSession — transition an `open` session to `closed`. Obligation-termination: allowed under
 * suspension on EITHER axis (DD-110 D2) but still DENIES a `cancelled`/missing tenant or subscription.
 * One withTenant transaction on the S2 pattern: upfront suspension gate →
 * validate → advisory command-key lock → dedup (commandId-only, DD-117 D5) → FOR UPDATE lock →
 * idempotent no-op (already closed) → transition guard (only `open`) → MANDATORY expectedVersion →
 * money fail-closed (any charge → CANCEL_REQUIRES_REVIEW, edge #5) → mutate + version bump +
 * `updated_at = clock_timestamp()` → raise the DD-12 fence ('closed', unconditional) → one
 * `session.closed` outbox row → record. Close has NO past-guard: closing a session whose start has
 * passed is the normal completion (unlike cancel's edge #31 past-guard on `open`).
 */
export async function closeSession(
  db: Db,
  params: CloseSessionParams,
): Promise<CloseSessionResult> {
  const { tenantId, commandId, input } = params;
  return withTenant(db, tenantId, async (tx) => {
    // Suspension gate (DD-110 D2): close_session is an obligation-termination class — authorize-
    // TenantAction allows active/past_due AND a `suspended` tenant OR subscription, but DENIES a
    // `cancelled`/missing subscription or a `cancelled`/anomalous tenant, so the `!allowed` branch is
    // REACHABLE (a suspended tenant still closes; a cancelled one does not). Called upfront: the
    // resolver's FOR SHARE locks on tenants/subscriptions persist for the whole tx, so the decision —
    // including its deny cases — stays stable through the mutation without a separate under-lock
    // re-check (the same concurrency guarantee the deny-path classes like publish/update rely on).
    const decision = await authorizeTenantAction(tx, tenantId, "close_session");
    if (!decision.allowed) {
      throw new SessionCloseAuthorizationError();
    }

    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      failClose("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    if (typeof input.sessionId !== "string" || !UUID_RE.test(input.sessionId)) {
      failClose("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const sessionId = input.sessionId.toLowerCase();

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
    );

    // Dedup (edge #3) — commandId-only (DD-117 D5): a replayed commandId for the SAME session
    // returns the stored envelope; a different session or a foreign command_type conflicts.
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
      const stored = prior[0]!.resultRef as StoredCloseResult | null;
      if (
        prior[0]!.commandType === CLOSE_COMMAND_TYPE &&
        isStoredCloseResult(stored) &&
        stored.sessionId === sessionId
      ) {
        return {
          sessionId: stored.sessionId,
          status: stored.status,
          version: stored.version,
          replayed: true,
        };
      }
      failClose(
        "COMMAND_ID_CONFLICT",
        "command_id belongs to a different command or session, or has no usable result",
      );
    }

    const [locked] = await tx
      .select({ status: sessions.status, version: sessions.version })
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .for("update");
    if (locked === undefined) {
      failClose("SESSION_NOT_FOUND", "session not found in tenant context");
    }
    const current = locked!;

    // Idempotent no-op: already closed → success no-op, zero mutation, no duplicate event. Does NOT
    // check expectedVersion AT ALL — neither match NOR int4 validity — so an already-closed session
    // wins the no-op even with a malformed expectedVersion (edge #27 no-op-wins-over-version; the int4
    // validation deliberately runs AFTER this branch, on the mutate path only).
    if (current.status === "closed") {
      const stored: StoredCloseResult = { sessionId, status: "closed", version: current.version };
      await tx
        .insert(processedCommands)
        .values({ tenantId, commandId, commandType: CLOSE_COMMAND_TYPE, resultRef: stored });
      return { sessionId, status: "closed", version: current.version, replayed: false };
    }

    // Transition guard (edge #11): only an OPEN session can be closed. NO past-guard — closing a
    // session whose start has passed is the normal completion.
    if (current.status !== "open") {
      failClose("SESSION_NOT_OPEN", "only an open session can be closed");
    }

    // expectedVersion validation runs on the MUTATE branch ONLY — AFTER the idempotent no-op above,
    // so an already-closed session wins the no-op even with a malformed expectedVersion (edge #27).
    // A provided value must be a positive int4; then it is MANDATORY (edge #26): missing OR mismatch
    // → STALE_VERSION. Version is checked BEFORE the money guard (a stale charged request →
    // STALE_VERSION, not CANCEL_REQUIRES_REVIEW).
    if (input.expectedVersion !== undefined && !isInt4(input.expectedVersion, 1)) {
      failClose("STALE_VERSION", "expected_version must be a positive integer");
    }
    if (input.expectedVersion === undefined || input.expectedVersion !== current.version) {
      failClose("STALE_VERSION", "expected_version is required and must match the current version");
    }

    // Money fail-closed (edge #5 / DD-117): a session with ANY charge → CANCEL_REQUIRES_REVIEW.
    if (await sessionHasCharges(tx, sessionId)) {
      failClose(
        "CANCEL_REQUIRES_REVIEW",
        "cannot close a session with existing charges — resolution requires review_policy",
      );
    }

    const [updated] = await tx
      .update(sessions)
      .set({
        status: "closed",
        version: sql`${sessions.version} + 1`,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(sessions.id, sessionId))
      .returning({ id: sessions.id, status: sessions.status, version: sessions.version });

    // DD-12 immediate-deny fence: a closed session leaves the public projection → raise the fence
    // UNCONDITIONALLY on the transition (owner carry-forward; shared helper), reason 'closed'.
    await raisePublicSessionFence(tx, updated!.id, "closed");

    // One session.closed outbox row (§4 Events: {session_id, close_reason}). close_reason 'manual'
    // — a host-initiated close (no auto-close mechanism exists yet).
    await tx.insert(outboxEvents).values({
      tenantId,
      aggregateType: "session",
      aggregateId: updated!.id,
      sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${updated!.id}), 0) + 1`,
      type: "session.closed",
      payload: { session_id: updated!.id, close_reason: "manual" },
    });

    const stored: StoredCloseResult = {
      sessionId: updated!.id,
      status: updated!.status,
      version: updated!.version,
    };
    await tx
      .insert(processedCommands)
      .values({ tenantId, commandId, commandType: CLOSE_COMMAND_TYPE, resultRef: stored });
    return {
      sessionId: stored.sessionId,
      status: stored.status,
      version: stored.version,
      replayed: false,
    };
  });
}

// ============================ CancelSession ============================

export type CancelSessionErrorCode =
  | "SESSION_NOT_FOUND"
  | "SESSION_NOT_OPEN"
  | "STALE_VERSION"
  | "CANCEL_REQUIRES_REVIEW"
  | "COMMAND_ID_CONFLICT";

export class SessionCancelError extends Error {
  readonly code: CancelSessionErrorCode;
  constructor(code: CancelSessionErrorCode, message: string) {
    super(message);
    this.name = "SessionCancelError";
    this.code = code;
  }
}

/** Authorization denial for cancel_session (obligation-termination, DD-110 D2): allowed for
 *  active/past_due and a `suspended` tenant OR subscription, but DENIED for a `cancelled`/missing
 *  subscription or a `cancelled`/anomalous tenant — so this error is reachable, not a dead default. */
export class SessionCancelAuthorizationError extends Error {
  readonly code: "TENANT_SUSPENDED";
  constructor() {
    super("tenant is not permitted to cancel sessions");
    this.name = "SessionCancelAuthorizationError";
    this.code = "TENANT_SUSPENDED";
  }
}

const failCancel = (code: CancelSessionErrorCode, message: string): never => {
  throw new SessionCancelError(code, message);
};

/** User payload. Carries NO tenant_id/actor/commandId (those are trusted context). */
export interface CancelSessionInputPayload {
  sessionId: string;
  /** Optimistic-concurrency guard; MANDATORY on the mutate branch, ALL sources (edge #26). */
  expectedVersion?: number;
}

export interface CancelSessionParams {
  tenantId: string; // trusted routing context, asserted as a UUID by withTenant
  commandId: string; // idempotency key from trusted context
  input: CancelSessionInputPayload;
}

/** result_ref envelope: status is always 'cancelled' after the command. commandId-only dedup. */
interface StoredCancelResult {
  sessionId: string;
  status: string;
  version: number;
  /**
   * Audit 2026-09-06 D-5: the draft-anomaly branch commits its audit event and then throws
   * CANCEL_REQUIRES_REVIEW, but until this field existed it wrote NO processed_commands row —
   * so a retry with the same commandId (the idempotency key the whole family dedups on, DD-117
   * D5) ran the branch again and appended ANOTHER expiry_anomaly_detected event, every time
   * (INV-6). The refusal is now stored under the commandId and replayed as the same typed
   * refusal, with zero writes.
   */
  refusal?: "CANCEL_REQUIRES_REVIEW";
}

export interface CancelSessionResult {
  sessionId: string;
  status: string;
  version: number;
  replayed: boolean;
}

const CANCEL_COMMAND_TYPE = "CancelSession";

/** Guards a replayed result_ref before trusting it: UUID id, status 'cancelled', integer version in
 *  the sessions.version int4 domain [1, INT4_MAX] — a corrupt/hand-written row fails closed. */
function isStoredCancelResult(value: unknown): value is StoredCancelResult {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  // A stored refusal (D-5) keeps the session's PRE-refusal status ('draft'); a stored success is
  // always 'cancelled'. Anything else is not a usable envelope → COMMAND_ID_CONFLICT upstream.
  const statusOk =
    r.refusal === "CANCEL_REQUIRES_REVIEW"
      ? r.status === "draft"
      : r.refusal === undefined && r.status === "cancelled";
  return (
    typeof r.sessionId === "string" &&
    UUID_RE.test(r.sessionId) &&
    statusOk &&
    typeof r.version === "number" &&
    Number.isInteger(r.version) &&
    r.version >= 1 &&
    r.version <= INT4_MAX
  );
}

/** CANONICAL active-roster count for a session — the SINGLE source for the active-roster aggregate,
 *  read by BOTH updateSession's CAPACITY_BELOW_ROSTER guard and cancelSession (so the two can never
 *  drift on separate formulas). Gate #3 (owner, 2026-08-26) makes a non-zero active roster a
 *  fail-closed REFUSAL on the open cancel path (see cancelSession), so on cancel's clean path this is
 *  0. NOT the draft-anomaly probe — that needs ANY player, active or not (see sessionHasAnyPlayer). */
async function sessionActiveRosterCount(tx: Tx, sessionId: string): Promise<number> {
  const rows = await tx
    .select({ n: sql<number>`count(*)` })
    .from(players)
    .where(and(eq(players.sessionId, sessionId), eq(players.status, "active")));
  return Number(rows[0]!.n);
}

/** ANY player row on a session regardless of status ('active'|'left'|'waitlisted'). The draft-discard
 *  anomaly invariant (edge #28) is "a draft has NO players at all" — a charge-free 'left'/'waitlisted'
 *  row is still an anomaly, so the guard must NOT use the active-only count. */
async function sessionHasAnyPlayer(tx: Tx, sessionId: string): Promise<boolean> {
  const rows = await tx
    .select({ x: sql<number>`1` })
    .from(players)
    .where(eq(players.sessionId, sessionId))
    .limit(1);
  return rows.length > 0;
}

/**
 * CancelSession — transition a `draft` OR `open` session to `cancelled` (obligation-termination:
 * allowed under suspension on EITHER axis, DD-110 D2, but still denies a `cancelled`/missing tenant or
 * subscription). One withTenant transaction, S2 pattern — the same shape as closeSession: upfront
 * suspension gate → validate → advisory command-key lock → commandId-only dedup (DD-117 D5) → FOR
 * UPDATE lock → idempotent no-op (already cancelled) → transition/past guards → MANDATORY
 * expectedVersion (isInt4 + match, AFTER the no-op) → paid/roster-impact fail-closed → mutate + version
 * bump + updated_at=clock_timestamp() → DD-12 fence ('cancelled', unconditional) → one session.cancelled
 * outbox row → record. Guard order (Reviewed "Host-initiated discard"): transition/past (step 4) →
 * version (step 5) → paid-impact (step 6). Sources differ:
 *  - `open` (edge #11/#31): past-guard FIRST — an open session whose starts_at has passed →
 *    SESSION_NOT_OPEN BEFORE version and money (a realized game needs privileged correction). Then
 *    (open-FUTURE only) paid/roster-impact: an ACTIVE roster (gate #3) OR ANY charge (edge #5) →
 *    CANCEL_REQUIRES_REVIEW (after the version check, so a stale request → STALE_VERSION).
 *  - `draft` (edge #25/#28): NO past-guard (never was open). A draft must have NO players (any status)
 *    and NO charges; any → COMMIT an append-only session.expiry_anomaly_detected audit event (the audit
 *    must survive the refusal), then fail-closed CANCEL_REQUIRES_REVIEW thrown AFTER the tx commits.
 *
 * Two deltas from the historical reference, owner-ratified for this slice:
 *  (1) no-op-wins-over-version: isInt4(expectedVersion) runs on the mutate branch AFTER the no-op (the
 *      house pattern B1's closeSession established) — an already-cancelled session no-ops even with a
 *      malformed version. (The reference validated isInt4 before the lock; that ordering is fixed here.)
 *  (2) gate #3 (owner, 2026-08-26): an OPEN session with a non-zero ACTIVE roster REFUSES
 *      (CANCEL_REQUIRES_REVIEW) rather than proceeding-and-recording. review_policy does not exist to
 *      resolve a roster, so cancelling over one silently is the "no silent cancellation" hazard (edge
 *      #5) — fail-closed, same as a charge. The proceed-with-roster CA3 path (which records a real
 *      roster_count) is out of scope until review_policy lands; on the clean path here roster_count is 0.
 */
export async function cancelSession(
  db: Db,
  params: CancelSessionParams,
): Promise<CancelSessionResult> {
  const { tenantId, commandId, input } = params;
  // A draft-anomaly refusal must COMMIT its audit event and only THEN throw — so the callback returns
  // a discriminated union (a normal result, or an anomaly-refusal sentinel) and the throw happens
  // after withTenant has committed (see the function tail). Every other refusal still throws inside
  // the tx (a correct rollback: zero mutation, no persisted state).
  const outcome = await withTenant(
    db,
    tenantId,
    async (tx): Promise<CancelSessionResult | { anomalyRefusal: true }> => {
      // Suspension gate (DD-110 D2): cancel_session is an obligation-termination class — authorize-
      // TenantAction allows active/past_due AND a `suspended` tenant OR subscription, but DENIES a
      // `cancelled`/missing subscription or a `cancelled`/anomalous tenant, so the `!allowed` branch is
      // REACHABLE. Called upfront: the resolver's FOR SHARE locks on tenants/subscriptions persist for
      // the whole tx, so the decision — including its deny cases — stays stable through the mutation
      // without a separate under-lock re-check (same concurrency guarantee the deny-path classes use).
      const decision = await authorizeTenantAction(tx, tenantId, "cancel_session");
      if (!decision.allowed) {
        throw new SessionCancelAuthorizationError();
      }

      if (typeof input !== "object" || input === null || Array.isArray(input)) {
        failCancel("SESSION_NOT_FOUND", "session not found in tenant context");
      }
      if (typeof input.sessionId !== "string" || !UUID_RE.test(input.sessionId)) {
        failCancel("SESSION_NOT_FOUND", "session not found in tenant context");
      }
      const sessionId = input.sessionId.toLowerCase();

      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
      );

      // Dedup (edge #3) — commandId-only (DD-117 D5): a replayed commandId for the SAME session returns
      // the stored envelope; a different session or a foreign command_type conflicts.
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
        const stored = prior[0]!.resultRef as StoredCancelResult | null;
        if (
          prior[0]!.commandType === CANCEL_COMMAND_TYPE &&
          isStoredCancelResult(stored) &&
          stored.sessionId === sessionId
        ) {
          // A stored REFUSAL replays as the same refusal (D-5): no second audit event, no mutation.
          // Thrown inside the tx on purpose — nothing has been written yet, so rollback is a no-op.
          if (stored.refusal === "CANCEL_REQUIRES_REVIEW") {
            failCancel(
              "CANCEL_REQUIRES_REVIEW",
              "draft carries an unexpected roster or charges (anomaly) — refusal replayed for this command_id",
            );
          }
          return {
            sessionId: stored.sessionId,
            status: stored.status,
            version: stored.version,
            replayed: true,
          };
        }
        failCancel(
          "COMMAND_ID_CONFLICT",
          "command_id belongs to a different command or session, or has no usable result",
        );
      }

      const [locked] = await tx
        .select({ status: sessions.status, version: sessions.version })
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .for("update");
      if (locked === undefined) {
        failCancel("SESSION_NOT_FOUND", "session not found in tenant context");
      }
      const current = locked!;

      // Idempotent no-op: already cancelled → success no-op, zero mutation, no duplicate event. Does
      // NOT check expectedVersion AT ALL — neither match NOR int4 validity — so an already-cancelled
      // session wins the no-op even with a malformed expectedVersion (edge #27 no-op-wins-over-version).
      // The int4 validation deliberately runs AFTER this branch, on the mutate path only (carry-over #1
      // from B1's closeSession — NOT the historical reference's before-the-lock ordering).
      if (current.status === "cancelled") {
        const stored: StoredCancelResult = {
          sessionId,
          status: "cancelled",
          version: current.version,
        };
        await tx
          .insert(processedCommands)
          .values({ tenantId, commandId, commandType: CANCEL_COMMAND_TYPE, resultRef: stored });
        return { sessionId, status: "cancelled", version: current.version, replayed: false };
      }

      // Transition guard: a closed session cannot be cancelled (edge #11).
      if (current.status === "closed") {
        failCancel("SESSION_NOT_OPEN", "a closed session cannot be cancelled");
      }
      // Only draft or open reach here (cancelled/closed handled above). Defensive fail-closed for any
      // other value (schema drift).
      if (current.status !== "draft" && current.status !== "open") {
        failCancel("SESSION_NOT_OPEN", "session is not in a cancellable state");
      }

      // Step 4 — Past-guard for the `open` source ONLY (edge #11/#31). The Reviewed algorithm
      // ("Host-initiated discard") pins the order transition/past (step 4) → version (step 5) →
      // paid-impact (step 6). An `open` session whose starts_at has passed → SESSION_NOT_OPEN
      // UNCONDITIONALLY here, BEFORE version and paid-impact: a past session is a realized game needing
      // privileged correction (edge #11), never the ordinary cancel path — so it never reaches step 6,
      // even if it carries charges or a roster. A `draft` has NO past-guard (edge #25 — never was open).
      // SEPARATE post-lock clock_timestamp() query (lock-wait-safe, mirror updateSession/announce —
      // never now()/Date.now()).
      if (current.status === "open") {
        const clockResult = await tx.execute(
          sql`select (${sessions.startsAt} <= clock_timestamp()) as "isPast" from ${sessions} where ${sessions.id} = ${sessionId}`,
        );
        if ((clockResult.rows[0] as { isPast: boolean }).isPast) {
          failCancel(
            "SESSION_NOT_OPEN",
            "an open session whose start has passed cannot be cancelled via this path (edge #11/#31)",
          );
        }
      }

      // Step 5 — expectedVersion on the MUTATE branch, ALL sources (edge #26), AFTER the no-op and the
      // past-guard. isInt4 validity THEN mandatory match — BOTH here (carry-over #1: the house pattern
      // runs isInt4 on the mutate path, not before the lock, so the no-op wins over a malformed
      // version). Checked BEFORE paid-impact, so a stale charged/rostered request → STALE_VERSION.
      if (input.expectedVersion !== undefined && !isInt4(input.expectedVersion, 1)) {
        failCancel("STALE_VERSION", "expected_version must be a positive integer");
      }
      if (input.expectedVersion === undefined || input.expectedVersion !== current.version) {
        failCancel(
          "STALE_VERSION",
          "expected_version is required and must match the current version",
        );
      }

      // Step 6 — paid/roster-impact, AFTER the version check (step 5). Only an OPEN-FUTURE session (past
      // ones exited at step 4) or a DRAFT reaches here.
      if (current.status === "open") {
        // Open source: fail-closed on financial OR roster impact until review_policy exists. ANY charge
        // (edge #5, a nonterminal finance root) OR a non-zero ACTIVE roster (gate #3) →
        // CANCEL_REQUIRES_REVIEW. The roster REFUSES (owner gate #3, 2026-08-26: "roster_count != 0 is a
        // refusal path, not an advisory") — cancelling over a roster with no review_policy is the "no
        // silent cancellation" hazard; the proceed-and-record CA3 path is out of scope until review_policy
        // lands. Plain rollback, NO event (the spec specifies session.expiry_anomaly_detected only for the
        // draft path). Runs AFTER the version check, so a stale request against a charged/rostered open
        // session returns STALE_VERSION. If it reaches the clean path below, the active roster is 0.
        if (
          (await sessionActiveRosterCount(tx, sessionId)) !== 0 ||
          (await sessionHasCharges(tx, sessionId))
        ) {
          failCancel(
            "CANCEL_REQUIRES_REVIEW",
            "cannot cancel an open session with an active roster or existing charges — resolution requires review_policy",
          );
        }
      } else {
        // Draft source (edge #25/#28): the app invariant is "a draft has NO players and NO charges". The
        // probe is ANY player row regardless of status ('active'|'left'|'waitlisted') — a charge-free
        // 'left'/'waitlisted' row is STILL an anomaly. Fail-closed CANCEL_REQUIRES_REVIEW — AND the
        // reviewed authority (edge #28 + §4 Events) requires an append-only session.expiry_anomaly_detected
        // audit event on EVERY host-discard detection. A throw HERE would roll that write back (a throw
        // inside the tx discards prior writes), so we COMMIT the audit now (no session mutation) and throw
        // the typed refusal AFTER withTenant returns (function tail). anomaly_fields is the REDACTED set of
        // violated invariant field names — never the roster size or charge amounts (HARD RULE: no PII/money
        // in events). `['charges']` CAN appear alone: charges.player_id binds its player only by
        // `(tenant_id, player_id)` (0019 FK), NOT by `session_id`, so a charge on THIS session may
        // reference a same-tenant player belonging to a DIFFERENT session — then this session has a charge
        // (`hasCharges`) but no player row of its own (`hasAnyPlayer` false) → `['charges']`. Both probes
        // are independent and either alone is fail-closed refused.
        const hasCharges = await sessionHasCharges(tx, sessionId);
        const hasAnyPlayer = await sessionHasAnyPlayer(tx, sessionId);
        if (hasCharges || hasAnyPlayer) {
          const anomalyFields: string[] = [];
          if (hasAnyPlayer) anomalyFields.push("players");
          if (hasCharges) anomalyFields.push("charges");
          await tx.insert(outboxEvents).values({
            tenantId,
            aggregateType: "session",
            aggregateId: sessionId,
            sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${sessionId}), 0) + 1`,
            type: "session.expiry_anomaly_detected",
            payload: {
              session_id: sessionId,
              tenant_id: tenantId,
              source: "manual",
              anomaly_fields: anomalyFields,
            },
          });
          // D-5: bind the refusal to this commandId so a retry replays it instead of appending a
          // second audit event (INV-6). Same transaction as the event: both commit or neither.
          const storedRefusal: StoredCancelResult = {
            sessionId,
            status: current.status,
            version: current.version,
            refusal: "CANCEL_REQUIRES_REVIEW",
          };
          await tx.insert(processedCommands).values({
            tenantId,
            commandId,
            commandType: CANCEL_COMMAND_TYPE,
            resultRef: storedRefusal,
          });
          return { anomalyRefusal: true };
        }
      }

      // Clean path (open-future with no active roster and no charges, or an empty draft). roster_count
      // is provably 0 here: gate #3 refuses a non-zero active roster on the open path, and an empty
      // draft has none. It stays in the session.cancelled event as a forward-compat field (the CA3
      // proceed-with-roster path will record a real count once review_policy lands).
      const [updated] = await tx
        .update(sessions)
        .set({
          status: "cancelled",
          version: sql`${sessions.version} + 1`,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(sessions.id, sessionId))
        .returning({ id: sessions.id, status: sessions.status, version: sessions.version });

      // DD-12 immediate-deny fence: a cancelled session leaves the public projection → raise
      // UNCONDITIONALLY on the transition (owner carry-forward; shared helper), reason 'cancelled'.
      await raisePublicSessionFence(tx, updated!.id, "cancelled");

      // One session.cancelled outbox row (§4 Events: {session_id, roster_count, has_paid,
      // cancel_reason}). has_paid is false and roster_count is 0: this point is reached only after the
      // paid/roster guard passed (open → no charges and no active roster; draft → empty). cancel_reason
      // 'manual' — a client/host cancel (the auto-expiry job that emits 'auto' is a separate lane).
      await tx.insert(outboxEvents).values({
        tenantId,
        aggregateType: "session",
        aggregateId: updated!.id,
        sequence: sql`coalesce((select max(${outboxEvents.sequence}) from ${outboxEvents} where ${outboxEvents.aggregateId} = ${updated!.id}), 0) + 1`,
        type: "session.cancelled",
        payload: {
          session_id: updated!.id,
          roster_count: 0,
          has_paid: false,
          cancel_reason: "manual",
        },
      });

      const stored: StoredCancelResult = {
        sessionId: updated!.id,
        status: updated!.status,
        version: updated!.version,
      };
      await tx
        .insert(processedCommands)
        .values({ tenantId, commandId, commandType: CANCEL_COMMAND_TYPE, resultRef: stored });
      return {
        sessionId: stored.sessionId,
        status: stored.status,
        version: stored.version,
        replayed: false,
      };
    },
  );

  // Draft-anomaly path (edge #28): the session.expiry_anomaly_detected audit event was durably
  // COMMITTED inside the transaction above (no session mutation). The typed refusal is thrown HERE,
  // after withTenant has committed, so the rollback a throw-inside-the-tx would trigger cannot discard
  // the audit. Every other refusal already threw inside the tx (correct: zero mutation, nothing to
  // persist); only this one needs its side effect to survive the refusal.
  if ("anomalyRefusal" in outcome) {
    throw new SessionCancelError(
      "CANCEL_REQUIRES_REVIEW",
      "draft carries an unexpected roster or charges (anomaly) — audit recorded; resolution requires review",
    );
  }
  return outcome;
}
