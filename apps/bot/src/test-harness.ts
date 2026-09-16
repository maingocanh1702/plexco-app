import type { TestFunction } from "vitest";

/** Vitest timeouts do not cancel a callback; join its original operation before moving on. */
export function withTestContext<T extends { teardown(): Promise<void> }>(
  setup: () => Promise<T>,
  body: (context: T) => Promise<void>,
): TestFunction {
  return (test) => {
    test.onTestFinished(() => operation);
    const operation = (async () => {
      // Setup owns cleanup if it fails before publishing its context.
      const context = await setup();
      try {
        test.signal.throwIfAborted();
        await body(context);
      } finally {
        await context.teardown();
      }
    })();
    return operation;
  };
}
