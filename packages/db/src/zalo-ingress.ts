import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import type pg from "pg";
import type { Db, Tx } from "./client.js";
import {
  channelInboundEvents,
  onboardingRuns,
  onboardingSteps,
  processedCommands,
  zaloBots,
} from "../schema.js";
import { pgErrorChainText, pgErrorHasCode } from "./pg-error.js";
import { withTenant } from "./tenant.js";

/**
 * Zalo bot ingress persistence (web MVP lane M3a, migration 0053). Everything here is DB-only:
 * crypto and the Zalo HTTP calls live in the web process (DD-122 O4: secrets are decrypted only
 * where Zalo is called). Authorization for the bot upsert happens INSIDE the 0053 definer
 * (`connector.secret_manage`); the web gate is defence in depth, never the only check.
 *
 * Every tenant statement runs inside withTenant (HR1). The only pre-tenant call is
 * resolveZaloBotByToken, which goes through the token-lookup definer.
 */

export const ZALO_CONNECTOR_ACTION = "connector.secret_manage";
const COMMAND_TYPE = "ConnectZaloBot";
const STEP = "zalo_connect";

export type ZaloBotStatus = "connecting" | "registered" | "active" | "drift" | "error" | "revoked";

export interface ZaloBotRef {
  botId: string;
  tenantId: string;
  status: ZaloBotStatus;
  webhookSecretEnc: Buffer | null;
  keyVersion: string | null;
  locale: string | null;
}

/** Pre-tenant lookup by the opaque path token. Unknown token -> null (the definer never raises). */
export async function resolveZaloBotByToken(db: Db, token: string): Promise<ZaloBotRef | null> {
  const res = await db.execute(
    sql`SELECT bot_id, tenant_id, status, webhook_secret_enc, key_version, locale
          FROM zalo_bot_resolve_by_webhook_token(${token})`,
  );
  const r = res.rows[0] as
    | {
        bot_id: string;
        tenant_id: string;
        status: ZaloBotStatus;
        webhook_secret_enc: Buffer | null;
        key_version: string | null;
        locale: string | null;
      }
    | undefined;
  if (!r) return null;
  return {
    botId: r.bot_id,
    tenantId: r.tenant_id,
    status: r.status,
    webhookSecretEnc: r.webhook_secret_enc,
    keyVersion: r.key_version,
    locale: r.locale,
  };
}

/** One audit row per decrypt of a connector secret (no secret material, HR2). */
export async function appendSecretDecryptAudit(
  tx: Tx,
  p: { tenantId: string; botId: string; purpose: string },
): Promise<void> {
  await tx.execute(
    sql`SELECT routing_audit_append('zalo.secret_decrypt', NULL, ${p.tenantId}::uuid,
          ${JSON.stringify({ botId: p.botId, purpose: p.purpose })}::jsonb)`,
  );
}

/**
 * Store-before-process. `duplicate` = this (bot, event id) is already stored and must only be acked.
 *
 * A duplicate delivery re-claims the stored row instead (returns its id, `duplicate: false`) when the
 * earlier processing failed, or when the row has sat in 'received' past the window (a crash or
 * timeout between store and finish). Retry-driven, no background job: the one conditional UPDATE is
 * the compare-and-set. Concurrent duplicates serialise on the row lock and the loser re-checks the
 * predicate against the winner's fresh received_at (READ COMMITTED), so exactly one processes.
 * received_at doubles as the claim time. processed / ignored / in-flight rows stay duplicates.
 */
