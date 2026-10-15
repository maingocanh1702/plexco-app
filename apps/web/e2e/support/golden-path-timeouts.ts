/**
 * Timeouts of the OPT-IN, LOCAL-ONLY golden-path spec, in one place (read by golden-path.config.ts,
 * golden-path.spec.ts and the support helpers; it imports nothing so the config can load it).
 *
 * Why so generous: the spec drives `next dev`, which compiles every page and API route on its FIRST
 * request and drops idle ones after ~60 s, so a run recompiles routes it already used. Measured on a
 * loaded machine (load average 15-19): one route (/api/sessions/[id]) took 112.9 s to compile, and
 * three runs failed on 240 s test / 75 s expect timeouts. An assertion that fails for real still fails;
 * it just does so after the budget below instead of after a premature one.
 */

/** One slow dev-server compile, plus the API pacer's worst-case hold of one 60 s rate-limit window. */
export const COMPILE_TIMEOUT_MS = 240_000;

/** The whole end-to-end flow (about 25 steps, several of them cold compiles). */
export const TEST_TIMEOUT_MS = 1_200_000;

/** Single UI action (click/fill/check): may wait for a page that is still compiling. */
export const ACTION_TIMEOUT_MS = 120_000;
