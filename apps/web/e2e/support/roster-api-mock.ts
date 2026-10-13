import type { MockSession } from "./session-api-mock";

/**
 * Roster + manual-payment half of the browser-side API mock (lane M2c-fe). It mirrors the server's
 * contracts closely enough to exercise the UI end to end: allowlists by status, the preview ->
 * confirm binding (expectedTotal = sum of item amounts, an explicit amount on every confirm item),
 * a ledger that only ever appends, and the domain error codes the screens map.
 */
interface Alloc {
  id: string;
  source: string;
  amount: number;
  createdAt: string;
  reasonCode: string | null;
  reversesAllocationId: string | null;
}
interface Charge {
  id: string;
  amountDue: number;
  amountAllocated: number;
  status: string;
  effectiveAllocated: number;
  remaining: number;
  allocations: Alloc[];
}
interface Player {
  id: string;
  membershipId: string;
  displayName: string | null;
  status: string;
  joinedAt: string;
  waitlistPosition: number | null;
  charge: Charge | null;
}

export type RosterResult =
  | { status: 200; data: unknown }
  | { status: number; error: { code: string; message: string; statusCode: number } };

const fail = (code: string, message: string, status = 409): RosterResult => ({
  status,
  error: { code, message, statusCode: status },
});

/** Ledger -> charge fields: the SUM is the only truth (reversals are negative rows). */
export function recompute(c: Charge): void {
  const effective = c.allocations.reduce((s, a) => s + a.amount, 0);
  c.effectiveAllocated = effective;
  c.amountAllocated = effective;
  if (c.status !== "void") {
    c.remaining = c.amountDue - effective;
    c.status = effective <= 0 ? "open" : effective >= c.amountDue ? "paid" : "partial";
  }
}

/** `preview` is its own key so a test can fail the confirm without consuming the preview call. */
export function rosterRouteKey(
  method: string,
  path: string,
  body: Record<string, unknown> | null = null,
): string | null {
  if (/^\/api\/sessions\/[^/]+\/players$/.test(path) && method === "POST") return "add";
  if (/^\/api\/sessions\/[^/]+\/players\/[^/]+$/.test(path) && method === "DELETE") return "remove";
  if (/^\/api\/sessions\/[^/]+\/mark-paid$/.test(path) && method === "POST")
    return body?.preview === true ? "preview" : "mark-paid";
  if (/^\/api\/sessions\/[^/]+\/payments\/[^/]+\/reverse$/.test(path) && method === "POST")
    return "reverse";
  return null;
}

/**
 * Idempotency, as the server does it: a command is applied once per (route key, commandId); a repeat
 * answers the stored result with `replayed: true` and changes nothing. A 4xx is never stored (the
 * server did not apply it), so the same id may be tried again. Preview carries no command key.
 */
const applied = new WeakMap<MockSession[], Map<string, unknown>>();
export function handleRoster(
  state: MockSession[],
  key: string,
  path: string,
  body: Record<string, unknown> | null,
): RosterResult {
  const commandId = typeof body?.commandId === "string" ? body.commandId : null;
  if (key === "preview" || commandId === null) return applyRoster(state, key, path, body);
  const store = applied.get(state) ?? new Map<string, unknown>();
  applied.set(state, store);
  const slot = `${key}:${commandId}`;
  if (store.has(slot))
    return { status: 200, data: { ...(store.get(slot) as object), replayed: true } };
  const result = applyRoster(state, key, path, body);
  if ("data" in result) store.set(slot, result.data);
  return result;
}

