import { createHash } from "node:crypto";
import type { Tx } from "@plexco/db";
import { decryptConnectorSecret } from "../connector-secrets";

/**
 * In-process cache of a bot's decrypted webhook secret (~60 s). Purpose: the per-request decrypt wrote
 * one routing_audit row per webhook request, which a caller who knows only the (non-secret) path
 * token could abuse to flood the audit table. Now: one decrypt + one audit row per cache fill, so the
 * timing-safe compare can run BEFORE any rate bucket.
 *
 * Key = botId + key_version + digest of the stored ciphertext, so a rotated secret (new ciphertext)
 * or a new key version is never served from a stale entry. Bounded size; expired entries pruned on set.
 * The plaintext lives only in this process's memory for at most TTL_MS (same trust domain that decrypts).
 */
const TTL_MS = 60_000;
const MAX_ENTRIES = 1000;
const cache = new Map<string, { secret: string; expires: number }>();

export interface CachedSecretBot {
  botId: string;
  tenantId: string;
  keyVersion: string | null;
  webhookSecretEnc: Buffer;
}

/** `run` opens the withTenant transaction used for a cache FILL (decrypt + audit row). */
export async function readWebhookSecret(
  bot: CachedSecretBot,
  run: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>,
  now: number = Date.now(),
): Promise<string> {
  const key = `${bot.botId}:${bot.keyVersion ?? ""}:${createHash("sha256").update(bot.webhookSecretEnc).digest("hex")}`;
  const hit = cache.get(key);
  if (hit && hit.expires > now) return hit.secret;
  const secret = await run((tx) =>
    decryptConnectorSecret(
      tx,
      bot.webhookSecretEnc,
      { tenantId: bot.tenantId, botId: bot.botId, purpose: "webhook_secret" },
      bot.keyVersion,
    ),
  );
  if (cache.size >= MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.expires <= now) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) cache.clear(); // ponytail: wholesale clear, LRU if bots > MAX_ENTRIES per process
  }
  cache.set(key, { secret, expires: now + TTL_MS });
  return secret;
}

export function __resetWebhookSecretCacheForTest(): void {
  cache.clear();
}
