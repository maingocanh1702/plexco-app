import { handleDevLoginOtherMethod, handleDevLoginPage } from "../../../lib/dev-login/handlers";

/**
 * Implementation of GET /dev-login (local dev only). A `route.dev.ts` file is a route only when
 * next.config.mjs adds the `dev.ts` page extension, which it does solely for `next dev` with every
 * process-level dev-login condition true (lib/dev-login/env-policy.mjs). The middleware answers the
 * virtual public path /dev-login with a 307 here while the per-request gate is open; every method
 * of this route runs the full gate itself, so a closed gate is a 404 for all of them.
 */
export const dynamic = "force-dynamic";

export const GET = (request: Request) => handleDevLoginPage(request);
export const HEAD = GET;
const other = (request: Request) => handleDevLoginOtherMethod(request, "GET");
export const POST = other;
export const PUT = other;
export const PATCH = other;
export const DELETE = other;
export const OPTIONS = other;
