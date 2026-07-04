/**
 * Liveness probe for Fly http_checks (infra/fly.toml: path = "/healthz" on the
 * web and discovery process groups). Cheap 200 — no DB, no auth.
 */
export function GET(): Response {
  return Response.json({ ok: true });
}
