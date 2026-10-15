import { randomUUID } from "node:crypto";
import { t } from "@plexco/core/i18n";
import { err } from "../api-envelope";
import { log } from "../log";
import { readBoundedBody } from "../read-bounded-body";
import {
  appDb,
  issueSession,
  sameOriginRequest,
  SessionReauthRequiredError,
} from "../session-cookies";
import {
  clearDevLoginCsrfCookie,
  DEV_LOGIN_CSRF_FIELD,
  devLoginCsrfTokensMatch,
  newDevLoginCsrfToken,
  readDevLoginCsrfCookie,
  setDevLoginCsrfCookie,
} from "./csrf";
import { devLoginDatabaseVerdict, devLoginOptInCommand } from "./database-guard";
import { devLoginNotFound, evaluateDevLoginGate, readDevLoginEnv } from "./gate";
import { devServerLoopbackOnly } from "./network-exposure";
import { buildDevLoginDocument, normalizeDevLoginPageError } from "./page-document";
import { resolveDevPersonaAccount } from "./persona-account";
import { devPersonaByKey } from "./personas";
import { DEV_LOGIN_PAGE_PATH } from "./routing";

/**
 * Logic of the two dev-login route handlers (app/internal-dev-login/{page,session}/route.dev.ts),
 * kept here because an App Router route module may export only HTTP verbs.
 *
 * Every handler opens with the same refusal chain, before any cookie, body read or write:
 *   1. the full per-request gate (again: the middleware already checked it), bind evidence included;
 *   2. the fail-closed network-exposure probe (network-exposure.ts), re-measured on every request;
 *   3. the DB-side guard (database-guard.ts): the database opted in, the role RLS-enforced.
 * Any false => the bare 404 of devLoginNotFound() and a server log line naming the reason.
 */

/** `persona=<key>&csrf=<43 chars>` is ~70 bytes; 1 KiB is ~15x that. */
const MAX_LOGIN_BODY_BYTES = 1024;

async function gateRefusal(request: Request): Promise<Response | null> {
  const decision = evaluateDevLoginGate(readDevLoginEnv(), request.headers);
  if (!decision.open) {
    log.warn("auth.dev_login.gate_closed", {
      reason: decision.reason,
      ...(decision.reason === "bind" ? { remedy: "start the dev server with -H 127.0.0.1" } : {}),
    });
    return devLoginNotFound();
  }
  if (!(await devServerLoopbackOnly())) {
    log.warn("auth.dev_login.gate_closed", {
      reason: "network_exposed",
      remedy: "bind the dev server to loopback: next dev -H 127.0.0.1",
    });
    return devLoginNotFound();
  }
  let database: Awaited<ReturnType<typeof devLoginDatabaseVerdict>>;
  try {
    database = await devLoginDatabaseVerdict(appDb().pool);
  } catch (error) {
    log.error("auth.dev_login.gate_closed", { reason: "database_unavailable", error });
    return devLoginNotFound();
  }
  if (!database.ok) {
    log.warn("auth.dev_login.gate_closed", {
      reason: database.reason,
      remedy:
        database.reason === "database_not_opted_in"
          ? `as the database owner: ${devLoginOptInCommand(database.database)}; then restart next dev`
          : "use the app role (NOBYPASSRLS) in DATABASE_URL, never the superuser",
    });
    return devLoginNotFound();
  }
  return null;
}

/**
 * No Referrer-Policy here: `no-referrer` on a redirect becomes the policy of the request it
 * triggers, and a form POST under `no-referrer` carries `Origin: null` (Fetch), which
 * sameOriginRequest() rightly refuses. The global strict-origin-when-cross-origin applies.
 */
function seeOther(location: string): Response {
  return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
}

/** GET /dev-login (307 from the middleware): the persona form with a fresh double-submit token. */
export async function handleDevLoginPage(request: Request): Promise<Response> {
  const refused = await gateRefusal(request);
  if (refused) return refused;

  const token = newDevLoginCsrfToken();
  await setDevLoginCsrfCookie(token);
  const error = normalizeDevLoginPageError(new URL(request.url).searchParams.get("error"));
  const document = buildDevLoginDocument({ csrfToken: token, error });
  return new Response(document.body, { status: 200, headers: document.headers });
}

/**
 * Every HTTP method the implementation route does not serve. Exported for all of them by the route
 * files, so Next never answers 405 / 204 `Allow` on its own: a closed gate is the same bare 404 for
 * every method, and an open gate says 405 with the one method that route accepts.
 */
export async function handleDevLoginOtherMethod(
  request: Request,
  allow: "GET" | "POST",
): Promise<Response> {
  const refused = await gateRefusal(request);
  if (refused) return refused;
  return new Response(null, { status: 405, headers: { allow, "cache-control": "no-store" } });
}

const csrfInvalid = () => err("CSRF_INVALID", t("Yêu cầu không hợp lệ.", "Invalid request."), 403);
const invalidBody = () => err("INVALID_BODY", t("Dữ liệu không hợp lệ.", "Invalid payload."), 400);

/**
 * POST /api/dev/login (307 from the middleware). Order: gate -> same-origin -> bounded form body ->
 * double-submit token -> closed-set persona -> consume the token -> persona account via the Google
 * login definer -> issueSession() -> audit log -> 303 to `/` (a route-handler Location, relative;
 * the browser resolves it against the page's own origin, where the session cookie was just set).
 */
export async function handleDevLoginSession(request: Request): Promise<Response> {
  const refused = await gateRefusal(request);
  if (refused) return refused;
  try {
    return await signInPersona(request);
  } catch (error) {
    // Never a bare 500 page; the log says which dependency failed (no request data, no secrets).
    log.error("auth.dev_login.unhandled", { error });
    return seeOther(`${DEV_LOGIN_PAGE_PATH}?error=unavailable`);
  }
}

async function signInPersona(request: Request): Promise<Response> {
  if (!sameOriginRequest(request)) return csrfInvalid();

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return invalidBody();
  }
  const read = await readBoundedBody(request, MAX_LOGIN_BODY_BYTES);
  if (!read.ok) return invalidBody();
  const form = new URLSearchParams(read.text);

  if (!devLoginCsrfTokensMatch(await readDevLoginCsrfCookie(), form.get(DEV_LOGIN_CSRF_FIELD))) {
    return csrfInvalid();
  }
  const persona = devPersonaByKey(form.get("persona"));
  if (persona === null) return invalidBody();
  await clearDevLoginCsrfCookie();

  const requestRef = `dev_login_${randomUUID()}`;
  const login = await resolveDevPersonaAccount(appDb().pool, persona, requestRef);
  if (login.outcome !== "login_success") {
    // identity_conflict: a dev email verified on another account. Fail closed, like the callback.
    log.warn("auth.dev_login.refused", { outcome: login.outcome, requestRef });
    return err("AUTH_INVALID", t("Xác thực không hợp lệ.", "Invalid authentication."), 403);
  }

  try {
    // THE session issuer, unchanged: rotate when a session cookie is present (persona switch),
    // else create. Same cookie, same web_sessions row shape, same CSRF secret as Google sign-in.
    await issueSession(login.accountId);
  } catch (error) {
    if (error instanceof SessionReauthRequiredError) {
      return seeOther(`${DEV_LOGIN_PAGE_PATH}?error=reauth`);
    }
    throw error;
  }

  // Structured audit event (ids only; no email, no name). The DB row for this login is the
  // definer's login_success row written above under the same requestRef.
  log.info("auth.dev_login", {
    accountId: login.accountId,
    personId: login.personId,
    persona: persona.key,
    requestRef,
  });
  return seeOther("/");
}
