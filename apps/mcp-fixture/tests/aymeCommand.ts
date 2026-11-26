import { readdirSync, readFileSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runAyme, type AymeRun } from "@ayme-dev/cli/testing";
import { test as base, expect } from "@playwright/test";

export { expect };

/** Whether a process with `pid` exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The ayme folder of the command's projects: Page Objects written as for
 * a Playwright test, for `shop.html`. */
const COMMAND_AYME = fileURLToPath(new URL("../command/ayme", import.meta.url));

export const test = base.extend<{
  /** A project folder of the test's own, inside the fixture, so the
   * project's Playwright and @ayme-dev/ayme are the fixture's. Its ayme
   * folder is the command's. */
  project: string;
  /** Runs the built `ayme` command in the project, with a cache folder of
   * the test's own, so it never finds another test's Session. A Session the
   * test left open is ended with it. */
  ayme: (...args: string[]) => Promise<AymeRun>;
  /** The process of the project's Session, read from the record it keeps
   * in the cache folder; undefined when it has none. */
  sessionProcess: () => number | undefined;
}>({
  // Playwright reads a fixture's dependencies from its first parameter,
  // which must be a pattern.
  // eslint-disable-next-line no-empty-pattern
  project: async ({}, use, testInfo) => {
    const project = testInfo.outputPath("project");
    await mkdir(project, { recursive: true });
    await cp(COMMAND_AYME, join(project, "ayme"), { recursive: true });
    await use(project);
  },
  // eslint-disable-next-line no-empty-pattern
  sessionProcess: async ({}, use, testInfo) => {
    const sessions = testInfo.outputPath("cache", "sessions");
    await use(() => {
      let names: string[];
      try {
        names = readdirSync(sessions);
      } catch {
        return undefined;
      }
      const record = names.find((name) => /^[0-9a-f]+\.json$/.test(name));
      if (record === undefined) return undefined;
      return (
        JSON.parse(readFileSync(join(sessions, record), "utf8")) as {
          pid: number;
        }
      ).pid;
    });
  },
  ayme: async ({ project, sessionProcess }, use, testInfo) => {
    const env = {
      ...process.env,
      AYME_CACHE_DIR: testInfo.outputPath("cache"),
    };
    await use((...args) => runAyme(args, { cwd: project, env }));
    const left = sessionProcess();
    if (left === undefined || !isAlive(left)) return;
    // Ended as `ayme close` would, so its browser closes too.
    process.kill(left, "SIGTERM");
    await expect.poll(() => isAlive(left), { timeout: 10_000 }).toBe(false);
  },
});
