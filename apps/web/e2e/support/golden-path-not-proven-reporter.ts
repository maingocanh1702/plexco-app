import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

/** Annotation the spec pushes when club creation was refused and the opt-in seeded Dev Club took over. */
export const NOT_PROVEN_ANNOTATION = "club-create-throttled";

/** The loud line for an opt-in pass that did not prove club creation (printed by the spec and by this reporter). */
export const NOT_PROVEN_MESSAGE =
  "!!! GOLDEN PATH: club creation was NOT proven (tenant-create limit hit); the rest of the path ran in the seeded Dev Club !!!";

/**
 * Runs AFTER the `list` reporter (order in golden-path.config.ts), so its onEnd line is the very last
 * output, below the "1 passed" summary. Without it an opt-in run (GOLDEN_PATH_ALLOW_SEEDED_CLUB=1)
 * ends in a plain green "1 passed", exit code 0, and reads as a proven club creation.
 */
export default class GoldenPathNotProvenReporter implements Reporter {
  private notProven = false;

  onTestEnd(test: TestCase, _result: TestResult): void {
    if (test.annotations.some((a) => a.type === NOT_PROVEN_ANNOTATION)) this.notProven = true;
  }

  onEnd(_result: FullResult): void {
    if (this.notProven) console.log(`\n${NOT_PROVEN_MESSAGE}\n`);
  }

  printsToStdio(): boolean {
    return false;
  }
}
