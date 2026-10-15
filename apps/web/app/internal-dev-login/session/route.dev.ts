import { handleDevLoginOtherMethod, handleDevLoginSession } from "../../../lib/dev-login/handlers";

/**
 * Implementation of POST /api/dev/login (local dev only). Routable only under `next dev` with every
 * process-level dev-login condition true (see ../page/route.dev.ts and lib/dev-login/env-policy.mjs).
 * The middleware 307s the virtual public path here while the gate is open (307 keeps the method and
 * the form body); every method runs the full gate itself.
 */
export const dynamic = "force-dynamic";

export const POST = (request: Request) => handleDevLoginSession(request);
const other = (request: Request) => handleDevLoginOtherMethod(request, "POST");
export const GET = other;
export const HEAD = other;
export const PUT = other;
export const PATCH = other;
export const DELETE = other;
export const OPTIONS = other;
