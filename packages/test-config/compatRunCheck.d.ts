import type { Reporter } from "vitest/node";

/** Checks a compatibility suite's run: prints its verdict line only when
 * every project passed a test and every skip is one the suite declares. */
export declare class CompatRunCheck implements Reporter {
  constructor(projects: readonly string[]);
  onTestRunEnd: NonNullable<Reporter["onTestRunEnd"]>;
}
