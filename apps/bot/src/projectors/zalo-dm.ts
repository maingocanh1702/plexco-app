import { runWithLang } from "@plexco/core/i18n";
import {
  connectorKeyVersion,
  openConnectorSecret,
  resolveConnectorSecretRoot,
  textToBlob,
} from "@plexco/db/connector-crypto";
import { classifyZaloError, sendMessage, zaloBotApiBase } from "@plexco/db/zalo-bot-api";
import pg from "pg";
import type { DeliverFn, DeliveryOutcome } from "../dispatcher.js";
import { projectorIsEnabled, type Queryable } from "../projector-registry.js";
import { DM_RELEVANT_FIELDS, renderZaloDm, ZALO_DM_TEMPLATES } from "./zalo-dm-templates.js";

/**
 * The zalo_dm projector (lane L4, DD-134 (c); readiness Z-4..Z-15, each a default pending owner
 * sign-off). It DMs, through the Zalo Bot API, the linked ACTIVE roster players of a session whose
 * time, venue or price changed (session.updated) or that was cancelled, the requesting host of
 * session.announcement_requested and, for player.promoted (L8, P-16), the promoted player only,
 * with that player's own fee. Recipients, the bot secret and the per-recipient dispositions go
 * ONLY through the two 0057 definers (app_worker holds no table grant): the targets definer writes
 * the decrypt audit rows before it returns any ciphertext, so an audit failure decrypts nothing.
 *
 * Partial send (Z-8): each send is recorded right after it; every attempt (and every owner DLQ
 * replay) recomputes the recipients and skips recorded ones. A crash or a record failure between a
 * successful send and its record resends exactly that one DM on the next attempt (accepted).
 * The dispatcher is the only retry scheduler (D-7); deliver() returns an outcome on every known
 * failure path and never logs the bot token, a chat id or the DM text.
 */
const ATTEMPT_BUDGET_MS = 120_000; // Z-14: below the 5 min claim lease
const SEND_TIMEOUT_MS = 5_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FALLBACK_TIME_ZONE = "Asia/Ho_Chi_Minh";
const INT4_MAX = 2_147_483_647; // charges.amount_due is int4

const delivered = (providerRef: string): DeliveryOutcome => ({ result: "delivered", providerRef });
const retry = (errorCode: string): DeliveryOutcome => ({ result: "retry", errorCode });
const dlq = (errorCode: string): DeliveryOutcome => ({ result: "dlq", errorCode });

/** The targets definer's single status row (Z-18) -> outcome; any other value is a read failure. */
const STATUS_OUTCOMES: ReadonlyMap<string, DeliveryOutcome> = new Map([
  ["stale", delivered("noop_stale")],
  ["no_recipients", delivered("noop_no_recipients")],
  ["all_recorded", delivered("noop_all_recorded")],
  ["bot_unavailable", dlq("bot_unavailable")],
  ["requester_unlinked", dlq("requester_unlinked")],
]);

interface TargetRow {
  disposition: string;
  bot_id: string | null;
  bot_token_enc: string | null;
  locale: string | null;
  starts_at: Date | null;
  timezone: string | null;
  channel_identity_id: string;
  recipient_user_id_enc: Buffer | null;
}

export interface ZaloDmDeps {
  db: Queryable;
  /** Test seams: the Zalo send, the clock, the per-call timeout and the raw open (decrypt). */
  send?: typeof sendMessage;
  now?: () => number;
  sendTimeoutMs?: number;
  open?: typeof openConnectorSecret;
}