let seq = 0;
function applyRoster(
  state: MockSession[],
  key: string,
  path: string,
  body: Record<string, unknown> | null,
): RosterResult {
  // /api/sessions/:sessionId/<players|payments|mark-paid>/:tail/...
  const parts = path.split("/");
  const sessionId = parts[3];
  const tail = parts[5];
  const session = state.find((s) => s.id === sessionId);
  if (!session) return fail("SESSION_NOT_FOUND", "Không tìm thấy kèo.", 404);
  const players = session.players as Player[];
  const b = body ?? {};

  if (key === "add") {
    if (session.status !== "open") return fail("SESSION_NOT_OPEN", "Buổi chưa mở.");
    const displayName = String(b.displayName ?? "").trim();
    if (!displayName) return fail("INVALID_BODY", "Dữ liệu chưa hợp lệ.", 400);
    // No name-dedup: DD-85 host-add never resolves a name to a member, so the server has no way to
    // answer ALREADY_JOINED for a repeated displayName. Tests inject that error with failNext("add").
    seq += 1;
    const occupied =
      players.filter((p) => p.status === "active").length + session.guestNotes.length;
    const full = session.slotsMax !== null && occupied >= session.slotsMax;
    const waitlisted = players.filter((p) => p.status === "waitlisted").length;
    const player: Player = {
      id: `np-${seq}`,
      membershipId: `nm-${seq}`,
      displayName,
      status: full ? "waitlisted" : "active",
      joinedAt: new Date().toISOString(),
      waitlistPosition: full ? waitlisted + 1 : null,
      charge: full
        ? null
        : {
            id: `nc-${seq}`,
            amountDue: session.priceAmount,
            amountAllocated: 0,
            status: "open",
            effectiveAllocated: 0,
            remaining: session.priceAmount,
            allocations: [],
          },
    };
    players.push(player);
    return {
      status: 200,
      data: {
        player: {
          id: player.id,
          membershipId: player.membershipId,
          status: player.status,
          waitlistPosition: player.waitlistPosition,
          chargeId: player.charge?.id ?? null,
        },
        replayed: false,
      },
    };
  }

  if (key === "remove") {
    if (session.status !== "open") return fail("SESSION_NOT_OPEN", "Buổi chưa mở.");
    const player = players.find((p) => p.id === tail);
    if (!player) return fail("PLAYER_NOT_FOUND", "Không tìm thấy người chơi.", 404);
    if ((player.charge?.effectiveAllocated ?? 0) > 0)
      return fail(
        "REMOVE_REQUIRES_REVIEW",
        "Người chơi đã có thanh toán — hãy hoàn tác thanh toán trước khi gỡ.",
      );
    player.status = "left";
    if (player.charge) {
      player.charge.status = "void";
      player.charge.remaining = 0;
    }
    return { status: 200, data: { player: { id: player.id, status: "left" }, replayed: false } };
  }

  if (key === "mark-paid" || key === "preview") {
    if (session.status !== "open" && session.status !== "closed")
      return fail("SESSION_NOT_OPEN", "Buổi không nhận thanh toán.");
    const items = (b.items as { playerId: string; amount?: number }[]) ?? [];
    const lines = [];
    for (const item of items) {
      const charge = players.find((p) => p.id === item.playerId)?.charge;
      if (!charge) return fail("PLAYER_NOT_FOUND", "Không tìm thấy người chơi.", 404);
      if (charge.remaining <= 0)
        return fail("CHARGE_ALREADY_SETTLED", "Khoản thu này đã được thanh toán đủ.");
      lines.push({
        playerId: item.playerId,
        chargeId: charge.id,
        amountDue: charge.amountDue,
        effectiveBefore: charge.effectiveAllocated,
        remaining: charge.remaining,
        amount: item.amount ?? charge.remaining,
      });
    }
    const total = lines.reduce((s, l) => s + l.amount, 0);
    if (b.preview === true)
      return {
        status: 200,
        data: { preview: true, replayed: false, method: b.method, total, lines },
      };
    if (items.some((i) => typeof i.amount !== "number"))
      return fail("INVALID_BODY", "Dữ liệu chưa hợp lệ.", 400);
    if (b.expectedTotal !== total)
      return fail("MARK_PAID_TOTAL_MISMATCH", "Số tiền đã thay đổi — xem lại rồi xác nhận lại.");
    if (lines.some((l) => l.amount > l.remaining))
      return fail("ALLOCATION_EXCEEDS_FUNDS", "Số tiền vượt quá khoản còn thiếu.");
    const applied = lines.map((l) => {
      const charge = players.find((p) => p.id === l.playerId)!.charge!;
      seq += 1;
      const id = `al-${seq}`;
      charge.allocations.push({
        id,
        source: String(b.method),
        amount: l.amount,
        createdAt: new Date().toISOString(),
        reasonCode: typeof b.note === "string" ? b.note : null,
        reversesAllocationId: null,
      });
      recompute(charge);
      return { ...l, allocationId: id, status: charge.status };
    });
    return {
      status: 200,
      data: { preview: false, replayed: false, method: b.method, total, lines: applied },
    };
  }

  // reverse: /api/sessions/:id/payments/:allocationId/reverse
  const charge = players.find((p) => p.charge?.allocations.some((a) => a.id === tail))?.charge;
  const alloc = charge?.allocations.find((a) => a.id === tail);
  if (!charge || !alloc)
    return fail("ALLOCATION_NOT_FOUND", "Không tìm thấy khoản thanh toán.", 404);
  if (typeof b.reason !== "string" || !b.reason.trim())
    return fail("INVALID_BODY", "Dữ liệu chưa hợp lệ.", 400);
  const undone = charge.allocations
    .filter((a) => a.reversesAllocationId === alloc.id)
    .reduce((s, a) => s + a.amount, 0);
  if (alloc.amount + undone <= 0)
    return fail("REVERSAL_EXCEEDS_EFFECTIVE", "Khoản này đã được hoàn tác.");
  seq += 1;
  const reversalId = `rv-${seq}`;
  charge.allocations.push({
    id: reversalId,
    source: "reversal",
    amount: -alloc.amount,
    createdAt: new Date().toISOString(),
    reasonCode: b.reason,
    reversesAllocationId: alloc.id,
  });
  recompute(charge);
  return {
    status: 200,
    data: {
      reversal: {
        id: reversalId,
        allocationId: alloc.id,
        amount: -alloc.amount,
        chargeStatus: charge.status,
      },
      replayed: false,
    },
  };
}
