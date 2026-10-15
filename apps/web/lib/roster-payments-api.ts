import { apiFetch } from "./api-client";
import { tenantQuery, type SessionApiContext } from "./sessions-api";

/**
 * Typed browser wrappers for the host roster + manual-payment routes (lane M2c; contracts fixed).
 * Split from sessions-api.ts, which keeps the session DTOs and the session commands; the roster DTOs
 * the detail payload carries (RosterPlayerDto, RosterChargeDto, ...) stay there.
 */

function post<T>(ctx: SessionApiContext, path: string, body: object, method = "POST") {
  return apiFetch<T>(`${path}?${tenantQuery(ctx.tenantId)}`, {
    method,
    json: body,
    csrfToken: ctx.csrfToken,
  });
}

const sessionPath = (sessionId: string) => `/api/sessions/${encodeURIComponent(sessionId)}`;

export interface AddPlayerResultDto {
  player: {
    id: string;
    membershipId: string;
    status: string;
    waitlistPosition: number | null;
    chargeId: string | null;
  };
  replayed: boolean;
}

/** Host-add by display name only: DD-85 forbids resolving a name to an existing member. */
export function addPlayer(
  ctx: SessionApiContext,
  sessionId: string,
  body: { commandId: string; displayName: string },
): Promise<AddPlayerResultDto> {
  return post(ctx, `${sessionPath(sessionId)}/players`, body);
}

export function removePlayer(
  ctx: SessionApiContext,
  sessionId: string,
  playerId: string,
  body: { commandId: string },
): Promise<{ player: { id: string; status: string }; replayed: boolean }> {
  return post(
    ctx,
    `${sessionPath(sessionId)}/players/${encodeURIComponent(playerId)}`,
    body,
    "DELETE",
  );
}

export type PaymentMethod = "cash" | "attested_transfer";

export interface MarkPaidLineDto {
  playerId: string;
  chargeId: string;
  amountDue: number;
  effectiveBefore: number;
  remaining: number;
  amount: number;
  allocationId?: string;
  status?: string;
}

export interface MarkPaidResultDto {
  preview: boolean;
  replayed: boolean;
  method: PaymentMethod;
  total: number;
  lines: MarkPaidLineDto[];
}

/** Preview writes nothing and consumes no command key (the gate still wants a commandId field). */
export function previewMarkPaid(
  ctx: SessionApiContext,
  sessionId: string,
  body: { method: PaymentMethod; items: { playerId: string }[] },
): Promise<MarkPaidResultDto> {
  return post(ctx, `${sessionPath(sessionId)}/mark-paid`, {
    ...body,
    preview: true,
    commandId: crypto.randomUUID(),
  });
}

export function confirmMarkPaid(
  ctx: SessionApiContext,
  sessionId: string,
  body: {
    commandId: string;
    method: PaymentMethod;
    items: { playerId: string; amount: number }[];
    expectedTotal: number;
    note?: string;
  },
): Promise<MarkPaidResultDto> {
  return post(ctx, `${sessionPath(sessionId)}/mark-paid`, body);
}

export function reversePayment(
  ctx: SessionApiContext,
  sessionId: string,
  allocationId: string,
  body: { commandId: string; reason: string },
): Promise<{ reversal: { id: string; amount: number; chargeStatus: string }; replayed: boolean }> {
  return post(
    ctx,
    `${sessionPath(sessionId)}/payments/${encodeURIComponent(allocationId)}/reverse`,
    body,
  );
}
