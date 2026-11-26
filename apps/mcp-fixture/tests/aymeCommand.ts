import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runAyme, type AymeRun } from "@ayme-dev/cli/testing";
import { test as base, expect } from "@playwright/test";

export { expect };

/** The state the system gives the process `pid`, such as "S" or "Z", or
 * undefined when there is none. */
function processState(pid: number): string | undefined {
  try {
    if (process.platform === "linux") {
      // The field after the name, which may hold spaces.
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
    }
    return (
      execFileSync("ps", ["-o", "stat=", "-p", String(pid)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim() || undefined
    );
  } catch {
    return undefined;
  }
}

/** Whether a process with `pid` runs. One that ended but was never reaped,
 * a zombie, does not: in CI's container, which has no init process, an
 * orphan such as a Session's process stays one for good. */
export function isAlive(pid: number): boolean {
  const state = processState(pid);
  return state !== undefined && !state.startsWith("Z");
}

/** The ayme folder of the command's projects: Page Objects written as for
 * a Playwright test, for `shop.html`. */
const COMMAND_AYME = fileURLToPath(new URL("../command/ayme", import.meta.url));

/** The processes whose command line names `text`. A zombie has none. */
function processesNaming(text: string): number[] {
  if (process.platform === "linux")
    return readdirSync("/proc").flatMap((name) => {
      try {
        return /^\d+$/.test(name) &&
          readFileSync(`/proc/${name}/cmdline`, "utf8").includes(text)
          ? [Number(name)]
          : [];
      } catch {
        return [];
      }
    });
  return execFileSync("ps", ["-ax", "-o", "pid=,command="], {
    encoding: "utf8",
  })
    .split("\n")
    .filter((line) => line.includes(text))
    .map((line) => Number.parseInt(line, 10));
}

const signal = (pids: number[], name: NodeJS.Signals) => {
  for (const pid of pids)
    try {
      process.kill(pid, name);
    } catch {
      // Already gone.
    }
};

/**
 * Ends every process the test's `ayme` runs started, whether or not it got
 * as far as its record: each names the test's own temporary folder, the
 * background process in its socket's path and Chromium in its profile's.
 * Each is first ended as `ayme close` would, so its browser closes too, and
 * whatever is left after a while, behind a start that does not end, is
 * killed.
 */
async function endProcessesIn(folder: string): Promise<void> {
  signal(processesNaming(folder), "SIGTERM");
  try {
    await expect
      .poll(() => processesNaming(folder), { timeout: 10_000 })
      .toEqual([]);
  } catch {
    signal(processesNaming(folder), "SIGKILL");
  }
}

export const test = base.extend<{
  /** A project folder of the test's own, inside the fixture, so the
   * project's Playwright and @ayme-dev/ayme are the fixture's. Its ayme
   * folder is the command's. */
  project: string;
  /** Runs the built `ayme` command in the project. */
  ayme: (...args: string[]) => Promise<AymeRun>;
  /** Runs the built `ayme` command in the project until `signal` stops
   * it, as Ctrl+C would. */
  aymeUntil: (signal: AbortSignal, ...args: string[]) => Promise<AymeRun>;
  /** The temporary folder of the test's `ayme` runs, which each process
   * they start names: the background process in its socket's path and
   * Chromium in its profile's. */
  temporary: string;
  /** The processes the test's `ayme` runs started that still run. */
  processesLeft: () => number[];
  /** Runs the built `ayme` command in the folder `cwd`, with a cache folder
   * and a temporary folder of the test's own, so it never finds another
   * test's Session. Every process it started is ended with the test, and
   * the folders are removed. */
  aymeIn: (cwd: string, ...args: string[]) => Promise<AymeRun>;
  /** The process of the project's Session, read from the newest record it
   * keeps in the cache folder; undefined when it has none. */
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
    await rm(project, { recursive: true, force: true });
  },
  // eslint-disable-next-line no-empty-pattern
  sessionProcess: async ({}, use, testInfo) => {
    const sessions = testInfo.outputPath("cache", "sessions");
    await use(() => {
      let folders: string[];
      try {
        folders = readdirSync(sessions);
      } catch {
        return undefined;
      }
      const claims = folders.map((name) => join(sessions, name));
      const newest = claims
        .flatMap((claim) =>
          readdirSync(claim)
            .filter((name) => /^\d+\.json$/.test(name))
            .map((name) => ({ claim, generation: Number.parseInt(name, 10) }))
        )
        .sort((a, b) => b.generation - a.generation)[0];
      if (newest === undefined) return undefined;
      return (
        JSON.parse(
          readFileSync(join(newest.claim, `${newest.generation}.json`), "utf8")
        ) as { pid: number }
      ).pid;
    });
  },
  // eslint-disable-next-line no-empty-pattern
  temporary: async ({}, use) => {
    // A short folder: a Session's socket lives in it, and a local socket's
    // path is short.
    const temporary = realpathSync(await mkdtemp(join(tmpdir(), "ayme-e2e-")));
    try {
      await use(temporary);
    } finally {
      await endProcessesIn(temporary);
      await rm(temporary, { recursive: true, force: true });
    }
  },
  processesLeft: async ({ temporary }, use) => {
    await use(() => processesNaming(temporary));
  },
  aymeIn: async ({ temporary }, use, testInfo) => {
    const cache = testInfo.outputPath("cache");
    const env = { ...process.env, AYME_CACHE_DIR: cache, TMPDIR: temporary };
    try {
      await use((cwd, ...args) => runAyme(args, { cwd, env }));
    } finally {
      await rm(cache, { recursive: true, force: true });
    }
  },
  ayme: async ({ project, aymeIn }, use) => {
    await use((...args) => aymeIn(project, ...args));
  },
  aymeUntil: async ({ project, temporary }, use, testInfo) => {
    const env = {
      ...process.env,
      AYME_CACHE_DIR: testInfo.outputPath("cache"),
      TMPDIR: temporary,
    };
    await use((signal, ...args) =>
      runAyme(args, { cwd: project, env, signal })
    );
  },
});
