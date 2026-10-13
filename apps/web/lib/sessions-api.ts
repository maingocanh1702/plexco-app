import { apiFetch } from "./api-client";

/**
 * Typed browser wrappers for the session routes (FE-INV-3/6: the client only talks to the web
 * boundary and only reads the envelope). DTOs mirror what the routes serialise (Dates arrive as
 * ISO strings); they are re-declared here, never imported from the db package (the /c boundary
 * scan is textual).
 */

export interface SessionScalarsDto {
  id: string;
  sportId: string;
  sportKey: string;
  sportName: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
  venueName: string | null;
  venueAddress: string | null;
  area: string | null;
  skillLevel: string | null;
  priceAmount: number;
  slotsMax: number | null;
  visibility: string;
  joinPolicy: string;
  status: string;
  version: number;
  allowPlayerInvite: boolean;
  createdAt: string;
  updatedAt: string;
}

/** List row = scalars + roster counts (no roster, no money). `occupiedCount` = active players +
 *  guest notes, computed server-side: the ONE capacity numerator (BL-DSC-1; never re-sum on the client). */
export interface SessionListItemDto extends SessionScalarsDto {
  activeCount: number;
  occupiedCount: number;
}

export interface SessionListDto {
  sessions: SessionListItemDto[];
  pageInfo: { hasMore: boolean; nextCursor: string | null };
}

export interface RosterPlayerDto {
  id: string;
  membershipId: string;
  displayName: string | null;
  status: string;
  joinedAt: string;
  waitlistPosition: number | null;
  charge: RosterChargeDto | null;
}

/** One ledger row (append-only; a reversal is a NEGATIVE row pointing at the row it undoes). */
export interface LedgerAllocationDto {
  id: string;
  source: string;
  amount: number;
  createdAt: string;
  reasonCode: string | null;
  reversesAllocationId: string | null;
}

/** Host-view charge: `effectiveAllocated` = SUM of the ledger, `remaining` is server-computed (0 for void). */
export interface RosterChargeDto {
  id: string;
  amountDue: number;
  amountAllocated: number;
  status: string;
  effectiveAllocated: number;
  remaining: number;
  allocations: LedgerAllocationDto[];
}

export interface GuestNoteDto {
  id: string;
  guestName: string;
  note: string | null;
  createdByPersonId: string;
  createdAt: string;
}

export interface SessionDetailDto extends SessionScalarsDto {
  players: RosterPlayerDto[];
  guestNotes: GuestNoteDto[];
  counts: { active: number; waitlisted: number; guestNotes: number; occupied: number };
}

export interface SportDto {
  id: string;
  key: string;
  name: string;
}

export interface CommandResultDto {
  id: string;
  status: string;
  version: number;
}

/** Everything a call needs from the club workspace: which tenant, and the CSRF secret for writes. */
export interface SessionApiContext {
  tenantId: string;
  csrfToken: string;
}

/** Fields the create/edit form can send (see apps/web/lib/session-command-route.ts vocabulary). */
export interface SessionFieldsBody {
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
  priceAmount?: number;
  slotsMax?: number | null;
  visibility?: "private" | "public";
  area?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  joinPolicy?: "open" | "approval";
}

const tenantQuery = (tenantId: string) => `tenant=${encodeURIComponent(tenantId)}`;

export function listSessions(
  tenantId: string,
  params: { status?: string; cursor?: string | null; limit?: number } = {},
  signal?: AbortSignal,
): Promise<SessionListDto> {
  const query = new URLSearchParams({ tenant: tenantId });
  if (params.status) query.set("status", params.status);
  if (params.cursor) query.set("cursor", params.cursor);
  if (params.limit) query.set("limit", String(params.limit));
  return apiFetch<SessionListDto>(`/api/sessions?${query.toString()}`, { signal });
}

export async function getSession(
  tenantId: string,
  sessionId: string,
  signal?: AbortSignal,
): Promise<SessionDetailDto> {
  const data = await apiFetch<{ session: SessionDetailDto }>(
    `/api/sessions/${encodeURIComponent(sessionId)}?${tenantQuery(tenantId)}`,
    { signal },
  );
  return data.session;
}

export async function listSports(signal?: AbortSignal): Promise<SportDto[]> {
  const data = await apiFetch<{ sports: SportDto[] }>("/api/sports", { signal });
  return data.sports;
}

async function command(
  ctx: SessionApiContext,
  path: string,
  method: "POST" | "PUT",
  body: object,
): Promise<CommandResultDto> {
  const data = await apiFetch<{ session: CommandResultDto }>(
    `${path}?${tenantQuery(ctx.tenantId)}`,
    {
      method,
      json: body,
      csrfToken: ctx.csrfToken,
    },
  );
  return data.session;
}

/** `commandId` is the idempotency key: the CALLER generates it once per attempt and reuses it on retry. */
export function createSession(
  ctx: SessionApiContext,
  body: SessionFieldsBody & { commandId: string; sportId: string },
): Promise<CommandResultDto> {
  return command(ctx, "/api/sessions", "POST", body);
}

export function updateSession(
  ctx: SessionApiContext,
  sessionId: string,
  body: SessionFieldsBody & { commandId: string; expectedVersion: number },
): Promise<CommandResultDto> {
  return command(ctx, `/api/sessions/${encodeURIComponent(sessionId)}`, "PUT", body);
}

export type SessionTransition = "publish" | "close" | "cancel";

export function transitionSession(
  ctx: SessionApiContext,
  sessionId: string,
  action: SessionTransition,
  body: { commandId: string; expectedVersion: number },
): Promise<CommandResultDto> {
  return command(ctx, `/api/sessions/${encodeURIComponent(sessionId)}/${action}`, "POST", body);
}

// ---- roster + manual payments (routes shipped by lane M2c; contracts fixed) ----

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
  body: { commandId: string; note?: string },
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
