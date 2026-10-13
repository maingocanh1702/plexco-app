/**
 * True when `error` or anything on its `cause` chain carries SQLSTATE `code`. drizzle re-throws pg
 * errors as `Failed query: ...` with the real error on `.cause`, so a top-level `.code` check misses
 * them. The ONE walker for callers that branch on a pg code (bounded: stops on cycles).
 */
export function pgErrorHasCode(error: unknown, code: string): boolean {
  const seen = new Set<unknown>();
  for (let c: unknown = error; c && typeof c === "object" && !seen.has(c);) {
    seen.add(c);
    if ((c as { code?: unknown }).code === code) return true;
    c = (c as { cause?: unknown }).cause;
  }
  return false;
}

/** Concatenated `message`s along the cause chain (for matching a RAISE text the SQLSTATE cannot tell apart). */
export function pgErrorChainText(error: unknown): string {
  const seen = new Set<unknown>();
  const out: string[] = [];
  for (let c: unknown = error; c instanceof Error && !seen.has(c); c = c.cause) {
    seen.add(c);
    out.push(c.message);
  }
  return out.join(" | ");
}
