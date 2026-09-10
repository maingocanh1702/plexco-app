import { pathToFileURL } from "node:url";

/**
 * "Was this module the process entrypoint?" — audit 2026-09-06 B-4.
 *
 * worker.ts and provision-queue.ts used `process.argv[1]?.endsWith("worker.ts")`. That is true
 * under `tsx src/worker.ts` (today's start:worker) and FALSE the moment the file is compiled to
 * .js or started through a path that does not end in the source name: the module loads, main()
 * never runs, the process exits 0 — a worker that "started" and silently did nothing. The
 * comparison here is what Node itself does for `require.main === module` in ESM terms: the
 * module's own URL against the entry script's URL, extension included, so a compiled
 * `dist/worker.js` started as `node dist/worker.js` is a direct run and `import "./worker.js"`
 * from a test is not.
 *
 * Pure (both inputs injectable) so schedule.test.ts can pin the matrix without spawning.
 */
export function isDirectRun(
  moduleUrl: string,
  argv1: string | undefined = process.argv[1],
): boolean {
  if (!argv1) return false;
  let entry: string;
  try {
    entry = pathToFileURL(argv1).href;
  } catch {
    return false;
  }
  return entry === moduleUrl;
}
