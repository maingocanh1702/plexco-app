import { and, eq, sql } from "drizzle-orm";
import { outboxEvents, processedCommands, sessions, sports } from "../schema.js";
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