export async function storeInboundEvent(
  tx: Tx,
  p: {
    tenantId: string;
    botId: string;
    externalEventId: string;
    rawPayloadEnc: Buffer;
    keyVersion: string;
  },
): Promise<{ id: string | null; duplicate: boolean }> {
  const rows = await tx
    .insert(channelInboundEvents)
    .values({
      tenantId: p.tenantId,
      platform: "zalo",
      botId: p.botId,
      externalEventId: p.externalEventId,
      rawPayloadEnc: p.rawPayloadEnc,
      keyVersion: p.keyVersion,
    })
    .onConflictDoNothing({
      target: [
        channelInboundEvents.tenantId,
        channelInboundEvents.botId,
        channelInboundEvents.externalEventId,
      ],
    })
    .returning({ id: channelInboundEvents.id });
  if (rows.length > 0) return { id: rows[0]!.id, duplicate: false };
  // ponytail: retry-driven recovery, no reclaimer; the window is the only in-flight-vs-dead heuristic
  const reclaimed = await tx
    .update(channelInboundEvents)
    .set({
      status: "received",
      errorCode: null,
      processedAt: null,
      receivedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(channelInboundEvents.tenantId, p.tenantId),
        eq(channelInboundEvents.botId, p.botId),
        eq(channelInboundEvents.externalEventId, p.externalEventId),
        or(
          eq(channelInboundEvents.status, "failed"),
          and(
            eq(channelInboundEvents.status, "received"),
            lt(channelInboundEvents.receivedAt, sql`clock_timestamp() - interval '5 minutes'`),
          ),
        ),
      ),
    )
    .returning({ id: channelInboundEvents.id });
  return reclaimed.length > 0
    ? { id: reclaimed[0]!.id, duplicate: false }
    : { id: null, duplicate: true };
}

export async function finishInboundEvent(
  tx: Tx,
  p: {
    tenantId: string;
    id: string;
    status: "processed" | "failed" | "ignored";
    errorCode?: string;
  },
): Promise<void> {
  await tx
    .update(channelInboundEvents)
    .set({ status: p.status, errorCode: p.errorCode ?? null, processedAt: sql`clock_timestamp()` })
    .where(and(eq(channelInboundEvents.tenantId, p.tenantId), eq(channelInboundEvents.id, p.id)));
}

export interface ZaloIdentity {
  personId: string;
  channelIdentityId: string;
  created: boolean;
  displayName: string | null;
  hasAccount: boolean;
}

/** DD-15 identity resolve: one Person + channel identity per (bot scope, Zalo user). Never merges. */
export async function resolveZaloIdentity(
  tx: Tx,
  p: {
    tenantId: string;
    botId: string;
    scopeHash: string;
    userHash: string;
    userIdEnc: Buffer;
    displayName: string | null;
  },
): Promise<ZaloIdentity> {
  const res = await tx.execute(
    sql`SELECT person_id, channel_identity_id, created, display_name, has_account
          FROM zalo_identity_resolve(${p.tenantId}::uuid, ${p.botId}::uuid, ${p.scopeHash},
                                     ${p.userHash}, ${p.userIdEnc}, ${p.displayName})`,
  );
  const r = res.rows[0] as {
    person_id: string;
    channel_identity_id: string;
    created: boolean;
    display_name: string | null;
    has_account: boolean;
  };
  return {
    personId: r.person_id,
    channelIdentityId: r.channel_identity_id,
    created: r.created,
    displayName: r.display_name,
    hasAccount: r.has_account,
  };
}

/**
 * RC-1 (R1) link gate: ONE autocommit call of the merged read gate public.channel_identity_link_gate
 * (0064), on the pool and never inside withTenant or a transaction, so the 0034 core's FOR SHARE
 * locks end with the statement. Linked only for (true, <account uuid>); any other row or no row is
 * not linked. A rejection (42501 included) or the P-27 timeout propagates: the one call site maps it
 * to not linked. Never cached. A read gate for a message handler, NOT the DD-50 pay-later resolver:
 * no money action rests on it.
 */
export async function resolveZaloLinkGate(
  pool: pg.Pool,
  channelIdentityId: string,
): Promise<{ linked: boolean; accountRef: string | null }> {
  // @types/pg declares query_timeout on ClientConfig only; pg reads it per query (lib/client.js).
  const query: pg.QueryConfig & { query_timeout: number } = {
    text: "SELECT linked, account_ref FROM public.channel_identity_link_gate($1::uuid)",
    values: [channelIdentityId],
    query_timeout: 2000, // P-27
  };
  const { rows } = await pool.query<{ linked: boolean | null; account_ref: string | null }>(query);
  const r = rows[0];
  return r?.linked === true && typeof r.account_ref === "string"
    ? { linked: true, accountRef: r.account_ref }
    : { linked: false, accountRef: null };
}