/** APP_BASE_URL as an http(s) prefix without a trailing "/", or null (Z-4: config_missing). */
function appBaseUrl(raw = process.env.APP_BASE_URL): string | null {
  try {
    const url = new URL(raw?.trim() ?? "");
    const plain = !url.username && !url.password && !url.search && !url.hash;
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !plain) return null;
    return `${url.origin}${url.pathname}`.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function createZaloDmDeliver(deps: ZaloDmDeps): DeliverFn {
  const { db, send = sendMessage, now = Date.now, open = openConnectorSecret } = deps;
  const sendTimeoutMs = deps.sendTimeoutMs ?? SEND_TIMEOUT_MS;

  return async (job) => {
    const started = now();
    // 1. The event alone (Z-10, Z-12, Z-32): no DB call, no key material.
    const template = ZALO_DM_TEMPLATES.get(job.event.eventType);
    if (!template) return dlq("unexpected_event_type");
    const payload = isRecord(job.event.payload) ? job.event.payload : {};
    let fields: readonly string[] = [];
    let amountDue: number | undefined;
    if (template === "updated") {
      const changed: unknown = payload.changed_fields;
      if (!Array.isArray(changed) || !changed.every((f) => typeof f === "string")) {
        return dlq("malformed_payload");
      }
      if (!changed.some((f: string) => DM_RELEVANT_FIELDS.has(f))) {
        return delivered("noop_irrelevant_fields");
      }
      fields = changed as string[];
    } else if (template === "announce") {
      const requester = payload.requested_by_person_id;
      if (typeof requester !== "string" || !UUID_RE.test(requester)) return dlq("no_requester");
    } else if (template === "promoted") {
      // DM-6 (R1B-3): the recipient is the promoted player_id, a uuid (a missing one would match
      // nobody and end as a silent noop_no_recipients instead of a dead letter).
      const playerId = payload.player_id;
      if (typeof playerId !== "string" || !UUID_RE.test(playerId)) return dlq("malformed_payload");
      // DM-6: the fee is the promotion charge's amount_due, a whole int4 (0 = a free session).
      const amount = payload.amount_due;
      const whole = typeof amount === "number" && Number.isSafeInteger(amount);
      if (!whole || amount < 0 || amount > INT4_MAX) return dlq("malformed_payload");
      amountDue = amount;
    }

    // 2. Configuration (Z-4, Z-5), before any DB call, decrypt or send.
    try {
      await resolveConnectorSecretRoot();
    } catch {
      return dlq("bot_unavailable");
    }
    const appBase = appBaseUrl();
    if (appBase === null) return dlq("config_missing");
    try {
      zaloBotApiBase();
    } catch {
      return dlq("config_missing");
    }

    // 3. Targets through the live claim (Z-18): zero rows = the claim is no longer ours.
    let rows: TargetRow[];
    try {
      const result = await db.query("SELECT * FROM zalo_dm_delivery_targets($1, $2, $3)", [
        job.eventId,
        job.claimToken,
        connectorKeyVersion(),
      ]);
      rows = result.rows as TargetRow[];
    } catch {
      return retry("targets_read_failed");
    }
    const head = rows[0];
    if (!head) return retry("claim_lost");
    if (head.disposition !== "ok") {
      return STATUS_OUTCOMES.get(head.disposition) ?? retry("targets_read_failed");
    }
    const botId = head.bot_id ?? "";
    let token: string;
    try {
      if (!head.bot_token_enc || !botId) throw new Error("bot secret row incomplete");
      const binding = { tenantId: job.tenantId, botId, purpose: "bot_token" } as const;
      token = await open(textToBlob(head.bot_token_enc), binding);
    } catch {
      return dlq("bot_unavailable");
    }

    // 4. One text per event, in the club's language (DD-118), from the CURRENT session row.
    const link = `${appBase}/c/${job.tenantId}/sessions/${job.event.aggregateId}`;
    const values = {
      startsAt: head.starts_at ?? new Date(Number.NaN),
      timeZone: head.timezone ?? FALLBACK_TIME_ZONE,
      fields,
      link,
      amountDue,
    };
    const text = runWithLang(head.locale === "en" ? "en" : "vi", () =>
      renderZaloDm(template, values),
    );

    const record = async (ci: string, outcome: "sent" | "terminal", code: string | null) => {
      try {
        const result = await db.query("SELECT zalo_dm_record_recipient($1, $2, $3, $4, $5) AS ok", [
          job.eventId,
          job.claimToken,
          ci,
          outcome,
          code,
        ]);
        return result.rows[0]?.ok === true;
      } catch {
        return false;
      }
    };

    // 5. Sequential sends (Z-8, Z-14): re-check the registry and the budget before each one.
    for (const row of rows) {
      const enabled = await projectorIsEnabled(db, "zalo_dm").catch(() => false);
      if (!enabled) return retry("projector_disabled");
      const remaining = ATTEMPT_BUDGET_MS - (now() - started);
      if (remaining <= 0) return retry("send_budget_exhausted");
      let chatId: string;
      try {
        if (!Buffer.isBuffer(row.recipient_user_id_enc)) throw new Error("no recipient ciphertext");
        const binding = { tenantId: job.tenantId, botId, purpose: "channel_user" } as const;
        chatId = await open(row.recipient_user_id_enc, binding);
      } catch {
        if (!(await record(row.channel_identity_id, "terminal", "recipient_undecryptable"))) {
          return retry("record_failed");
        }
        continue;
      }
      let terminalCode: string | null = null;
      try {
        await send(token, chatId, text, { timeoutMs: Math.min(sendTimeoutMs, remaining) });
      } catch (error) {
        const verdict = classifyZaloError(error);
        if (verdict.action === "retry") return retry(verdict.code);
        if (verdict.action === "dlq") return dlq(verdict.code);
        terminalCode = verdict.code; // this recipient only; the others continue
      }
      const outcome = terminalCode === null ? "sent" : "terminal";
      if (!(await record(row.channel_identity_id, outcome, terminalCode))) {
        return retry("record_failed");
      }
    }
    return delivered("sent");
  };
}

let production: { pool: pg.Pool; deliver: DeliverFn } | undefined;

/**
 * The registry's zalo_dm entry (Z-15): a lazily created pool on DATABASE_URL_DIRECT, the app_worker
 * credential preflight already checks; dispatcher.ts, worker.ts and projectors/index.ts are unchanged.
 * Still dark by default: 0056 seeds zalo_dm disabled and enabling it is an owner P0 step.
 */
export const deliverZaloDm: DeliverFn = async (job) => {
  const connectionString = process.env.DATABASE_URL_DIRECT;
  if (!connectionString) return dlq("config_missing");
  if (!production) {
    const pool = new pg.Pool({ connectionString, max: 2, allowExitOnIdle: true });
    pool.on("error", () => console.error("zalo_dm: an idle pool client failed")); // no detail
    production = { pool, deliver: createZaloDmDeliver({ db: pool }) };
  }
  return production.deliver(job);
};

/** Test seam: end the lazily created pool, so no open handle outlives a test file. */
export async function __endZaloDmPoolForTest(): Promise<void> {
  const current = production;
  production = undefined;
  await current?.pool.end();
}
