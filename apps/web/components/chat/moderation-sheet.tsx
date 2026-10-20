"use client";

import type { ChatModerateInput } from "../../lib/chat-api";
import type { ChatListError } from "../../lib/use-chat";
import type { CommandIdKeeper } from "../../lib/use-command-id";

/** The server's closed reason set (0063): the first four need a null note, `other` needs a 1..500-byte one. */
export const MODERATION_REASONS = ["spam", "harassment", "unsafe", "off_topic", "other"] as const;
export type ModerationReason = (typeof MODERATION_REASONS)[number];

export type ModerationCheck =
  | { ok: true; reasonCode: ModerationReason; reasonNote: string | null }
  | { ok: false; problem: "blank" | "too_long" };

/**
 * DM-9: `other` needs a trimmed, non-blank note of at most 500 UTF-8 BYTES (the server measures
 * octet_length, not characters); the trimmed note is what is measured and sent. Every other reason
 * sends `reasonNote: null`, never "", and drops whatever the note field still holds. The server stays
 * the judge: a 422 CHAT_REASON_INVALID still renders its own row.
 */
export function validateModeration(reason: ModerationReason, note: string): ModerationCheck {
  if (reason !== "other") return { ok: true, reasonCode: reason, reasonNote: null };
  const trimmed = note.trim();
  if (trimmed === "") return { ok: false, problem: "blank" };
  if (new TextEncoder().encode(trimmed).length > 500) return { ok: false, problem: "too_long" };
  return { ok: true, reasonCode: reason, reasonNote: trimmed };
}

/**
 * DM-6: one command key per user action. `get()` takes NO payload (the note is sensitive and must not
 * become a fingerprint) and `settle()` is never called (chat-api resolves {ok: false} instead of
 * throwing), so every failure keeps the key and a retry of the same input replays under it. The
 * caller resets the keeper on every reason or note change; a 2xx (null) resets it here.
 */
export async function submitModeration(
  keeper: CommandIdKeeper,
  send: (input: ChatModerateInput) => Promise<ChatListError | null>,
  input: Omit<ChatModerateInput, "commandId">,
): Promise<ChatListError | null> {
  const error = await send({ ...input, commandId: keeper.get() });
  if (error === null) keeper.reset();
  return error;
}