/** Ciphertext of the bot token for the web process about to call Zalo (decrypt + audit are the caller's job). */
export async function readZaloBotTokenEnc(
  tx: Tx,
  tenantId: string,
  botId: string,
): Promise<string | null> {
  const [row] = await tx
    .select({ enc: zaloBots.botTokenEnc })
    .from(zaloBots)
    .where(and(eq(zaloBots.tenantId, tenantId), eq(zaloBots.id, botId)));
  return row?.enc ?? null;
}

/**
 * Webhook outcome: the first verified event flips connecting|registered -> active and stamps
 * verified_at once. Bound to the token that authenticated the request: the row is locked FOR UPDATE
 * (serialises against zalo_bot_upsert_for_tenant) and a rotated token means the evidence is for the
 * OLD secret, so nothing flips. `drift` is never cleared here (onboarding tech doc: Tier-2 CAS).
 * "activated" only when the compare-and-set changed the row; a skipped CAS (active, drift, error)
 * returns "unchanged".
 */
export async function markBotVerifiedActive(
  tx: Tx,
  tenantId: string,
  botId: string,
  verifiedToken: string,
): Promise<"activated" | "token_rotated" | "unchanged"> {
  const res = await tx.execute(
    sql`SELECT webhook_token FROM zalo_bots WHERE id = ${botId}::uuid AND tenant_id = ${tenantId}::uuid FOR UPDATE`,
  );
  const stored = (res.rows[0] as { webhook_token: string } | undefined)?.webhook_token;
  if (stored !== verifiedToken) {
    return "token_rotated";
  }
  // touch_setwebhook = false: set_status returns a row only when its CAS actually wrote.
  const set = await tx.execute(
    sql`SELECT 1 FROM zalo_bot_set_status(${tenantId}::uuid, ${botId}::uuid, 'active', true, false, ARRAY['connecting','registered']::text[])`,
  );
  return set.rows.length > 0 ? "activated" : "unchanged";
}

export interface ZaloBotSecretsInput {
  botTokenEnc: string;
  webhookToken: string;
  webhookSecretEnc: Buffer;
  keyVersion: string;
}

export interface ZaloOnboardingState {
  status: ZaloBotStatus | "not_connected";
  verifiedAt: Date | null;
  lastSetwebhookAt: Date | null;
  webhookToken: string | null;
}

async function readState(tx: Tx, tenantId: string): Promise<ZaloOnboardingState> {
  const [row] = await tx
    .select({
      status: zaloBots.status,
      verifiedAt: zaloBots.verifiedAt,
      lastSetwebhookAt: zaloBots.lastSetwebhookAt,
      webhookToken: zaloBots.webhookToken,
    })
    .from(zaloBots)
    .where(eq(zaloBots.tenantId, tenantId));
  if (!row)
    return {
      status: "not_connected",
      verifiedAt: null,
      lastSetwebhookAt: null,
      webhookToken: null,
    };
  return { ...row, status: row.status as ZaloBotStatus };
}

/** Current bot state for the UI (no secrets). Authorization is the CALLER's job. */
export async function getZaloOnboardingState(
  db: Db,
  p: { tenantId: string },
): Promise<ZaloOnboardingState> {
  return withTenant(db, p.tenantId, (tx) => readState(tx, p.tenantId));
}

export type ZaloConnectErrorCode =
  "FORBIDDEN" | "COMMAND_ID_CONFLICT" | "NO_ONBOARDING_RUN" | "BOT_REVOKED";

export class ZaloConnectError extends Error {
  constructor(
    readonly code: ZaloConnectErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ZaloConnectError";
  }
}

export type BeginZaloConnectResult =
  | { replayed: true; state: ZaloOnboardingState }
  | { replayed: false; botId: string; webhookToken: string };

/**
 * Cheap replay probe, run BEFORE any Zalo call: a processed ConnectZaloBot command returns the stored
 * state so a retry never re-validates the token against Zalo. Null = not processed yet.
 */
export async function probeZaloConnectReplay(
  db: Db,
  p: { tenantId: string; commandId: string },
): Promise<ZaloOnboardingState | null> {
  return withTenant(db, p.tenantId, async (tx) => {
    const prior = await tx
      .select({ commandType: processedCommands.commandType })
      .from(processedCommands)
      .where(
        and(
          eq(processedCommands.tenantId, p.tenantId),
          eq(processedCommands.commandId, p.commandId),
        ),
      );
    if (prior.length === 0) return null;
    if (prior[0]!.commandType !== COMMAND_TYPE) {
      throw new ZaloConnectError(
        "COMMAND_ID_CONFLICT",
        "command_id belongs to a different command",
      );
    }
    return readState(tx, p.tenantId);
  });
}

/**
 * Phase 1 of connect: dedup, then upsert the bot as `connecting` with freshly encrypted secrets.
 * `prepare(botId)` runs inside the transaction so ciphertext AAD can bind the final bot id (an
 * existing row keeps its id, a new one gets a pre-allocated id). The Zalo network calls happen
 * AFTER this commits, never inside a transaction.
 */
export async function beginZaloConnect(
  db: Db,
  p: {
    tenantId: string;
    actorPersonId: string;
    commandId: string;
    newBotId: string;
    prepare: (botId: string) => Promise<ZaloBotSecretsInput>;
  },
): Promise<BeginZaloConnectResult> {
  const { tenantId, commandId } = p;
  try {
    return await withTenant(db, tenantId, async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('processed-command:' || ${tenantId}::uuid::text || ':' || ${commandId}, 0))`,
      );
      const prior = await tx
        .select({ commandType: processedCommands.commandType })
        .from(processedCommands)
        .where(
          and(eq(processedCommands.tenantId, tenantId), eq(processedCommands.commandId, commandId)),
        );
      if (prior.length > 0) {
        if (prior[0]!.commandType !== COMMAND_TYPE) {
          throw new ZaloConnectError(
            "COMMAND_ID_CONFLICT",
            "command_id belongs to a different command",
          );
        }
        return { replayed: true as const, state: await readState(tx, tenantId) };
      }
      const [run] = await tx
        .select({ id: onboardingRuns.id })
        .from(onboardingRuns)
        .where(eq(onboardingRuns.tenantId, tenantId))
        .orderBy(desc(onboardingRuns.createdAt))
        .limit(1);
      if (!run) throw new ZaloConnectError("NO_ONBOARDING_RUN", "no onboarding run");

      // One bot per tenant: serialize concurrent connects so the id read below cannot race.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended('zalo-connect:' || ${tenantId}::uuid::text, 0))`,
      );
      const [existing] = await tx
        .select({ id: zaloBots.id })
        .from(zaloBots)
        .where(eq(zaloBots.tenantId, tenantId));
      const botId = existing?.id ?? p.newBotId;
      const s = await p.prepare(botId);
      const res = await tx.execute(
        sql`SELECT bot_id, webhook_token FROM zalo_bot_upsert_for_tenant(
              ${tenantId}::uuid, ${p.actorPersonId}::uuid, ${botId}::uuid, ${s.botTokenEnc},
              ${s.webhookToken}, ${s.webhookSecretEnc}, ${s.keyVersion}, 'connecting')`,
      );
      const r = res.rows[0] as { bot_id: string; webhook_token: string };
      return { replayed: false as const, botId: r.bot_id, webhookToken: r.webhook_token };
    });
  } catch (e) {
    if (pgErrorHasCode(e, "42501")) throw new ZaloConnectError("FORBIDDEN", "not permitted");
    if (pgErrorHasCode(e, "22023") && /bot is revoked/.test(pgErrorChainText(e))) {
      throw new ZaloConnectError("BOT_REVOKED", "bot is revoked");
    }
    throw e;
  }
}

/**
 * Phase 2: record the setWebhook outcome, the onboarding step and the processed command.
 *
 * SUPERSEDED guard: `webhookToken` is the token THIS request registered. If the row now holds another
 * token, a concurrent connect replaced it; this attempt records step `error` / SUPERSEDED, skips the
 * status update and does NOT mark the command processed. The compare runs under the row lock
 * (FOR UPDATE, as markBotVerifiedActive): set_status's CAS checks the status only, so without the lock
 * a newer connect committing between compare and write (READ COMMITTED) would receive this attempt's
 * outcome. The token alone identifies the attempt: the upsert is the only writer of key_version and
 * always writes a fresh token with it. RESIDUAL: the Zalo-side webhook may already
 * point at the loser's URL/secret (setWebhook calls can invert); the winner's own setWebhook normally
 * lands last, but a per-tenant in-flight lease (backlog proposal) is the real fix.
 */
export async function finishZaloConnect(
  db: Db,
  p: {
    tenantId: string;
    botId: string;
    commandId: string;
    webhookToken: string;
    outcome: "registered" | "error";
    reason?: string;
  },
): Promise<{ state: ZaloOnboardingState; superseded: boolean }> {
  const { tenantId } = p;
  return withTenant(db, tenantId, async (tx) => {
    // A concurrent zalo_bot_upsert_for_tenant now waits for this transaction; readState sees the locked row.
    await tx.execute(sql`SELECT 1 FROM zalo_bots WHERE tenant_id = ${tenantId}::uuid FOR UPDATE`);
    const current = await readState(tx, tenantId);
    if (current.webhookToken !== p.webhookToken) {
      const [run] = await tx
        .select({ id: onboardingRuns.id })
        .from(onboardingRuns)
        .where(eq(onboardingRuns.tenantId, tenantId))
        .orderBy(desc(onboardingRuns.createdAt))
        .limit(1);
      if (run) {
        await tx
          .insert(onboardingSteps)
          .values({
            runId: run.id,
            step: STEP,
            status: "error",
            idempotencyKey: p.commandId,
            errorCode: "SUPERSEDED",
            completedAt: sql`now()`,
          })
          .onConflictDoUpdate({
            target: [onboardingSteps.runId, onboardingSteps.step, onboardingSteps.idempotencyKey],
            set: { status: "error", errorCode: "SUPERSEDED", completedAt: sql`now()` },
          });
      }
      return { state: current, superseded: true };
    }
    await tx.execute(
      sql`SELECT 1 FROM zalo_bot_set_status(${tenantId}::uuid, ${p.botId}::uuid, ${p.outcome}, false, true,
              ARRAY['connecting','registered']::text[])`,
    );
    const [run] = await tx
      .select({ id: onboardingRuns.id })
      .from(onboardingRuns)
      .where(eq(onboardingRuns.tenantId, tenantId))
      .orderBy(desc(onboardingRuns.createdAt))
      .limit(1);
    if (!run) throw new ZaloConnectError("NO_ONBOARDING_RUN", "no onboarding run");
    const ok = p.outcome === "registered";
    await tx
      .insert(onboardingSteps)
      .values({
        runId: run.id,
        step: STEP,
        status: ok ? "verified" : "error",
        idempotencyKey: p.commandId,
        errorCode: ok ? null : (p.reason ?? "ZALO_SETWEBHOOK_FAILED").slice(0, 80),
        completedAt: sql`now()`,
      })
      .onConflictDoUpdate({
        target: [onboardingSteps.runId, onboardingSteps.step, onboardingSteps.idempotencyKey],
        set: {
          status: ok ? "verified" : "error",
          errorCode: ok ? null : (p.reason ?? "ZALO_SETWEBHOOK_FAILED").slice(0, 80),
          completedAt: sql`now()`,
        },
      });
    if (ok) {
      // Only a SUCCESSFUL connect is a replayable command; a failed setWebhook may be retried.
      await tx
        .insert(processedCommands)
        .values({
          tenantId,
          commandId: p.commandId,
          commandType: COMMAND_TYPE,
          resultRef: { step: STEP },
        })
        .onConflictDoNothing();
    }
    return { state: await readState(tx, tenantId), superseded: false };
  });
}
